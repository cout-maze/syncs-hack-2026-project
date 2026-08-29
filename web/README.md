# Frontend — The Missing Block

React + Phaser + Tailwind. **One map, floating windows.** The map fills the screen,
mounts once, and can be dragged and zoomed; everything else floats over it - the menu,
the service dock, the mode + budget cluster, and the Simulation and Proposal windows,
which can both be open at the same time and are dragged by their title bars. Three
workstreams share this app; the seams between them are described below. Read this
before you start your feature.

(The repo, the specs and `docs/` still say "Rebuild My City" - only the product name in
the UI has changed so far.)

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:5173 and sign in as **demo@city.dev / demo1234** (pre-filled in
mock mode). You get a seeded city — the deliberately flawed one from the demo script —
plus the 9 block types, 7 personas, and the default community-garden proposal (with two
more) already carrying seed votes.

Other scripts, all from the repo root:

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server on 5173 |
| `npm run typecheck` | `tsc --noEmit` across `shared/` and `web/` |
| `npm run build` | Typecheck + production build |
| `npm run lint:specs` | Redocly lint over `specs/*.yaml` |
| `npm run mock:city` (and `mock:auth`, `mock:proposals`, `mock:advisor`) | Prism mocks off the specs |

## Where the data comes from

`VITE_API_MODE` in `web/.env` picks the backend. Nothing else changes.

| Mode | What it means |
|---|---|
| `msw` (default) | In-browser mock backend. **Stateful** — placements, votes and simulation results persist in localStorage, so "reload the page and the city is still there" actually works. |
| `prism` | The four Prism processes. Spec-conformant but stateless; nothing you save comes back. |
| `real` | The Node backend from BE #1 / BE #2 at `VITE_API_URL`. |

The mocks live in `src/mocks/` and implement all four specs, including the error codes
the UI branches on (`BUDGET_EXCEEDED`, `CELL_OCCUPIED`, `PROPOSAL_CLOSED`, …). When the
real backend lands, flip the mode — if something breaks, the mock and the backend
disagree and one of them is wrong against the spec.

`__rmcResetMocks()` in the console wipes and reseeds the mock data.

## Who owns what

```
src/
├── app/            shell, menu, routing, active-city context        (FE #1)
├── auth/           login, register, token, route guard              (FE #1)
├── features/
│   ├── builder/    THE SHARED MAP WORKSPACE - both modes mount it   (FE #1)
│   ├── simulation/ THE ENGINE, auto-issues, auto-proposals, run UX  (FE #2)
│   ├── advisor/    City Advisor panel                               (FE #2)
│   └── proposals/  list, detail, ballot, results, authoring         (FE #3)
├── components/ui/  Button, Card, Badge, Field, MetricBar, Toast     (shared)
├── lib/            api client, hooks, tokens, colours, format       (shared)
└── mocks/          the in-browser backend                           (shared)
```

There is no `features/residents/`. Personas are engine inputs only - `usePersonas`
feeds the simulation and nothing renders them as a feature.

The shell mounts the map once and each mode reads it through a hook:

```tsx
export function SimulationMode() {
  // The map is mounted by the shell; this renders inside a floating window over it.
  return <SimulationPanel workspace={useCityWorkspace()} />;
}
```

`useCityWorkspace()` returns the same `{ city, blockTypes, layout }` it always did.

**How the two windows open.** The Simulation window is local state in `AppShell`,
because nothing inside it is addressable. The Proposal window is driven by the URL, so
`/propose/prp_garden1` still deep-links to one proposal and FE #3's navigate calls keep
working. Both float, and both can be open together.

Write panels as plain content, not as a page: the window supplies the padding, the
title bar and the close button, so a panel should not repeat its own name in a heading.

Anything marked `TODO(FE#n)` or badged "FE #n to build" in the UI is a deliberate
hand-off point, not an oversight.

## The three rules

**1. Never call `fetch` directly.** Use the hooks in `src/lib/api/hooks.ts`. They give
you shared caching, one polling implementation, and consistent errors. The client
validates every response against its Zod schema, so a backend that drifts from the spec
fails loudly in one place instead of quietly three components deep.

**2. Never hard-code an id, a metric name or a colour.** Import them from `@rmc/shared`
(ids, labels, thresholds) and `@/lib/visuals` (block and metric colours). The block-type,
persona and metric vocabularies are shared with the backend and the Advisor prompts —
`shared/src/constants.ts` is the frontend's copy of that contract. UI colours the same
way, from the Tailwind tokens in `src/styles/index.css` - never a bare hex in a
className. See "Colour: paper, ink, honey" below for what each token means.

**3. Drive the map through `CitySceneApi`, never the scene class.** See below.

## The map contract

FE #1 owns the Phaser scene. FE #2 and FE #3 talk to it through one interface, defined
in `src/features/builder/scene/sceneApi.ts`:

```ts
import { useCityScene } from '@/features/builder/scene/useCityScene';

const scene = useCityScene();          // null until the map workspace has mounted

scene?.highlightPath(journey.pathBlockIds);
scene?.setBlockState(blockId, 'flooded');
await scene?.animateResident({ personaId: 'wheelchair_user', pathBlockIds });
scene?.previewChanges(proposal.changes ?? []);   // "what this proposal would do"
scene?.clearPreview();
scene?.pulseCell({ x: 2, y: 6 });
scene?.clearStates();
```

Always null-check — the scene may not have mounted yet. If you need a method that isn't
there, say so in the team channel first: it's a cross-workstream change.

**A non-null scene means a drawn scene.** The scene registers itself at the end of
Phaser's `create()`, not when the game object is constructed, so anything you get back
from `useCityScene()` is ready to be driven. The intro curtain uses exactly that as its
"the map is up" signal.

The camera is yours to move: `scene.resetView()` re-fits and re-centres the city, which
is what the recentre control in the budget pill calls.

## The map is the screen

The Phaser canvas is sized with `Phaser.Scale.RESIZE`, so it always matches the viewport
1:1 - there is no fixed stage and no letterboxing. Fitting, panning and zooming are the
camera's job:

- **Fit.** On load and on every resize the camera zooms to show a readable window of
  the grid, leaving margins for the chrome (`MARGIN` in `CityScene`). The grid is
  30×30 (`DEFAULT_GRID_WIDTH`/`HEIGHT` in `shared/src/constants.ts`) - big enough that
  the fit usually sits above `MIN_ZOOM` and shows the whole city, but panning and
  zooming still work the same way if you want a closer look.
- **Pan.** Press and drag the map. A press only becomes a pan past a 6px threshold, so a
  slightly shaky click still places a block; a real drag suppresses the click entirely.
- **Zoom.** Wheel, anchored on the cursor, clamped to 0.28x - 2.6x.

Because of this, anything converting DOM coordinates to a grid cell must go through
`scene.canvasPointToCell(canvasX, canvasY)`, which applies the camera transform.
`pointerToCell` takes **world** coordinates and is for use inside the scene.

`renderCity()` does not destroy-and-recreate decor (trees, cars, passers-by) for every
empty cell on every placement - `syncDecor()` diffs against what is already there and
only touches the 1-2 cells whose occupancy actually changed; block nodes still get a
full rebuild each time, which stays cheap because they are bounded by the block budget,
not the grid size. Kept from when the grid briefly went to 100×100 - it is cheap
insurance now and matters again if the grid ever grows.

## Colour: paper, ink, honey

The theme is white-and-honey, and the tokens in `src/styles/index.css` are named for
what they *are*, not for light/dark mode:

- **`paper-0` → `paper-300`** — every surface, palest to most saturated. `paper-0` is
  pure white (cards, floating windows); `paper-50` is the page itself; `paper-100`/`200`
  are sunken surfaces (inputs, tracks, secondary buttons, hover states).
- **`ink`** — primary text and headings. **`fog`**, **`muted`**, **`faint`** are the same
  ladder one step dimmer each, for secondary/tertiary/placeholder text.
- **`honey`** — the accent, for fills with dark text on top (buttons, progress bars).
  **`honey-deep`** is for the accent used *as* text, a border, or a ring directly on a
  light surface — plain `honey` fails the ~3:1 contrast a border or small text needs on
  white. If you're reaching for `text-honey` or `border-honey`, you almost certainly want
  the `-deep` variant instead.
- **`line`** / **`line-bright`** — borders, two strengths.

The map's own palette (`--color-plot`, `--color-asphalt`, `--color-block-*`,
`--color-metric-*`) is separate and mirrored in `src/lib/visuals.ts` as plain hex, since
Phaser needs numbers, not CSS variables. Keep both in sync by hand.

## The intro curtain

`app/IntroCurtain.tsx` covers the screen while Phaser boots: an isometric grid assembles
itself back-to-front leaving one gap, the missing block drops in, the wordmark resolves,
and the plate lifts away. It leaves as soon as the map is ready **and** the minimum beat
has played, and bails out after 8s regardless, so it can never trap anyone. Reduced
motion collapses it to a plain fade.

## Conventions worth knowing

- **Saving the layout.** The builder mutates local state instantly and debounce-autosaves
  the whole layout after ~900ms (`useCityLayout`). A 409 rolls back to the last layout the
  server accepted and toasts `error.message`. `blocksUsed` is always the server's number.
- **Rating.** Ballots must cover every quality in `votingMetrics` — the API rejects partial
  ones. Build the form from `votingMetrics` and send all of them. Re-submitting *is* the
  "change my rating" path.
- **Results are votes, never AI and never simulated.** Show counts alongside percentages.
  The Advisor may describe what the votes show; it must never predict a score or suggest
  how to vote.
- **Simulated is never real.** Simulation mode's auto-issues, auto-proposals and
  auto-ratings live in React state and die on reload. Nothing in `features/simulation`
  may call a proposal endpoint — the auto-ratings are arithmetic on the sim, not votes.
- **Generated cities.** `generateCity` / `generateFlawedCity` in `@rmc/shared` build a
  plausible city and then break it on purpose — Simulation mode is pointless if the engine
  has nothing to find. Deterministic in the seed, scales to any grid size, spends ~65% of
  the budget so a fix still fits, and never strands a city with no service at all. Don't
  "improve" it into producing good cities.
- **The map pans and zooms.** Drag to pan, wheel to zoom. Anything converting pointer
  coordinates to a cell must go through `scene.canvasPointToCell` (or `pointer.worldX`
  inside the scene) — canvas space and world space are no longer the same thing.
- **Block changes are one shape.** `BlockChange[]` from `@rmc/shared` is what an
  auto-proposal drafts, what the composer diffs out of the map, and what
  `scene.previewChanges` draws. Don't invent a second one.
- **Simulation runs in the browser.** The backend only stores what `runSimulation` returns.
  The output must satisfy `SimulationResultInputSchema` — it's PUT verbatim and fed to the
  Advisor unchanged.
- **Accessibility.** It's the subject of the project, so it should hold up in the product:
  every control is a real button with a visible focus ring, meters carry `role="meter"`,
  and toasts are live regions. The one known gap is keyboard navigation *within* the grid
  — click-to-place works, cell focus doesn't yet.

## Known rough edges

- The production bundle is ~1.8MB, almost all Phaser. Fine for a demo; if it matters,
  lazy-load the map workspace.
- The mock backend's Advisor always returns `fallback: true`, because there is no LLM
  behind it. Real responses come from BE #2.
