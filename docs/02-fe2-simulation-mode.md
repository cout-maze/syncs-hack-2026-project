# FE #2 — Simulation Mode (engine, auto-issues, auto-proposals, Advisor)

**Mission:** Simulation mode is the **teaching sandbox** — the mode that makes a
first-time user understand the whole product in sixty seconds. They build on FE #1's map,
hit Run, and the system tells them what's wrong, proposes fixes, and rates those fixes,
all by itself. No other humans, no AI scoring.

You own the **client-side simulation engine** (it runs in the browser — a deliberate
decision), everything derived from it, and the City Advisor panel.

**Stack:** TypeScript sim engine (pure functions, no React deps), React for the mode panel,
animations driven through FE #1's scene API, Zod schemas from `/shared`.

> There is no Residents tab. Personas are **engine inputs only** — the engine walks each
> need profile from housing to the services it needs. Failures come out as *issues*
> written in plain language, not as a cast of characters to browse.

## You own

### 1. Simulation engine (`web/src/features/simulation/engine/runSimulation.ts`)

Pure function: `runSimulation(city, personas, blockTypes) → SimulationResultInput`.

- **Journeys**: for each persona, path from each housing block to their `priorityServices`
  (BFS over the grid; transport blocks reduce travel time; per-persona rules — e.g.
  `wheelchair_user` needs transport-connected routes, `limited_digital_access` can't count
  `technology_hub` as service access). Flag `accessible: false` + `issues[]` when over
  `maxComfortableJourneyMinutes`.
- **Metrics**: derive the six 0–100 quality scores from journeys + layout. Keep the formulas
  simple and explainable — judges will ask, and the auto-rating below is built on them.
- **Events**: `flood` (disable a row/area, re-run journeys — resilience), `tech_outage`
  (disable technology_hub effects — inclusion/participation), optional `population_change`.
- Output **must** satisfy the `SimulationResultInput` Zod schema — it gets PUT to the
  backend and fed to the Advisor verbatim.

### 2. Auto-issues (`engine/issues.ts`)

Turn a `SimulationResultInput` into a short list of plain-language problems:

- failed journeys → *"Housing in the north-east has no healthcare within 15 minutes."*
- weak metrics → *"Resilience is 34 — a flood cuts the only route to the hospital."*

Group and rank them: one issue per real problem, worst first, capped at ~5 so the panel
stays readable. Pure function, no React, no network.

### 3. Auto-proposals + auto-rating (`engine/autoProposals.ts`)

Each issue becomes a concrete, *applicable* change — the automatic counterpart to what a
human writes by hand in Proposal mode.

- **Draft**: pick a candidate block change that would address the issue (place a healthcare
  block at the nearest affordable free cell, bridge a gap with transport, …). Express it as
  the same `changes` shape Proposal mode uses, so the map preview is shared code.
- **Auto-rate**: apply the change to a copy of the city, re-run `runSimulation`, and map
  each metric's delta to a per-quality approval %. This is a **deterministic function of
  the sim** — not AI, not a prediction of how people would vote. Show the deltas alongside
  the percentages so it reads as arithmetic.
- **Apply**: applying an auto-proposal writes the change through FE #1's builder state, so
  the user sees the map change and can re-run.
- **Hard rule**: none of this is ever POSTed to the proposals API and no auto-rating is ever
  written as a vote. It is browser state and it dies on reload. Label these cards
  *simulated* and style them distinctly from real proposals.

### 4. The city generator (`shared/src/generation.ts`)

A blank grid teaches nothing, and neither does a well-planned one — Simulation mode only
works if the engine has something to complain about. So "Generate a city" builds a
plausible city and then **breaks it on purpose**, in six stages:

1. **Seeded RNG** (mulberry32 over an FNV-1a hash) — same seed, same city, every runtime.
2. **District seeding** — blue-noise scatter (Mitchell's best-candidate), so neighbourhoods
   are spaced without a hard minimum-separation rule that fails on a crowded grid.
3. **Organic growth** — frontier growth with a `sprawl` dial: 0 gives tight round districts,
   1 gives straggly ones. Interiors are then eroded slightly so big districts read as
   neighbourhoods with courtyards rather than solid slabs.
4. **Roads** — a minimum spanning tree over district centres plus a few extra edges for
   loops, each routed by **A\*** that prefers open land and carries a per-cell jitter. That
   jitter is what stops the network looking like ruled lines.
5. **Services** — p-median placement against a **transport-aware travel-time field**
   (Dijkstra; walking a cell costs 3 minutes, crossing a transport block costs 1). That is
   the same journey model your engine uses, so the generator and the engine agree about
   what "far" means.
6. **Defects** — one or two deliberate flaws, aimed at a single *victim district* and at a
   real persona's `maxComfortableJourneyMinutes`: a service moved across town, a road never
   built, a neighbourhood left with no healthcare in reach, or education swapped for a
   technology hub that `limited_digital_access` cannot use.

Because stage 5 gives it the engine's distance model, the generator **verifies its own
defects** before returning: `verified` is true when the travel-time field confirms a
persona is genuinely stranded. `generateFlawedCity` then closes the loop against the real
engine — generate, simulate, re-roll until a journey actually fails.

Four **archetypes** (organic town, dense core, sprawl, divided city) vary district count,
compactness and road coverage so two seeds do not produce the same city twice.

Invariants worth not breaking: at most one *hard* defect, so a generated city always has
something to walk to; two defects never land on the same service; and only ~65% of the
block budget is spent, so your auto-proposals have room to place a fix.

It lives in `@rmc/shared`, not `web/`, because BE #1 may want to seed cities server-side
and the same seed must produce the same city on both sides. It scales with the grid —
verified at 10×10, 30×30 and 50×50 — at about 5ms for a 30×30 city.

### 5. Simulation mode panel + map animation

Run button, a short (~10–20s) animated run through FE #1's scene API (residents moving
along `pathBlockIds`, event effects like flooded cells), then results: metric gauges,
failed journeys, the auto-issue list, and the auto-proposal cards with their ratings.

### 6. City Advisor panel

"Ask the Advisor" after a run → loading state (2–8s) → render `AdvisorReport` (headline,
weakness, affected groups, 1–3 suggestions). Handle `503` / `fallback: true` gracefully.
The Advisor explains the run in prose; it does not produce the auto-ratings.

## API you consume

Specs: `city-service.yaml`, `advisor-service.yaml` (mock ports 4010/4012).

| Call | Use |
|---|---|
| `GET /catalog/personas`, `GET /catalog/block-types` | engine inputs |
| `GET /cities/{id}` | city state to simulate |
| `PUT /cities/{id}/simulation` | store each run's result (persistence + advisor context) |
| `POST /advisor/analysis` | body = `{ city, simulation }` — send your freshest local result |

You call **no proposal endpoints at all**. If you find yourself needing one, the design has
drifted — raise it.

## Integration points

- **FE #1's scene API** is your display surface (`highlightPath` / `setBlockState` /
  `animateResident`). Until it's ready, build the engine + a plain-HTML debug view — the
  engine is your critical path, not the animation.
- **FE #3** shares your `changes` shape and the map preview. Agree it early: an auto-proposal
  and a human proposal should render on the map identically.
- Quality keys, persona ids, block-type ids: use the shared enums — the Advisor prompt and
  proposal rating reuse them.
- The sim itself must not mutate city state. Applying an auto-proposal is a separate,
  explicit user action that goes through the builder.

## Done means

Run the sim on a deliberately flawed city → journeys animate → the six qualities render →
an inaccessible route is flagged → it appears as an auto-issue → the auto-proposal beside
it says "+18 accessibility, −4 efficiency" with per-quality ratings → apply it → the map
updates → re-run → the numbers visibly improve → the Advisor explains the whole thing in
plain language. Reload the page: the city and the last stored run survive, the auto-issues
are gone.
