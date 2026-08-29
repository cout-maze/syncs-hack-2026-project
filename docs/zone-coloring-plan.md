# Implementation plan: post-simulation zone coloring on the map

**Status:** not started. This is a self-contained spec for an agent with no prior context
on this conversation — it names every file, function and data shape it needs.

## Goal

After a simulation run, colour the map so a viewer can tell at a glance which parts of the
city are well served and which aren't — red for "pain zones" (houses that fail most of
their trips), green for "good zones" (houses that succeed at most of theirs) — instead of
having to scroll the Journeys list line by line. This is a pure rendering feature: it adds
a colour wash to the existing map, it does not change any simulation data or metric.

Toggled on after a run in Simulation mode, cleared when the city changes underneath it.

## What already exists (read these before writing code)

- **The map contract** — [web/src/features/builder/scene/sceneApi.ts](../web/src/features/builder/scene/sceneApi.ts).
  `CitySceneApi` is the only way any feature drives the Phaser scene; FE #2/#3 never import
  the scene class directly. Existing methods to model the new ones on:
  `setBlockState(blockId, state)`, `previewChanges(changes)` / `clearPreview()`.
- **The scene implementation** — [web/src/features/builder/scene/CityScene.ts](../web/src/features/builder/scene/CityScene.ts)
  (~1000 lines). Relevant existing patterns:
  - `DEPTH` (top of file) — a small object of z-index constants (`ground: 0, overlay: 1,
    blocks: 10, ...`). Extra `Graphics` layers each get their own depth and are created
    once in `create()` — see `this.groundGfx`, `this.ghostGfx`, `this.previewGfx` and their
    `this.add.graphics().setDepth(...)` initialization around line 161-167.
  - `cellToScreen(x, y)` (from `./isometric`) converts a grid cell to game-space pixel
    coordinates — used everywhere blocks are positioned.
  - `fillDiamond(gfx, cx, cy, inset)` / `strokeDiamond(...)` (private methods, ~line 950+)
    draw the isometric tile shape other overlays already use (see `pulseCell`,
    `drawGhost`, `drawPreview` for worked examples of a translucent colour wash on a cell).
  - `toPhaserColor(hex: string): number` (from `@/lib/visuals`) converts a `#rrggbb` string
    to Phaser's `0xRRGGBB` number format.
- **The scene hook** — [web/src/features/builder/scene/useCityScene.ts](../web/src/features/builder/scene/useCityScene.ts).
  `const scene = useCityScene();` returns `CitySceneApi | null` (null until the map has
  mounted) from any feature component.
- **The colour vocabulary** — [web/src/lib/visuals.ts](../web/src/lib/visuals.ts) and the
  CSS custom properties in [web/src/styles/index.css](../web/src/styles/index.css). There
  are already three semantic tokens for exactly this purpose:
  `--color-bad: #f2616b` (red), `--color-warn: #f0b429` (amber),
  `--color-good: #57c98a` (green). **Reuse these**, don't invent new hex values.
- **The simulation data** — `SimulationResultInput.journeys: Journey[]`
  (`shared/src/city.ts`). Each `Journey` has `fromBlockId: string | null`,
  `targetService: string`, `accessible: boolean`. As of the current engine
  ([web/src/features/simulation/engine/journeys.ts](../web/src/features/simulation/engine/journeys.ts)),
  there is **no persona** — a journey is one housing block's trip to one service type.
  Every housing block gets exactly 8 journeys (one per non-housing block type: healthcare,
  education, transport, park, community_hub, technology_hub, shared_resource_hub,
  culture_heritage). This is exactly the data a per-house score needs — no engine changes
  required for this feature.
- **Where the engine gets called from** — [web/src/features/simulation/SimulationMode.tsx](../web/src/features/simulation/SimulationMode.tsx).
  `handleRun()` calls `runSimulation(...)`, then `detectIssues(...)`, then
  `setRun(next)`. This is where the new zone-scoring call gets added. The file's own
  header comment currently says "Still to finish: the animated run through the map
  contract" — this feature is part of that unfinished integration.

## Design

### 1. Score computation (new file: `web/src/features/simulation/engine/zones.ts`)

Pure function, sibling to `issues.ts` — same style, no React, no Phaser:

```ts
import type { SimulationResultInput } from '@rmc/shared';

/** blockId -> 0-100. Share of that house's 8 service journeys that are accessible. */
export function computeZoneScores(result: SimulationResultInput): Record<string, number> {
  const totals = new Map<string, { accessible: number; total: number }>();

  for (const journey of result.journeys) {
    if (!journey.fromBlockId) continue;
    const entry = totals.get(journey.fromBlockId) ?? { accessible: 0, total: 0 };
    entry.total += 1;
    if (journey.accessible) entry.accessible += 1;
    totals.set(journey.fromBlockId, entry);
  }

  const scores: Record<string, number> = {};
  for (const [blockId, entry] of totals) {
    scores[blockId] = entry.total === 0 ? 0 : Math.round((entry.accessible / entry.total) * 100);
  }
  return scores;
}
```

One sentence, matching the project's "simple and explainable" formula convention used
throughout `engine/metrics.ts`: *a house's zone score is the percentage of its service
trips that succeed.*

### 2. Colour mapping (add to `web/src/lib/visuals.ts`, next to `metricColor`/`blockColor`)

Two-segment interpolation through the three existing semantic tokens — red at 0, amber at
50, green at 100:

```ts
const ZONE_STOPS: Array<{ at: number; color: [number, number, number] }> = [
  { at: 0, color: [0xf2, 0x61, 0x6b] },   // --color-bad
  { at: 50, color: [0xf0, 0xb4, 0x29] },  // --color-warn
  { at: 100, color: [0x57, 0xc9, 0x8a] }, // --color-good
];

/** 0-100 accessibility score -> a red/amber/green hex colour, matching the semantic tokens. */
export function zoneColor(score: number): string {
  const clamped = Math.max(0, Math.min(100, score));
  const [lo, hi] = clamped <= 50 ? [ZONE_STOPS[0], ZONE_STOPS[1]] : [ZONE_STOPS[1], ZONE_STOPS[2]];
  const t = clamped <= 50 ? clamped / 50 : (clamped - 50) / 50;
  const mix = (a: number, b: number) => Math.round(a + (b - a) * t);
  const [r, g, b] = [
    mix(lo!.color[0], hi!.color[0]),
    mix(lo!.color[1], hi!.color[1]),
    mix(lo!.color[2], hi!.color[2]),
  ];
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}
```

(Adjust to the file's existing style/lint conventions — this is the algorithm, not
required-verbatim code.)

### 3. Scene contract (`web/src/features/builder/scene/sceneApi.ts`)

Add two methods to `CitySceneApi`, grouped under the existing `FE #2 (simulation)`
section:

```ts
/**
 * Colour-wash housing blocks by a 0-100 score - red (struggling) to green (well served).
 * Pass the score for every housing block you have one for; blocks with no entry are left
 * uncoloured. Call again after each run to refresh; setCity()/a new run should clear first.
 */
setZoneScores(scores: Record<string, number>): void;

/** Remove the zone colouring. */
clearZoneScores(): void;
```

Update the file's top-of-file usage comment to mention it alongside the existing
`previewChanges`/`setBlockState` examples.

### 4. Scene implementation (`CityScene.ts`)

- New private fields: `private zoneGfx!: Phaser.GameObjects.Graphics;` and
  `private zoneScores: Record<string, number> = {};`
- New `DEPTH` entry, between `ground` and `blocks`: `zone: 2,` (renders over the street
  pattern, under every building — same relationship `previewGfx` has to `ghostGfx`).
- In `create()`, alongside the other graphics layers:
  `this.zoneGfx = this.add.graphics().setDepth(DEPTH.zone);`
- New methods:

```ts
setZoneScores(scores: Record<string, number>): void {
  this.zoneScores = scores;
  if (this.ready) this.drawZones();
}

clearZoneScores(): void {
  this.zoneScores = {};
  if (this.ready) this.zoneGfx.clear();
}

private drawZones(): void {
  this.zoneGfx.clear();
  for (const block of this.blocks) {
    if (block.typeId !== 'housing') continue;
    const score = this.zoneScores[block.id];
    if (score === undefined) continue;

    const centre = cellToScreen(block.x, block.y);
    const color = toPhaserColor(zoneColor(score));

    this.zoneGfx.setPosition(centre.x, centre.y);
    // A wider, low-alpha wash than the plot itself, so neighbouring same-scored houses'
    // washes overlap and read as one coloured zone rather than isolated dots.
    this.zoneGfx.fillStyle(color, 0.32);
    this.fillDiamond(this.zoneGfx, 0, 0, -12); // negative inset = larger than the tile
  }
  this.zoneGfx.setPosition(0, 0);
}
```

Call `this.drawZones()` at the end of `renderCity()` too (guarded by
`Object.keys(this.zoneScores).length > 0`), so panning/rebuilding the map doesn't drop the
overlay while it's active. Also call `this.zoneGfx.clear()` inside `setCity()` when the
grid dimensions change (mirrors how `fitToGrid()` is already triggered there) — a stale
zone overlay pointing at cells from a different-sized city would be wrong.

**Note on `fillDiamond`'s inset parameter**: check the actual signature before using a
negative value — `fillDiamond(gfx, cx, cy, inset)` computes `halfW = TILE_WIDTH/2 - inset`,
so a *negative* inset does produce a *larger* diamond, which is the intended effect here,
but confirm this against the current implementation rather than assuming — the codebase
has changed this file's internals more than once already.

### 5. Wire it into Simulation mode (`SimulationMode.tsx`)

- Import `useCityScene` from `@/features/builder/scene/useCityScene` and
  `computeZoneScores` from `./engine/zones`.
- `const scene = useCityScene();` inside `SimulationPanel`.
- Inside `handleRun`'s success path (after `setRun(next)`), call
  `scene?.setZoneScores(computeZoneScores(next));`
- Inside `handleGenerate` and the `catch` block of `handleRun`, call
  `scene?.clearZoneScores();` — a new/failed run shouldn't leave a stale overlay from the
  previous one.
- Add a small toggle so the overlay isn't forced on: a `showZones` boolean state
  (`useState(true)` is a reasonable default once a run exists), a checkbox/switch near the
  "Simulation" card header, and an effect or inline check that calls
  `scene?.setZoneScores(...)` / `scene?.clearZoneScores()` when the toggle flips.
- **Accessibility**: don't rely on colour alone. Add a small legend (three swatches or a
  gradient bar with "Struggling" / "Well served" labels) near the toggle, and consider a
  hover tooltip on the map cells showing the raw score — check what hover affordance
  already exists on the grid (`CityCanvas.tsx`'s `onCellHover`) before building a new one.

## Files

**New**: `web/src/features/simulation/engine/zones.ts`

**Modified**: `web/src/lib/visuals.ts` (add `zoneColor`), `web/src/features/builder/scene/sceneApi.ts`
(add `setZoneScores`/`clearZoneScores` to `CitySceneApi`), `web/src/features/builder/scene/CityScene.ts`
(implement them + the `zone` depth layer), `web/src/features/simulation/SimulationMode.tsx`
(wire the call + toggle + legend).

## Explicitly out of scope for this pass (note if tempted to add)

- **Interpolating colour across empty/non-housing cells** to produce a true continuous
  heatmap (rather than a wash centred on each house) is a real enhancement but a much
  bigger job — it needs a spatial interpolation pass (e.g. inverse-distance weighting from
  housing scores) across every grid cell, not just the housing ones. Don't build this
  unless asked; the overlapping-wash approach above already reads as "zones" at normal
  city density without it.
- **Showing zones in Proposal mode's map preview** — this plan is Simulation-mode only.
  `previewChanges`/`clearPreview` (Proposal mode's existing overlay) is a separate concern;
  don't couple the two without an explicit ask.
- **Persisting the toggle state** — a fresh page load can default it to off; no need to
  remember the user's preference across sessions.

## Verification

1. `npm run typecheck` / `npm run build` — must stay clean.
2. Unit-level sanity: call `computeZoneScores` on a small hand-built `SimulationResultInput`
   (e.g. one house with 8 journeys, 6 accessible) and confirm it returns `75` for that
   `fromBlockId`. Confirm a journey with `fromBlockId: null` (shouldn't occur in practice,
   but the type allows it) is skipped, not counted as a phantom block.
3. Visual check: run the dev server, sign in as `demo@city.dev` / `demo1234`, go to
   Simulation mode, click "Run simulation", confirm housing blocks pick up a red/amber/green
   wash consistent with their accessibility (spot-check one obviously-struggling house
   against the Journeys list further down the same page). Toggle the legend/checkbox off
   and confirm the wash disappears; click "Generate a city" and confirm no stale wash from
   the previous run briefly flashes on the new layout.
4. Resize the city (via "Generate a city" onto a different-sized grid, if that's exercised
   elsewhere) and confirm the overlay doesn't paint zones at stale coordinates.
