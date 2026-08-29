# FE #2 — Simulation Engine, Residents & Advisor panel

**Mission:** the "TEST → DISCOVER" half of the loop. You own the **client-side simulation engine** (it runs in the browser — this was a deliberate decision), the Residents tab, the simulation visuals, and the City Advisor panel.

**Stack:** TypeScript sim engine (pure functions, no React deps), React for Residents/Advisor UI, animations driven through FE #1's Phaser scene API, Zod schemas from `/shared`.

## You own

### 1. Simulation engine (`web/src/features/simulation/engine/`)
Pure function: `runSimulation(city: City, personas: Persona[], blockTypes: BlockType[]) → SimulationResultInput`.

- **Journeys**: for each persona, path from each housing block to their `priorityServices` (BFS over the grid; transport blocks reduce travel time; per-persona rules — e.g. `wheelchair_user` needs transport-connected routes, `limited_digital_access` can't count `technology_hub` as service access). Flag `accessible: false` + `issues[]` when over `maxComfortableJourneyMinutes`.
- **Metrics**: derive the six 0–100 scores from journeys + layout (keep formulas simple and explainable — judges may ask).
- **Events**: `flood` (disable a row/area, re-run journeys — resilience), `tech_outage` (disable technology_hub effects — inclusion/participation), optional `population_change`.
- Output **must** satisfy the `SimulationResultInput` Zod schema — it gets PUT to the backend and fed to the Advisor verbatim.

### 2. Residents tab
Persona cards from `GET /catalog/personas`; after a sim run, show each persona's journeys and issues ("Maria's route to healthcare takes 22 min and has no step-free access").

### 3. Simulation UX + map animation
Run button, short (~10–20s) animated run using FE #1's scene API (residents moving along `pathBlockIds`, event effects like flooded cells), then a results view: metric gauges + journey problems.

### 4. City Advisor panel
"Ask the Advisor" after a run → loading state (2–8s) → render `AdvisorReport` (headline, weakness, affected groups, 1–3 suggestions). Handle `503`/`fallback: true` gracefully.

## API you consume

Specs: `city-service.yaml`, `advisor-service.yaml` (mock ports 4010/4012).

| Call | Use |
|---|---|
| `GET /catalog/personas`, `GET /catalog/block-types` | engine inputs + Residents tab |
| `GET /cities/{id}` | city state to simulate |
| `PUT /cities/{id}/simulation` | store each run's result (persistence + advisor context) |
| `POST /advisor/analysis` | body = `{ city, simulation }` — send your freshest local result |

## Integration points

- **FE #1's Phaser scene API** is your display surface — agree the interface (highlightPath / setBlockState / animateResident) end of day 1. Until then, build the engine + a plain-HTML debug view of results; the engine is your critical path, not the animation.
- Metric keys, persona ids, block-type ids: use the shared enums — the Advisor prompt and proposal voting reuse them.
- Sim must not mutate city state (scope guardrail: BUILD and TEST are separate).

## Done means

Run sim on a deliberately flawed city → journeys animate → metrics render → a wheelchair-user journey is flagged inaccessible → Advisor explains it and suggests a fix → move the block (FE #1 UI) → re-run → metrics visibly improve. This is demo steps 3–5 + 7–8.
