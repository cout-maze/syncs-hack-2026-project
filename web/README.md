# Frontend — Rebuild My City

React + Phaser + Tailwind. Three workstreams share this app; the seams between them
are described below. Read this before you start your feature.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:5173 and sign in as **demo@city.dev / demo1234** (pre-filled in
mock mode). You get a seeded city — the deliberately flawed one from the demo script —
plus the 9 block types, 7 personas, and 3 council proposals with seed votes.

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
├── app/            shell, tabs, routing, active-city context   (FE #1)
├── auth/           login, register, token, route guard         (FE #1)
├── features/
│   ├── builder/    map, drag-and-drop, budget, autosave        (FE #1)
│   ├── residents/  persona cards, post-sim journeys            (FE #2)
│   ├── simulation/ THE ENGINE, run UX, results                 (FE #2)
│   ├── advisor/    City Advisor panel                          (FE #2)
│   └── proposals/  proposal list, ballot, live results         (FE #3)
├── components/ui/  Button, Card, Badge, Field, MetricBar, Toast  (shared)
├── lib/            api client, hooks, tokens, colours, format    (shared)
└── mocks/          the in-browser backend                        (shared)
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

const scene = useCityScene();          // null unless the City tab is mounted

scene?.highlightPath(journey.pathBlockIds);
scene?.setBlockState(blockId, 'flooded');
await scene?.animateResident({ personaId: 'wheelchair_user', pathBlockIds });
scene?.pulseCell({ x: 2, y: 6 });      // "show this proposal on the map"
scene?.clearStates();
```

Always null-check — the scene only exists while the City tab is on screen. If you need a
method that isn't there, say so in the team channel first: it's a cross-workstream change.

## Conventions worth knowing

- **Saving the layout.** The builder mutates local state instantly and debounce-autosaves
  the whole layout after ~900ms (`useCityLayout`). A 409 rolls back to the last layout the
  server accepted and toasts `error.message`. `blocksUsed` is always the server's number.
- **Voting.** Ballots must cover every metric in `votingMetrics` — the API rejects partial
  ones. Build the form from `votingMetrics` and send all of them. Re-submitting *is* the
  "change my vote" path.
- **Results are votes, never AI.** Show counts alongside percentages. The Advisor may
  describe what the votes show; it must never predict a score or suggest how to vote.
- **Simulation runs in the browser.** The backend only stores what `runSimulation` returns.
  The output must satisfy `SimulationResultInputSchema` — it's PUT verbatim and fed to the
  Advisor unchanged.
- **Accessibility.** It's the subject of the project, so it should hold up in the product:
  every control is a real button with a visible focus ring, meters carry `role="meter"`,
  and toasts are live regions. The one known gap is keyboard navigation *within* the grid
  — click-to-place works, cell focus doesn't yet.

## Known rough edges

- The production bundle is ~1.8MB, almost all Phaser. Fine for a demo; if it matters,
  lazy-load the City tab.
- The mock backend's Advisor always returns `fallback: true`, because there is no LLM
  behind it. Real responses come from BE #2.
