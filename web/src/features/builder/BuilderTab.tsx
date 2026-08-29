import { useEffect, useMemo, useState } from 'react';
import type { PlacedBlock } from '@rmc/shared';
import { useActiveCity } from '@/app/ActiveCityProvider';
import { useBlockTypes } from '@/lib/api/hooks';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { CenteredSpinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { errorMessage } from '@/lib/api/errors';
import { blockColor, blockGlyph } from '@/lib/visuals';
import { CityCanvas } from './CityCanvas';
import { ServiceBar } from './ServiceBar';
import { BudgetMeter } from './BudgetMeter';
import { useCityLayout } from './useCityLayout';
import type { Cell } from './scene/isometric';

/**
 * The City tab - the build half of BUILD -> TEST -> DISCOVER -> REBUILD.
 * FE #1 owns everything under features/builder.
 */
export function BuilderTab() {
  const { city, isLoading, error } = useActiveCity();
  const blockTypesQuery = useBlockTypes();
  const blockTypes = useMemo(() => blockTypesQuery.data ?? [], [blockTypesQuery.data]);

  const layout = useCityLayout(city, blockTypes);

  const [armedTypeId, setArmedTypeId] = useState<string | null>(null);
  /** Transient drag state, kept apart from `armedTypeId` so a dragend cannot clear it. */
  const [draggingTypeId, setDraggingTypeId] = useState<string | null>(null);
  const [selectedCell, setSelectedCell] = useState<Cell | null>(null);
  const [hovered, setHovered] = useState<{ cell: Cell; block: PlacedBlock | null } | null>(null);

  const selectedBlock = selectedCell ? layout.blockAt(selectedCell) : null;

  // Escape backs out of whatever you were doing.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      setArmedTypeId(null);
      setSelectedCell(null);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const sceneCity = useMemo(
    () => ({
      gridWidth: city?.gridWidth ?? 10,
      gridHeight: city?.gridHeight ?? 10,
      blocks: layout.blocks,
    }),
    [city?.gridWidth, city?.gridHeight, layout.blocks],
  );

  if (error) {
    return (
      <Card>
        <EmptyState
          glyph={'\u{26A0}'}
          title="Could not load your city"
          description={errorMessage(error)}
        />
      </Card>
    );
  }

  if (isLoading || !city || blockTypesQuery.isLoading) {
    return <CenteredSpinner label="Loading your city" />;
  }

  function handleCellClick(cell: Cell, block: PlacedBlock | null) {
    // Armed service bar wins: click-to-place.
    if (armedTypeId) {
      layout.place(cell, armedTypeId);
      return;
    }

    // A selected block plus a click on an empty cell means "move it there".
    if (selectedBlock && !block) {
      layout.move(selectedBlock.id, cell);
      setSelectedCell(cell);
      return;
    }

    setSelectedCell(block ? cell : null);
  }

  const hoveredType = hovered?.block
    ? blockTypes.find((type) => type.id === hovered.block?.typeId)
    : null;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      {/* ------------------------------------------------------------- map */}
      <section className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-extrabold">{city.name}</h1>
            <p className="text-sm text-muted">
              {armedTypeId
                ? 'Click cells to place. Press Escape when you are done.'
                : selectedBlock
                  ? 'Click an empty cell to move this block.'
                  : 'Drag a service onto the grid, or click one to arm it.'}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {armedTypeId && (
              <Button size="sm" variant="secondary" onClick={() => setArmedTypeId(null)}>
                Cancel placement
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              disabled={layout.blocks.length === 0}
              onClick={() => {
                setSelectedCell(null);
                layout.clear();
              }}
            >
              Clear grid
            </Button>
          </div>
        </div>

        <CityCanvas
          city={sceneCity}
          selectedCell={selectedCell}
          armedTypeId={draggingTypeId ?? armedTypeId}
          onCellClick={handleCellClick}
          onCellHover={(cell, block) => setHovered(cell ? { cell, block } : null)}
          canPlace={layout.canPlace}
          onDropBlock={(cell, typeId) => layout.place(cell, typeId)}
        />

        {/* Hover readout - keeps the tooltip out of the canvas so it never clips. */}
        <p className="h-5 text-sm text-muted" aria-live="polite">
          {hovered ? (
            hoveredType ? (
              <>
                <span className="font-semibold text-cream">{hoveredType.name}</span> at (
                {hovered.cell.x}, {hovered.cell.y}) &middot; {hoveredType.tradeoffs[0] ?? hoveredType.description}
              </>
            ) : (
              <>
                Empty cell ({hovered.cell.x}, {hovered.cell.y})
              </>
            )
          ) : null}
        </p>
      </section>

      {/* --------------------------------------------------------- sidebar */}
      <aside className="flex flex-col gap-4">
        <Card className="p-4">
          <BudgetMeter
            used={layout.blocksUsed}
            budget={layout.budget}
            saveState={layout.saveState}
          />
        </Card>

        <Card>
          <CardHeader title="Services" subtitle="Drag onto the grid, or click to arm" />
          <div className="p-3">
            <ServiceBar
              blockTypes={blockTypes}
              armedTypeId={armedTypeId}
              onArm={setArmedTypeId}
              onDragStateChange={setDraggingTypeId}
              remaining={layout.budget - layout.blocksUsed}
            />
          </div>
        </Card>

        {selectedBlock && (
          <SelectedBlockCard
            block={selectedBlock}
            name={
              blockTypes.find((type) => type.id === selectedBlock.typeId)?.name ??
              selectedBlock.typeId
            }
            tradeoffs={
              blockTypes.find((type) => type.id === selectedBlock.typeId)?.tradeoffs ?? []
            }
            onRemove={() => {
              layout.remove(selectedBlock.id);
              setSelectedCell(null);
            }}
          />
        )}
      </aside>
    </div>
  );
}

function SelectedBlockCard({
  block,
  name,
  tradeoffs,
  onRemove,
}: {
  block: PlacedBlock;
  name: string;
  tradeoffs: string[];
  onRemove: () => void;
}) {
  return (
    <Card>
      <CardHeader title="Selected block" subtitle={`Cell (${block.x}, ${block.y})`} />
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="grid size-9 place-items-center rounded-md text-lg"
            style={{
              backgroundColor: `${blockColor(block.typeId)}26`,
              boxShadow: `inset 0 0 0 1.5px ${blockColor(block.typeId)}`,
            }}
          >
            {blockGlyph(block.typeId)}
          </span>
          <span className="font-semibold text-cream">{name}</span>
        </div>

        {tradeoffs[0] && <p className="text-sm text-muted">{tradeoffs[0]}</p>}

        <div className="flex gap-2">
          <Button size="sm" variant="danger" onClick={onRemove}>
            Remove
          </Button>
        </div>
      </div>
    </Card>
  );
}
