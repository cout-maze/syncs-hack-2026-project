import type { BlockChange, City } from '@rmc/shared';

/**
 * THE MAP CONTRACT
 * ================
 * FE #1 owns the Phaser scene. Simulation mode (FE #2) and Proposal mode (FE #3) drive
 * it through this interface only - they never import the scene class. Both modes render
 * the same map, so this is the one seam between them.
 *
 * Agreed end of day 1 per docs/01 and docs/02. If you need something added here,
 * say so in the team channel first: it is a cross-workstream change.
 *
 * Usage from another feature:
 *
 *   const scene = useCityScene();          // null until the map workspace has mounted
 *   await scene?.animateResident({ personaId: 'wheelchair_user', pathBlockIds });
 *   scene?.setBlockState(blockId, 'flooded');
 *   scene?.previewChanges(proposal.changes ?? []);
 */

/** How a placed block is drawn. `normal` is the default; the rest are simulation states. */
export type BlockVisualState =
  | 'normal'
  | 'highlighted'
  | 'flooded'
  | 'offline'
  | 'dimmed'
  | 'invalid';

export interface AnimateResidentOptions {
  /** Drives the resident's glyph and colour. */
  personaId: string;
  /** Ordered placed-block ids, as produced by the sim engine's `Journey.pathBlockIds`. */
  pathBlockIds: string[];
  /** Total travel time for the whole path. Defaults to 240ms per hop. */
  durationMs?: number;
  /** Draw the route behind the walker while it moves. Default true. */
  trail?: boolean;
}

/**
 * One leg of a journey, as drawn on the map. `minutes` is already through the
 * persona multiplier, so the label on the leg is the number the panel adds up.
 */
export interface JourneyOverlayStep {
  minutes: number;
  /** Drawn as the fast leg - it began or ended on a transport block. */
  transport: boolean;
}

/**
 * A journey drawn over the streets: the route, what each leg cost, and whether
 * the total clears the threshold it was checked against.
 *
 * This is the journey cost model (feature proposal, § 7.1) made visible - the map
 * is where a travel time stops being a number in a panel and becomes a line you
 * can see going the long way round. Produced by
 * `simulation/engine/journeyCost.ts`.
 */
export interface JourneyOverlay {
  personaId: string;
  /** Ordered grid cells, origin first. One longer than `steps`. */
  cells: Array<{ x: number; y: number }>;
  steps: JourneyOverlayStep[];
  totalMinutes: number;
  thresholdMinutes: number;
  accessible: boolean;
}

export interface CitySceneApi {
  /* ---------------------------------------------------------- FE #1 (owner) */

  /** Replace the rendered layout. Called by the builder whenever local state changes. */
  setCity(city: Pick<City, 'gridWidth' | 'gridHeight' | 'blocks'>): void;

  /** Drag preview: show a translucent block on a cell, or clear it with null. */
  setGhost(ghost: { x: number; y: number; typeId: string; valid: boolean } | null): void;

  /** Outline a cell as the current selection, or clear it with null. */
  setSelectedCell(cell: { x: number; y: number } | null): void;

  /* ------------------------------------------------- FE #2 (simulation) */

  /** Light up a route. Pass an empty array to clear. */
  highlightPath(blockIds: string[]): void;

  /** Set one block's visual state - e.g. `flooded` during the flood event. */
  setBlockState(blockId: string, state: BlockVisualState): void;

  /** Reset every block to `normal` and clear any highlighted path. */
  clearStates(): void;

  /** Walk a resident along a route. Resolves when the walk finishes. */
  animateResident(options: AnimateResidentOptions): Promise<void>;

  /**
   * Draw one journey over the streets with its per-leg costs, or clear it with
   * null. Persistent: it stays until replaced, unlike animateResident's walker.
   */
  showJourney(overlay: JourneyOverlay | null): void;

  /** Walk a resident along the journey currently shown. No-op if there is none. */
  walkJourney(): Promise<void>;

  /** Remove every resident currently walking. */
  clearResidents(): void;

  /* ---------------------------------------------- FE #3 (Proposal mode) */

  /**
   * Show what a proposal WOULD do to the city: additions drawn as translucent ghosts,
   * removals dimmed. The city itself is untouched - this is a preview, not an edit.
   *
   * Simulation mode's auto-proposals emit the same `BlockChange[]`, so a simulated
   * change and a real one preview identically.
   */
  previewChanges(changes: BlockChange[]): void;

  /** Drop the preview and show the city as it actually is. */
  clearPreview(): void;

  /** Draw attention to a grid cell - used for "show this proposal on the map". */
  pulseCell(cell: { x: number; y: number }, options?: { color?: string; repeats?: number }): void;
}

/* ------------------------------------------------------------------ registry */

/**
 * The scene lives inside the shared map workspace. Rather than prop-drilling through
 * every feature, it registers itself here and anyone can look it up. Always null-check:
 * the scene may not have mounted yet.
 */
let currentScene: CitySceneApi | null = null;
const listeners = new Set<(scene: CitySceneApi | null) => void>();

export function registerCityScene(scene: CitySceneApi | null): void {
  currentScene = scene;
  for (const listener of listeners) listener(scene);
}

export function getCityScene(): CitySceneApi | null {
  return currentScene;
}

export function subscribeToCityScene(listener: (scene: CitySceneApi | null) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
