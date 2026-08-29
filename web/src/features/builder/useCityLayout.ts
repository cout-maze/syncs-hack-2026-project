import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BlockChange, BlockType, City, PlacedBlock } from '@rmc/shared';
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
 *
 * DRAFT MODE is the exception. Proposal mode authors a change by editing this map, but a
 * proposal is a change the community has *not* agreed to yet - so while a draft is open
 * the autosave is suspended and the edits exist only on screen. `endDraft()` puts the map
 * back. Without this the autosave would build the block before anyone voted on it, and
 * the composer's diff against the saved city would come out empty.
 */

const AUTOSAVE_DELAY_MS = 900;

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

export function useCityLayout(city: City | undefined, blockTypes: BlockType[]) {
  const toast = useToast();
  const save = useReplaceBlocks(city?.id ?? '');

  const [blocks, setBlocks] = useState<PlacedBlock[]>([]);
  const [saveState, setSaveState] = useState<SaveState>('idle');

  const lastGoodRef = useRef<PlacedBlock[]>([]);
  /** Synchronous read of the current layout, for callbacks that must not go stale. */
  const blocksRef = useRef<PlacedBlock[]>([]);
  blocksRef.current = blocks;
  const timerRef = useRef<number | null>(null);
  const loadedCityRef = useRef<string | null>(null);
  /** Bumped on every local edit so a slow save cannot clobber newer changes. */
  const editSeqRef = useRef(0);
  const tempIdRef = useRef(0);

  /** The layout as it was when the draft opened, and where endDraft() returns to. */
  const [draftBaseline, setDraftBaseline] = useState<PlacedBlock[] | null>(null);
  const draftBaselineRef = useRef<PlacedBlock[] | null>(null);
  const draftingRef = useRef(false);

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
    loadedCityRef.current = city.id;
    setBlocks(city.blocks);
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
      setBlocks(next);

      // A draft is a proposal, not an edit: it never reaches the server.
      if (draftingRef.current) return;

      setSaveState('dirty');

      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        flush(next);
      }, AUTOSAVE_DELAY_MS);
    },
    [flush],
  );

  /**
   * Start editing the map as a proposal. Any autosave already queued is dropped, so the
   * first draft edit cannot ride along with it.
   */
  const beginDraft = useCallback(() => {
    if (draftingRef.current) return;
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    draftingRef.current = true;
    draftBaselineRef.current = blocksRef.current;
    setDraftBaseline(blocksRef.current);
  }, []);

  /**
   * Close the draft. By default the map goes back to how it was - the proposal carries
   * the change now, and the city only changes if the community approves it.
   */
  const endDraft = useCallback((options: { keepEdits?: boolean } = {}) => {
    if (!draftingRef.current) return;
    draftingRef.current = false;

    const baseline = draftBaselineRef.current;
    draftBaselineRef.current = null;
    setDraftBaseline(null);

    if (!options.keepEdits && baseline) {
      editSeqRef.current += 1;
      setBlocks(baseline);
      setSaveState('idle');
    }
  }, []);

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
    blocksUsed,
    budget,
    saveState,
    costOf,
    blockAt,
    canPlace,
    place,
    move,
    remove,
    clear,
    applyChanges,
    /* -------------------------------------------------- proposal drafting */
    beginDraft,
    endDraft,
    isDrafting: draftBaseline !== null,
    /** What the draft started from - diff against this to get the proposal's changes. */
    draftBaseline,
  };
}
