# Rebuild My City — Architecture Overview (read this first)

One map. Two modes. One backend app, four modules, four OpenAPI specs, five people
working in parallel.

## The product in one paragraph

The **city-builder map is the main mechanic** — a 2.5D grid where you place housing,
healthcare, transport, parks, community hubs, technology and heritage against a fixed
block budget. Everything else is a mode layered on that same map:

| Mode | What it is | Issues & proposals | Ratings |
|---|---|---|---|
| **Simulation** | The teaching sandbox. Build freely, run the sim, see what breaks. It exists so a first-time user understands the loop in sixty seconds. | Detected and drafted **automatically** by the sim engine | **Auto-rated** — a deterministic function of the metric deltas |
| **Proposal** | The actual product: a vote and decision-making platform. | Written **manually** by people. One default proposal ships so the mode is never empty. | **Rated by real users**, one support/oppose per quality |

**BUILD → TEST → DISCOVER → REBUILD** happens inside Simulation mode.
**PROPOSE → RATE → DECIDE** happens inside Proposal mode.

Both modes render the same builder, the same catalog, the same six qualities.

## What this product does *not* have

- **No Residents tab or residents feature.** The seven need profiles ("personas") still
  exist, but only as **inputs to the simulation engine** — it walks each profile from
  housing to the services it needs and flags the routes that fail. They are never a
  browsable screen. Journey failures surface as *issues* inside Simulation mode.
- **No separate City tab.** The map is the workspace, not a tab of four.

## Decisions (locked with bebek, 29 Aug 2026)

| Decision | Choice |
|---|---|
| Auth | Simple email + password → JWT. Built to be swappable later (other modules only depend on the Bearer token). |
| Simulation | Runs **client-side** in the browser (FE #2 owns the engine). Backend only stores the latest result per city. |
| Sim-mode auto issues / auto proposals / auto ratings | **Client-side and ephemeral.** Computed in the browser, thrown away on reload, and **never written to the proposals API**. Simulated data must not touch real vote rows. |
| Proposal rating model | One **support/oppose per quality** in the proposal's `votingMetrics`, aggregated as `supportPct` per quality plus an overall approval %. Unchanged from the original spec. |
| Deployment | **One Node.js app** (Express/Nest/Fastify — BE pair picks), four route-group modules under `/api/v1`. Specs are written per module so it can be split into real microservices later without contract changes. |
| Backend stack | Node.js |
| Frontend stack | React (UI shell/modes) + Phaser (2.5D grid map canvas) + Zod (runtime validation mirroring these specs) |
| Realtime | None. Poll `GET /proposals/{id}/results` every 5–10s. |
| Persistence | Anything simple — SQLite/lowdb/Postgres. Contracts don't care. |

`Rebuild_My_City_Feature_Proposal_Final.docx` in the repo root is the original submission
artefact and is **historical**. These `docs/` and the `specs/` are the source of truth.

## Module map

| Module | Spec file | Backend owner | Frontend consumer |
|---|---|---|---|
| Auth | `specs/auth-service.yaml` | BE #1 | all three FEs (shared auth context) |
| City (catalog, cities, blocks, sim storage) | `specs/city-service.yaml` | BE #1 | FE #1 (map workspace), FE #2 (engine) |
| Proposals & Voting | `specs/proposal-service.yaml` | BE #2 | FE #3 (Proposal mode) |
| Advisor (AI) | `specs/advisor-service.yaml` | BE #2 | FE #2 (analysis), FE #3 (explanations) |

## The integration contract

The **City object** (`city-service.yaml` → `City` schema) is the single shared
representation: the map, the sim engine, the advisor and proposals all read from it. If
you need to change it, post in the team channel first — it touches everyone.

Things that must stay in sync everywhere (single source of truth = city-service.yaml):

1. **Quality/metric names**: `accessibility, sustainability, efficiency, community,
   resilience, inclusion` — used by the sim engine (FE #2), by proposal rating
   (`MetricName` enum), and by advisor payloads. These six are what users rate.
2. **Block type ids**: `housing, healthcare, education, transport, park, community_hub,
   technology_hub, shared_resource_hub, culture_heritage`.
3. **Persona ids** (engine inputs only): `older_resident, wheelchair_user, parent_stroller,
   child_student, remote_worker, limited_digital_access, non_english_speaker`.
4. **Error shape**: `{ "error": { "code", "message", "details?" } }` on every non-2xx response.

### What is persisted vs what is ephemeral

| Thing | Where it lives |
|---|---|
| City, grid, placed blocks, budget | Backend (`city-service`) |
| Latest simulation result (metrics, journeys, events) | Backend (`PUT /cities/{id}/simulation`) |
| Sim-mode auto-issues, auto-proposals, auto-ratings | **Browser memory only.** Gone on reload. |
| Real proposals (issue, change set, voting metrics) | Backend (`proposal-service`) |
| Real ballots and aggregated results | Backend, derived only from vote rows |

Frontend: one shared Zod schema package (`shared/`) mirrors these specs and is imported by
all three FE workstreams.

## Working in parallel from day 1

Backend doesn't need to exist for frontend work to start:

```bash
# Mock any module instantly from its spec (Prism):
npx @stoplight/prism-cli mock specs/city-service.yaml -p 4010
npx @stoplight/prism-cli mock specs/proposal-service.yaml -p 4011
npx @stoplight/prism-cli mock specs/advisor-service.yaml -p 4012
npx @stoplight/prism-cli mock specs/auth-service.yaml -p 4013
```

Point the frontend's API base URL at the mocks via env var (`VITE_API_URL`), switch to the
real app (`http://localhost:3000/api/v1`) when a module lands. The repo also ships an MSW
mock inside the React app using the same schemas — that is the default dev experience.

Auth conventions: every request except `register`, `login`, and the two `GET /catalog/*`
endpoints sends `Authorization: Bearer <jwt>`. 401 → redirect to login. JWT expiry 24h —
nobody re-logs during the demo.

## Repo layout

```
rebuild-my-city/
├── specs/                  # the 4 OpenAPI files — the contract, PR-reviewed
├── shared/                 # Zod schemas + TS types mirroring the specs
├── server/                 # one Node app
│   └── src/modules/{auth,city,proposals,advisor}/
├── web/                    # React + Phaser app
│   └── src/features/{builder,simulation,proposals,advisor}/
└── docs/                   # these split documents
```

`web/src/features/builder/` is the shared map workspace both modes mount.
There is no `features/residents/`.

## Integration milestones

1. **Hour 0–2**: agree specs (this package), scaffold repo, shared Zod package, mocks running.
2. **Day 1 end**: Auth + City modules real; FE #1's map workspace saves against the real
   backend; the two-mode shell is in place; others still on mocks.
3. **Day 2 mid**: the default proposal is seeded and votable; sim engine produces a real
   `SimulationResult` plus auto-issues and auto-rated auto-proposals; Advisor returns real
   LLM output with a canned fallback.
4. **Freeze**: demo script run end-to-end twice — Simulation mode to teach the mechanic,
   then Proposal mode to make a real decision.
