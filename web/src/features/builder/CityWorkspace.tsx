import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { BlockType, City, PlacedBlock } from '@rmc/shared';
import { useActiveCity } from '@/app/ActiveCityProvider';
import { useBlockTypes } from '@/lib/api/hooks';
import { Button } from '@/components/ui/Button';
import { CenteredSpinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { errorMessage } from '@/lib/api/errors';
import { blockColor, blockGlyph } from '@/lib/visuals';
import { cx } from '@/lib/format';
import { CityCanvas } from './CityCanvas';
import { ServiceDock } from './ServiceDock';
import { useCityLayout } from './useCityLayout';
import type { Cell } from './scene/isometric';

/**
 * The shared map workspace. FE #1 owns everything under features/builder.
 *
 * The map is the product, so it fills the screen and everything else floats over it.
 * This component mounts once, at the layout route - it is never rebuilt when you open
 * or close a mode window, which is why animations and selections survive.
 *
 * Simulation and Proposal read the same state through `useCityWorkspace()`:
 *
 *   const workspace = useCityWorkspace();   // { city, blockTypes, layout }
 *
 * See docs/00-architecture-overview.md and docs/01-fe1-city-builder.md.
 */
export type CityLayout = ReturnType<typeof useCityLayout>;

export interface CityWorkspaceApi {
  city: City;
  blockTypes: BlockType[];
  /** Local layout state plus `applyChanges` for adopting a proposal's block delta. */
  layout: CityLayout;
}

const CityWorkspaceContext = createContext<CityWorkspaceApi | null>(null);

/** Read the live map state from any feature. Only valid inside <CityWorkspace>. */
export function useCityWorkspace(): CityWorkspaceApi {
  const context = useContext(CityWorkspaceContext);
  if (!context) throw new Error('useCityWorkspace must be used inside <CityWorkspace>.');
  return context;
}

export function CityWorkspace({ children }: { children?: ReactNode }) {
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

  // Escape backs out of whatever you were doing. Floating windows handle their own
  // Escape first, so this only fires once the front-most window has closed.
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

  const api = useMemo<CityWorkspaceApi | null>(
    () => (city ? { city, blockTypes, layout } : null),
    [city, blockTypes, layout],
  );

  if (error) {
    return (
      <div className="grid h-dvh place-items-center">
        <EmptyState
          glyph={'\u{26A0}'}
          title="Could not load your city"
          description={errorMessage(error)}
        />
      </div>
    );
  }

  if (isLoading || !api || blockTypesQuery.isLoading) {
    return (
      <div className="grid h-dvh place-items-center">
        <CenteredSpinner label="Loading your city" />
      </div>
    );
  }

  function handleCellClick(cell: Cell, block: PlacedBlock | null) {
    // Armed dock wins: click-to-place.
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
    <CityWorkspaceContext.Provider value={api}>
      {/* -------------------------------------------------------------- map */}
      <CityCanvas
        className="absolute inset-0"
        city={sceneCity}
        selectedCell={selectedCell}
        onCellFocus={setSelectedCell}
        armedTypeId={draggingTypeId ?? armedTypeId}
        onCellClick={handleCellClick}
        onCellHover={(cell, block) => setHovered(cell ? { cell, block } : null)}
        canPlace={layout.canPlace}
        onDropBlock={(cell, typeId) => layout.place(cell, typeId)}
      />

      {/* ------------------------------------------------ budget, top right */}
      <div className="pointer-events-none fixed top-3 right-3 z-[200]">
        <BudgetPill
          used={layout.blocksUsed}
          budget={layout.budget}
          saving={layout.saveState === 'saving'}
          dirty={layout.saveState === 'dirty'}
          failed={layout.saveState === 'error'}
        />
      </div>

      {/* --------------------------------------------------------- left slot
          One slot, two states: the selected block takes it when there is one,
          otherwise it shows what you are hovering. Sitting them in the same place
          keeps the map clear and stops the two from ever colliding. */}
      <div className="fixed bottom-[124px] left-3 z-30 w-60">
        {selectedBlock ? (
          <div className="rounded-card border border-line-bright bg-ink-900/90 p-3 shadow-2xl shadow-black/50 backdrop-blur-md">
            <SelectedBlockCard
              block={selectedBlock}
              name={
                blockTypes.find((type) => type.id === selectedBlock.typeId)?.name ??
                selectedBlock.typeId
              }
              tradeoff={
                blockTypes.find((type) => type.id === selectedBlock.typeId)?.tradeoffs[0] ?? null
              }
              onRemove={() => {
                layout.remove(selectedBlock.id);
                setSelectedCell(null);
              }}
              onDismiss={() => setSelectedCell(null)}
            />
          </div>
        ) : (
          hovered && (
            <p className="pointer-events-none inline-block rounded-lg border border-line bg-ink-900/85 px-2.5 py-1.5 text-xs text-muted shadow-lg shadow-black/40 backdrop-blur-sm">
              {hoveredType ? (
                <>
                  <span className="font-semibold text-cream">{hoveredType.name}</span> &middot; (
                  {hovered.cell.x}, {hovered.cell.y})
                </>
              ) : (
                <>
                  Empty &middot; ({hovered.cell.x}, {hovered.cell.y})
                </>
              )}
            </p>
          )
        )}
      </div>

      {/* ------------------------------------------------- the service dock */}
      <ServiceDock
        blockTypes={blockTypes}
        armedTypeId={armedTypeId}
        onArm={setArmedTypeId}
        onDragStateChange={setDraggingTypeId}
        remaining={layout.budget - layout.blocksUsed}
      />

      {/* ------------------------------------------------- floating windows */}
      {children}
    </CityWorkspaceContext.Provider>
  );
}

function BudgetPill({
  used,
  budget,
  saving,
  dirty,
  failed,
}: {
  used: number;
  budget: number;
  saving: boolean;
  dirty: boolean;
  failed: boolean;
}) {
  const ratio = budget === 0 ? 0 : Math.min(1, used / budget);
  const tone = failed ? 'bg-bad' : ratio > 0.95 ? 'bg-bad' : ratio > 0.8 ? 'bg-warn' : 'bg-apricot';

  return (
    <div className="rounded-xl border border-line-bright bg-ink-900/85 px-3 py-2 shadow-lg shadow-black/40 backdrop-blur-md">
      <div className="flex items-baseline gap-2">
        <span className="text-[10px] font-bold tracking-wide text-muted uppercase">Blocks</span>
        <span
          className="font-display text-sm font-bold text-cream tabular-nums"
          role="meter"
          aria-valuenow={used}
          aria-valuemin={0}
          aria-valuemax={budget}
          aria-label="Blocks used"
        >
          {used}
          <span className="text-muted"> / {budget}</span>
        </span>
        <span
          aria-hidden="true"
          title={failed ? 'Save failed' : saving ? 'Saving' : dirty ? 'Unsaved' : 'Saved'}
          className={cx(
            'size-1.5 rounded-full transition-colors',
            failed ? 'bg-bad' : saving ? 'animate-pulse bg-warn' : dirty ? 'bg-muted' : 'bg-good',
          )}
        />
      </div>
      <div className="mt-1.5 h-1 w-32 overflow-hidden rounded-pill bg-ink-800">
        <div
          className={cx('h-full rounded-pill transition-[width] duration-300', tone)}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
    </div>
  );
}

function SelectedBlockCard({
  block,
  name,
  tradeoff,
  onRemove,
  onDismiss,
}: {
  block: PlacedBlock;
  name: string;
  tradeoff: string | null;
  onRemove: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className="grid size-8 shrink-0 place-items-center rounded-md text-base"
          style={{
            backgroundColor: `${blockColor(block.typeId)}26`,
            boxShadow: `inset 0 0 0 1.5px ${blockColor(block.typeId)}`,
          }}
        >
          {blockGlyph(block.typeId)}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-cream">{name}</span>
          <span className="block text-xs text-muted">
            Cell ({block.x}, {block.y})
          </span>
        </span>
      </div>

      {tradeoff && <p className="text-xs text-muted">{tradeoff}</p>}
      <p className="text-xs text-faint">Click an empty cell to move it here.</p>

      <div className="flex gap-2">
        <Button size="sm" variant="danger" onClick={onRemove}>
          Remove
        </Button>
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          Done
        </Button>
      </div>
    </div>
  );
}
