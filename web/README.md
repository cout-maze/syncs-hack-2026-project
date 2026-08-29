# Frontend — Rebuild My City

React + Phaser + Tailwind. **One map, two modes** - `features/builder` is the shared
city-builder workspace, and Simulation mode and Proposal mode each mount it with their
own panel beside it. Three workstreams share this app; the seams between them are
described below. Read this before you start your feature.

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
├── app/            shell, mode switch, routing, active-city context  (FE #1)
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

Modes mount the workspace with a render prop:

```tsx
export function SimulationMode() {
  return <CityWorkspace>{(workspace) => <SimulationPanel workspace={workspace} />}</CityWorkspace>;
}
```

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
`shared/src/constants.ts` is the frontend's copy of that contract.

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
