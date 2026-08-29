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
 *   scene?.setZoneScores(scores);
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

export interface CitySceneApi {
  /* ---------------------------------------------------------- FE #1 (owner) */

  /** Replace the rendered layout. Called by the builder whenever local state changes. */
  setCity(city: Pick<City, 'gridWidth' | 'gridHeight' | 'blocks'>): void;

  /** Drag preview: show a translucent block on a cell, or clear it with null. */
  setGhost(ghost: { x: number; y: number; typeId: string; valid: boolean } | null): void;

  /** Outline a cell as the current selection, or clear it with null. */
  setSelectedCell(cell: { x: number; y: number } | null): void;

  /** Re-fit and re-centre the camera after the user has panned or zoomed away. */
  resetView(): void;

  /* ------------------------------------------------- FE #2 (simulation) */

  /** Light up a route. Pass an empty array to clear. */
  highlightPath(blockIds: string[]): void;

  /** Set one block's visual state - e.g. `flooded` during the flood event. */
  setBlockState(blockId: string, state: BlockVisualState): void;

  /** Reset every block to `normal` and clear any highlighted path. */
  clearStates(): void;

  /** Walk a resident along a route. Resolves when the walk finishes. */
  animateResident(options: AnimateResidentOptions): Promise<void>;

  /** Remove every resident currently walking. */
  clearResidents(): void;

  /** Colour-wash housing blocks by their 0-100 service accessibility score. */
  setZoneScores(scores: Record<string, number>): void;

  /** Remove the zone colouring. */
  clearZoneScores(): void;

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

  /* --------------------------------------------------------- Access mode */

  /**
   * Trace a route as a line across the cells it actually crosses - grass, parks,
   * whatever's in between, not just the buildings on it (that's `highlightPath`).
   * Every block that isn't in `endpointBlockIds` (the home and the destination) is
   * dimmed to half opacity, so the two ends of the trip read at full contrast against
   * everything else. Pass null to clear.
   */
  traceRoute(route: { cells: Array<{ x: number; y: number }>; endpointBlockIds: string[] } | null): void;
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

/**
 * A second, independent registry for the council map's scene (Proposal mode). It is
 * deliberately never registered here via `registerCityScene` - the two maps show
 * different cities and must stay addressable separately. Access mode is the only
 * other consumer, for its route trace: `useCouncilScene()` mirrors `useCityScene()`.
 *
 * This lives in module state rather than the shared workspace context on purpose: the
 * scene is a live, mutable class instance, and storing it in a context value forces the
 * whole provider to re-render (and re-diff that instance) on every mount/click. An
 * external store sidesteps that the same way the primary registry above already does.
 */
let currentCouncilScene: CitySceneApi | null = null;
const councilListeners = new Set<(scene: CitySceneApi | null) => void>();

export function registerCouncilScene(scene: CitySceneApi | null): void {
  currentCouncilScene = scene;
  for (const listener of councilListeners) listener(scene);
}

export function getCouncilScene(): CitySceneApi | null {
  return currentCouncilScene;
}

export function subscribeToCouncilScene(listener: (scene: CitySceneApi | null) => void): () => void {
  councilListeners.add(listener);
  return () => councilListeners.delete(listener);
}
