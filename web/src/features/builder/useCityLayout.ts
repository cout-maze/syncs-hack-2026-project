import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  BlockChange,
  BlockType,
  City,
  PlacedBlock,
  PlacedBlockInput,
} from '@rmc/shared';
import { useReplaceBlocks } from '@/lib/api/hooks';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/api/errors';
import type { Cell } from './scene/isometric';

/**
 * Local layout state plus debounced autosave - FE #1's primary save path.
 *
 * The rule from docs/01: mutate local state instantly so dragging feels immediate,
 * autosave the whole layout about a second later, and on a 409 roll back to the last
 * layout the server accepted and show `error.message`.
 */

const AUTOSAVE_DELAY_MS = 900;

const CARDINAL_STEPS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * Shortest 4-directional route from `start` to `end`, routing around any cell
 * `isBlocked` rejects - for drawing a road that finds its way past buildings instead
 * of refusing to draw at all. Unweighted grid, so a plain BFS already gives the
 * shortest path; `start` and `end` are assumed passable (the caller validates that
 * before asking for a route). Null if nothing connects them at all.
 */
function findGridPath(
  start: Cell,
  end: Cell,
  gridWidth: number,
  gridHeight: number,
  isBlocked: (cell: Cell) => boolean,
): Cell[] | null {
  const key = (cell: Cell) => cell.y * gridWidth + cell.x;
  const startKey = key(start);
  const endKey = key(end);

  if (startKey === endKey) return [start];

  const cameFrom = new Map<number, number>();
  const cellByKey = new Map<number, Cell>([[startKey, start]]);
  const queue: Cell[] = [start];

  for (let i = 0; i < queue.length; i += 1) {
    const current = queue[i]!;
    const currentKey = key(current);
    if (currentKey === endKey) break;

    for (const [dx, dy] of CARDINAL_STEPS) {
      const next = { x: current.x + dx, y: current.y + dy };
      if (next.x < 0 || next.y < 0 || next.x >= gridWidth || next.y >= gridHeight) continue;

      const nextKey = key(next);
      if (cellByKey.has(nextKey)) continue;
      if (isBlocked(next)) continue;

      cellByKey.set(nextKey, next);
      cameFrom.set(nextKey, currentKey);
      queue.push(next);
    }
  }

  if (!cellByKey.has(endKey) || (endKey !== startKey && !cameFrom.has(endKey))) return null;

  const path: Cell[] = [];
  let cursor = endKey;
  while (cursor !== startKey) {
    path.push(cellByKey.get(cursor)!);
    const previous = cameFrom.get(cursor);
    if (previous === undefined) return null; // unreachable - shouldn't happen, but be safe
    cursor = previous;
  }
  path.push(start);
  path.reverse();
  return path;
}

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

export function useCityLayout(city: City | undefined, blockTypes: BlockType[]) {
  const toast = useToast();
  const save = useReplaceBlocks(city?.id ?? '');

  const [blocks, setBlocks] = useState<PlacedBlock[]>([]);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  /** Increments for every local layout edit and resets when a different city loads. */
  const [layoutRevision, setLayoutRevision] = useState(0);

  const lastGoodRef = useRef<PlacedBlock[]>([]);
  const timerRef = useRef<number | null>(null);
  const loadedCityRef = useRef<string | null>(null);
  /** Bumped on every local edit so a slow save cannot clobber newer changes. */
  const editSeqRef = useRef(0);
  const tempIdRef = useRef(0);

  const costOf = useCallback(
    (typeId: string) => blockTypes.find((type) => type.id === typeId)?.cost ?? 1,
    [blockTypes],
  );

  const blocksUsed = useMemo(
    () => blocks.reduce((sum, block) => sum + costOf(block.typeId), 0),
    [blocks, costOf],
  );

  const budget = city?.blockBudget ?? 0;

  // Adopt server state when the active city changes. After that the local layout is
  // authoritative until a save round-trips.
  useEffect(() => {
    if (!city || loadedCityRef.current === city.id) return;

    // A debounced save or an older request may still belong to the previous city.
    // Cancel the debounce and advance the edit sequence so its callbacks cannot
    // overwrite the newly selected city's layout when they eventually resolve.
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    editSeqRef.current += 1;

    loadedCityRef.current = city.id;
    setBlocks(city.blocks);
    setLayoutRevision(0);
    lastGoodRef.current = city.blocks;
    setSaveState('idle');
  }, [city]);

  const flush = useCallback(
    (next: PlacedBlock[]) => {
      if (!city) return;
      const seqAtSave = editSeqRef.current;
      setSaveState('saving');

      save.mutate(
        next.map(({ typeId, x, y }) => ({ typeId, x, y })),
        {
          onSuccess: (serverCity) => {
            // Only adopt server ids if nothing changed while the request was in flight.
            if (editSeqRef.current === seqAtSave) {
              setBlocks(serverCity.blocks);
              lastGoodRef.current = serverCity.blocks;
              setSaveState('saved');
            }
          },
          onError: (error) => {
            // A slower request for an older edit must not roll back a newer local
            // layout. The newer edit already has its own debounced save scheduled.
            if (editSeqRef.current !== seqAtSave) return;
            setBlocks(lastGoodRef.current);
            setSaveState('error');
            toast.error(errorMessage(error, 'That change could not be saved.'));
          },
        },
      );
    },
    [city, save, toast],
  );

  /** Replace the layout locally and schedule an autosave. */
  const commit = useCallback(
    (next: PlacedBlock[]) => {
      editSeqRef.current += 1;
      setLayoutRevision((revision) => revision + 1);
      setBlocks(next);
      setSaveState('dirty');

      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        flush(next);
      }, AUTOSAVE_DELAY_MS);
    },
    [flush],
  );

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  /* ------------------------------------------------------------- mutations */

  const blockAt = useCallback(
    (cell: Cell) => blocks.find((block) => block.x === cell.x && block.y === cell.y) ?? null,
    [blocks],
  );

  /** Would this placement be accepted? Mirrors the server rules so the ghost is honest. */
  const canPlace = useCallback(
    (cell: Cell, typeId: string) => {
      if (!city) return false;
      if (cell.x < 0 || cell.y < 0 || cell.x >= city.gridWidth || cell.y >= city.gridHeight) {
        return false;
      }
      if (blockAt(cell)) return false;
      return blocksUsed + costOf(typeId) <= budget;
    },
    [city, blockAt, blocksUsed, costOf, budget],
  );

  const place = useCallback(
    (cell: Cell, typeId: string) => {
      if (!city) return;

      if (blockAt(cell)) {
        toast.error('There is already a block on that cell.');
        return;
      }
      if (blocksUsed + costOf(typeId) > budget) {
        toast.error(`Placing this block would exceed the ${budget}-block budget.`);
        return;
      }

      tempIdRef.current += 1;
      commit([...blocks, { id: `tmp_${tempIdRef.current}`, typeId, x: cell.x, y: cell.y }]);
    },
    [city, blocks, blockAt, blocksUsed, costOf, budget, commit, toast],
  );

  /**
   * Place every cell of a drawn line (e.g. a transport corridor's start-to-end run) as
   * one edit, so it lands and autosaves atomically rather than block-by-block.
   */
  const placeMany = useCallback(
    (cells: Cell[], typeId: string) => {
      if (!city || cells.length === 0) return;

      const seen = new Set<string>();
      const unique = cells.filter((cell) => {
        const key = `${cell.x},${cell.y}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      // A cell already holding the same type - connecting a new road to an existing
      // one, most often - is fine to skip over. Only a genuinely different block in
      // the way (a building the line would have to run through) is a real conflict.
      const blocked = unique.some((cell) => {
        const existing = blockAt(cell);
        return existing && existing.typeId !== typeId;
      });
      if (blocked) {
        toast.error('There is already a different block somewhere along that line.');
        return;
      }

      const toPlace = unique.filter((cell) => !blockAt(cell));
      if (toPlace.length === 0) return; // the whole line already exists

      if (blocksUsed + costOf(typeId) * toPlace.length > budget) {
        toast.error(`Placing this line would exceed the ${budget}-block budget.`);
        return;
      }

      const next = [...blocks];
      for (const cell of toPlace) {
        tempIdRef.current += 1;
        next.push({ id: `tmp_${tempIdRef.current}`, typeId, x: cell.x, y: cell.y });
      }
      commit(next);
    },
    [city, blocks, blockAt, blocksUsed, costOf, budget, commit, toast],
  );

  /**
   * Route from `start` to `end` that steps around anything that isn't `typeId` or
   * empty ground - drawing a road no longer fails just because a building sits on the
   * straight line between the two clicks. Null (with a toast) when nothing connects
   * them at all, e.g. `start` is walled in.
   */
  const findRoadPath = useCallback(
    (start: Cell, end: Cell, typeId: string): Cell[] | null => {
      if (!city) return null;

      const isBlocked = (cell: Cell) => {
        const existing = blockAt(cell);
        return Boolean(existing && existing.typeId !== typeId);
      };
      const path = findGridPath(start, end, city.gridWidth, city.gridHeight, isBlocked);
      if (!path) toast.error('No path to that point - it looks fully boxed in.');
      return path;
    },
    [city, blockAt, toast],
  );

  const move = useCallback(
    (blockId: string, cell: Cell) => {
      const existing = blockAt(cell);
      if (existing && existing.id !== blockId) {
        toast.error('There is already a block on that cell.');
        return;
      }
      commit(
        blocks.map((block) => (block.id === blockId ? { ...block, x: cell.x, y: cell.y } : block)),
      );
    },
    [blocks, blockAt, commit, toast],
  );

  const remove = useCallback(
    (blockId: string) => commit(blocks.filter((block) => block.id !== blockId)),
    [blocks, commit],
  );

  const clear = useCallback(() => commit([]), [commit]);

  /**
   * Replace the whole layout in one edit - the save path for a generated city.
   * Blocks arrive without ids (nothing has been placed yet), so mint temporary ones and
   * let the autosave round-trip swap in the server's.
   */
  const replaceAll = useCallback(
    (next: PlacedBlockInput[]) => {
      commit(
        next.map((block) => {
          tempIdRef.current += 1;
          return { id: `tmp_${tempIdRef.current}`, ...block };
        }),
      );
    },
    [commit],
  );

  /**
   * Apply a proposal's block delta to the map in one edit.
   *
   * Shared by Simulation mode ("apply this auto-proposal") and Proposal mode
   * ("adopt an approved proposal"), so the two modes change the city the same way.
   * Returns false and toasts if the change does not fit - the caller can leave its
   * card in place so the user can try a different one.
   */
  const applyChanges = useCallback(
    (changes: BlockChange[]) => {
      if (!city) return false;

      let next = blocks;
      let used = blocksUsed;

      for (const change of changes) {
        const occupant = next.find((block) => block.x === change.x && block.y === change.y);

        if (change.op === 'remove' || change.op === 'move') {
          const target = change.blockId
            ? next.find((block) => block.id === change.blockId)
            : occupant;
          if (!target) continue;

          if (change.op === 'remove') {
            next = next.filter((block) => block.id !== target.id);
            used -= costOf(target.typeId);
            continue;
          }

          if (occupant && occupant.id !== target.id) {
            toast.error('That change needs a cell that is already taken.');
            return false;
          }
          next = next.map((block) =>
            block.id === target.id ? { ...block, x: change.x, y: change.y } : block,
          );
          continue;
        }

        // place
        if (!change.typeId) continue;
        if (occupant) {
          toast.error('That change needs a cell that is already taken.');
          return false;
        }
        if (
          change.x < 0 ||
          change.y < 0 ||
          change.x >= city.gridWidth ||
          change.y >= city.gridHeight
        ) {
          return false;
        }
        used += costOf(change.typeId);
        if (used > budget) {
          toast.error(`That change would exceed the ${budget}-block budget.`);
          return false;
        }

        tempIdRef.current += 1;
        next = [
          ...next,
          { id: `tmp_${tempIdRef.current}`, typeId: change.typeId, x: change.x, y: change.y },
        ];
      }

      commit(next);
      return true;
    },
    [city, blocks, blocksUsed, costOf, budget, commit, toast],
  );

  return {
    blocks,
    layoutRevision,
    blocksUsed,
    budget,
    saveState,
    costOf,
    blockAt,
    canPlace,
    place,
    placeMany,
    findRoadPath,
    move,
    remove,
    clear,
    replaceAll,
    applyChanges,
  };
}
