import {
  createContext,
  useCallback,
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
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/api/errors';
import { blockColor, blockGlyph } from '@/lib/visuals';
import { CityCanvas } from './CityCanvas';
import { ServiceDock } from './ServiceDock';
import { useCityLayout } from './useCityLayout';
import type { Cell } from './scene/isometric';
import { linesAt } from './roadLines';

/**
 * The shared map workspace. FE #1 owns everything under features/builder.
 *
 * The map is the product, so it fills the screen and everything else floats over it.
 * This component mounts once, at the layout route - it is never rebuilt when you open
 * or close a mode window, which is why animations and selections survive.
 *
 * Simulation and Proposal read the same state through `useCityWorkspace()`:
 *
 *   const workspace = useCityWorkspace();   // { city, blockTypes, layout, mapSelection }
 *
 * See docs/00-architecture-overview.md and docs/01-fe1-city-builder.md.
 */
export type CityLayout = ReturnType<typeof useCityLayout>;

/** Proposal mode shows a different, fixed city - a selection there needs to say so. */
export type MapSelectionSource = 'city' | 'council';

export interface MapSelection {
  block: PlacedBlock;
  source: MapSelectionSource;
}

export interface CityWorkspaceApi {
  city: City;
  blockTypes: BlockType[];
  /** Local layout state plus `applyChanges` for adopting a proposal's block delta. */
  layout: CityLayout;
  /**
   * Whichever block is currently selected, on either map, or null if nothing is.
   * `source` says which city it belongs to - the live layout (`layout.blocks`) for
   * `'city'`, or the council's fixed city for `'council'`. Selecting on one map
   * clears a selection on the other, so this is never ambiguous.
   */
  mapSelection: MapSelection | null;
  /** Record a click from the council map (Proposal mode owns it - FE #1 does not). */
  selectOnCouncilMap: (block: PlacedBlock | null) => void;
  /** Clear whichever map's selection is active. What Escape does; Access mode's close
   *  icon uses it too, since `mapSelection` can come from either map. */
  clearSelection: () => void;
}

const CityWorkspaceContext = createContext<CityWorkspaceApi | null>(null);

/** Read the live map state from any feature. Only valid inside <CityWorkspace>. */
export function useCityWorkspace(): CityWorkspaceApi {
  const context = useContext(CityWorkspaceContext);
  if (!context) throw new Error('useCityWorkspace must be used inside <CityWorkspace>.');
  return context;
}

export function CityWorkspace({
  children,
  interactive = true,
  mapVisible = true,
}: {
  children?: ReactNode;
  /** Whether the Simulation canvas is mounted. Proposal mode owns a separate canvas. */
  mapVisible?: boolean;
  /** Whether Simulation editing controls are enabled. */
  interactive?: boolean;
}) {
  const { city, isLoading, error } = useActiveCity();
  const toast = useToast();
  const blockTypesQuery = useBlockTypes();
  const blockTypes = useMemo(() => blockTypesQuery.data ?? [], [blockTypesQuery.data]);

  const layout = useCityLayout(city, blockTypes);
  const [armedTypeId, setArmedTypeId] = useState<string | null>(null);
  /** Transient drag state, kept apart from `armedTypeId` so a dragend cannot clear it. */
  const [draggingTypeId, setDraggingTypeId] = useState<string | null>(null);
  const [selectedCell, setSelectedCell] = useState<Cell | null>(null);
  const [hovered, setHovered] = useState<{ cell: Cell; block: PlacedBlock | null } | null>(null);
  /** A click on the council map, in Proposal mode. Its own city, its own selection. */
  const [councilSelection, setCouncilSelection] = useState<PlacedBlock | null>(null);
  /** Transport is drawn as a line: the first click sets this, the second draws it. */
  const [transportDraftStart, setTransportDraftStart] = useState<Cell | null>(null);

  const selectedBlock = selectedCell ? layout.blockAt(selectedCell) : null;

  // How many squares Remove will actually take - mirrors useCityLayout's remove(), so
  // the button can never promise something different from what the click does.
  const selectedLineLength = useMemo(() => {
    if (!selectedBlock || selectedBlock.typeId !== 'transport') return 1;
    const lineIds = linesAt(layout.roadLines, selectedBlock.x, selectedBlock.y);
    if (lineIds.length === 0) return 1;
    return layout.blocks.filter((block) => {
      if (block.typeId !== 'transport') return false;
      const ids = linesAt(layout.roadLines, block.x, block.y);
      return ids.length > 0 && ids.every((id) => lineIds.includes(id));
    }).length;
  }, [selectedBlock, layout.roadLines, layout.blocks]);

  const mapSelection: MapSelection | null = selectedBlock
    ? { block: selectedBlock, source: 'city' }
    : councilSelection
      ? { block: councilSelection, source: 'council' }
      : null;

  const selectOnCouncilMap = useCallback((block: PlacedBlock | null) => {
    setCouncilSelection(block);
    // The two maps' selections are mutually exclusive, or `mapSelection` is ambiguous.
    if (block) setSelectedCell(null);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedCell(null);
    setCouncilSelection(null);
  }, []);

  // Escape backs out of whatever you were doing. Floating windows handle their own
  // Escape first, so this only fires once the front-most window has closed.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      setArmedTypeId(null);
      clearSelection();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [clearSelection]);

  // Arming a different dock item (or de-arming) abandons an in-progress road - it
  // otherwise sits there and ambushes whichever cell you click next time you arm
  // transport again.
  useEffect(() => {
    if (armedTypeId !== 'transport') setTransportDraftStart(null);
  }, [armedTypeId]);

  // Switching between Simulation and Proposal mode swaps which map is even on screen
  // (`mapVisible` flips with it) - a selection from the map you just left means nothing
  // once it's gone, so Access mode's popup shouldn't follow you there.
  useEffect(() => {
    clearSelection();
  }, [mapVisible, clearSelection]);

  // This canvas always represents the user's simulation city. Proposal mode gets
  // its own canvas, so opening it can never replace or mutate this map.
  const sceneCity = useMemo(() => ({
    gridWidth: city?.gridWidth ?? 30,
    gridHeight: city?.gridHeight ?? 30,
    blocks: layout.blocks,
  }), [city?.gridWidth, city?.gridHeight, layout.blocks]);

  const api = useMemo<CityWorkspaceApi | null>(
    () =>
      city ? { city, blockTypes, layout, mapSelection, selectOnCouncilMap, clearSelection } : null,
    [city, blockTypes, layout, mapSelection, selectOnCouncilMap, clearSelection],
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

  if (blockTypesQuery.isError) {
    return (
      <div className="grid h-dvh place-items-center">
        <EmptyState
          glyph={'\u{26A0}'}
          title="Could not load the block catalog"
          description={errorMessage(blockTypesQuery.error, 'The block catalog is unavailable.')}
          action={
            <Button size="sm" variant="secondary" onClick={() => void blockTypesQuery.refetch()}>
              Try again
            </Button>
          }
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
    // Transport draws as a line, not a single placement: the first click on empty
    // ground marks where the road starts, the second routes a path to it - around
    // whatever's in the way - and places the whole thing at once.
    if (armedTypeId === 'transport') {
      // Clicking an existing transport cell is how you connect a new stretch to it -
      // only a different block type actually blocks the start/end point.
      if (block && block.typeId !== 'transport') {
        toast.error('There is already a block on that cell.');
        return;
      }
      if (!transportDraftStart) {
        setTransportDraftStart(cell);
        return;
      }
      const path = layout.findRoadPath(transportDraftStart, cell, 'transport');
      // Disarm once the line is down, so the dock does not stay loaded for another
      // one you did not ask for. A rejected placement keeps it armed to retry.
      if (path && layout.placeMany(path, 'transport')) setArmedTypeId(null);
      setTransportDraftStart(null);
      return;
    }

    // Armed dock wins: click-to-place.
    if (armedTypeId) {
      if (layout.place(cell, armedTypeId)) setArmedTypeId(null);
      return;
    }

    // A selected block plus a click on an empty cell means "move it there".
    if (selectedBlock && !block) {
      layout.move(selectedBlock.id, cell);
      setSelectedCell(cell);
      return;
    }

    setSelectedCell(block ? cell : null);
    // The two maps' selections are mutually exclusive - see selectOnCouncilMap.
    if (block) setCouncilSelection(null);
  }

  const hoveredType = hovered?.block
    ? blockTypes.find((type) => type.id === hovered.block?.typeId)
    : null;

  return (
    <CityWorkspaceContext.Provider value={api}>
      {/* -------------------------------------------------------------- map */}
      {mapVisible && (
        <CityCanvas
          className="absolute inset-0"
          city={sceneCity}
          roadLines={layout.roadLines}
          selectedCell={transportDraftStart ?? selectedCell}
          onCellFocus={setSelectedCell}
          armedTypeId={interactive ? draggingTypeId ?? armedTypeId : null}
          interactive={interactive}
          onCellClick={handleCellClick}
          onCellHover={(cell, block) => setHovered(cell ? { cell, block } : null)}
          canPlace={layout.canPlace}
          onDropBlock={(cell, typeId) => {
            if (layout.place(cell, typeId)) setArmedTypeId(null);
          }}
          hoverLabel={
            transportDraftStart ? (
              <>
                <span className="font-bold">Click to finish the road</span> &middot; from (
                {transportDraftStart.x}, {transportDraftStart.y})
              </>
            ) : (
              hovered && (
                <>
                  <span className="font-bold">{hoveredType?.name ?? 'Empty'}</span> &middot; (
                  {hovered.cell.x}, {hovered.cell.y})
                </>
              )
            )
          }
        />
      )}

      {/* --------------------------------------------------------- left slot
          The selected block only. What you are hovering used to share this slot,
          but it belongs with the zoom level in the corner cluster - both answer
          "where am I", and splitting them frees this slot to stay put while you
          move the pointer around. */}
      {interactive && selectedBlock && (
        <div className="fixed bottom-[124px] left-3 z-30 w-60">
          <div className="rounded-card bg-paper-0/95 p-4 shadow-2xl shadow-black/15 ring-[1.5px] ring-black/15 backdrop-blur-md">
            <SelectedBlockCard
              block={selectedBlock}
              name={
                blockTypes.find((type) => type.id === selectedBlock.typeId)?.name ??
                selectedBlock.typeId
              }
              tradeoff={
                blockTypes.find((type) => type.id === selectedBlock.typeId)?.tradeoffs[0] ?? null
              }
              lineLength={selectedLineLength}
              onRemove={() => {
                layout.remove(selectedBlock.id);
                setSelectedCell(null);
              }}
              onDismiss={() => setSelectedCell(null)}
            />
          </div>
        </div>
      )}

      {/* ------------------------------------------------- the service dock */}
      {interactive && (
        <ServiceDock
          blockTypes={blockTypes}
          armedTypeId={armedTypeId}
          onArm={setArmedTypeId}
          onDragStateChange={setDraggingTypeId}
          remaining={layout.budget - layout.blocksUsed}
        />
      )}

      {/* ------------------------------------------------- floating windows */}
      {children}
    </CityWorkspaceContext.Provider>
  );
}

function SelectedBlockCard({
  block,
  name,
  tradeoff,
  lineLength,
  onRemove,
  onDismiss,
}: {
  block: PlacedBlock;
  name: string;
  tradeoff: string | null;
  /** Squares that go when this one does - >1 only for a road, which deletes per line. */
  lineLength: number;
  onRemove: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className="grid size-9 shrink-0 place-items-center rounded-xl text-base"
          style={{
            backgroundColor: `${blockColor(block.typeId)}26`,
            boxShadow: `inset 0 0 0 1.5px ${blockColor(block.typeId)}`,
          }}
        >
          {blockGlyph(block.typeId)}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-ink">{name}</span>
          <span className="block text-xs text-muted">
            Cell ({block.x}, {block.y})
          </span>
        </span>
      </div>

      {tradeoff && <p className="text-xs text-muted">{tradeoff}</p>}
      <p className="text-xs text-faint">Click an empty cell to move it here.</p>

      <div className="flex gap-2">
        <Button size="sm" variant="danger" onClick={onRemove}>
          {lineLength > 1 ? `Remove line (${lineLength})` : 'Remove'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          Done
        </Button>
      </div>
    </div>
  );
}
