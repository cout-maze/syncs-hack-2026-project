# Rebuild My City — Architecture Overview (read this first)

One backend app, four modules, four OpenAPI specs, five people working in parallel.

## Decisions (locked with bebek, 29 Aug 2026)

| Decision | Choice |
|---|---|
| Auth | Simple email + password → JWT. Built to be swappable later (other modules only depend on the Bearer token). |
| Simulation | Runs **client-side** in the browser (FE #2 owns the engine). Backend only stores the latest result per city. |
| Deployment | **One Node.js app** (Express/Nest/Fastify — BE pair picks), four route-group modules under `/api/v1`. Specs are written per module so it can be split into real microservices later without contract changes. |
| Backend stack | Node.js |
| Frontend stack | React (UI shell/tabs) + Phaser (2.5D grid map canvas) + Zod (runtime validation mirroring these specs) |
| Realtime | None. Poll `GET /proposals/{id}/results` every 5–10s. |
| Persistence | Anything simple — SQLite/lowdb/Postgres. Contracts don't care. |

## Module map

| Module | Spec file | Backend owner | Frontend consumer |
|---|---|---|---|
| Auth | `specs/auth-service.yaml` | BE #1 | all three FEs (shared auth context) |
| City (catalog, cities, blocks, sim storage) | `specs/city-service.yaml` | BE #1 | FE #1, FE #2 |
| Proposals & Voting | `specs/proposal-service.yaml` | BE #2 | FE #3 |
| Advisor (AI) | `specs/advisor-service.yaml` | BE #2 | FE #2 (analysis), FE #3 (explanations) |

## The integration contract

The **City object** (`city-service.yaml` → `City` schema) is the single shared representation: map, sim engine, advisor and proposals all read from it. If you need to change it, post in the team channel first — it touches everyone.

Things that must stay in sync everywhere (single source of truth = city-service.yaml):

1. **Metric names**: `accessibility, sustainability, efficiency, community, resilience, inclusion` — used by the sim engine (FE #2), proposal voting (`MetricName` enum), and advisor payloads.
2. **Block type ids**: `housing, healthcare, education, transport, park, community_hub, technology_hub, shared_resource_hub, culture_heritage`.
3. **Persona ids**: `older_resident, wheelchair_user, parent_stroller, child_student, remote_worker, limited_digital_access, non_english_speaker`.
4. **Error shape**: `{ "error": { "code", "message", "details?" } }` on every non-2xx response.

Frontend: generate or hand-write **one shared Zod schema package** (`/shared/schemas.ts`) from these specs on day 1 and import it in all three FE workstreams. `openapi-zod-client` or `typed-openapi` can generate it; hand-tuning after is fine.

## Working in parallel from day 1

Backend doesn't need to exist for frontend work to start:

```bash
# Mock any module instantly from its spec (Prism):
npx @stoplight/prism-cli mock specs/city-service.yaml -p 4010
npx @stoplight/prism-cli mock specs/proposal-service.yaml -p 4011
npx @stoplight/prism-cli mock specs/advisor-service.yaml -p 4012
npx @stoplight/prism-cli mock specs/auth-service.yaml -p 4013
```

Point the frontend's API base URL at the mocks via env var (`VITE_API_URL`), switch to the real app (`http://localhost:3000/api/v1`) when a module lands. Alternatively use MSW inside the React app with the same schemas.

Auth conventions: every request except `register`, `login`, and the two `GET /catalog/*` endpoints sends `Authorization: Bearer <jwt>`. 401 → redirect to login. JWT expiry 24h — nobody re-logs during the demo.

## Suggested repo layout (monorepo)

```
rebuild-my-city/
├── specs/                  # the 4 OpenAPI files — the contract, PR-reviewed
├── shared/                 # Zod schemas + TS types generated from specs
├── server/                 # one Node app
│   └── src/modules/{auth,city,proposals,advisor}/
├── web/                    # React + Phaser app
│   └── src/features/{builder,simulation,residents,proposals,advisor}/
└── docs/                   # these split documents
```

## Integration milestones

1. **Hour 0–2**: agree specs (done — this package), scaffold repo, shared Zod package, mocks running.
2. **Day 1 end**: Auth + City modules real; FE #1 builder saves against real backend; others still on mocks.
3. **Day 2 mid**: Proposals real + seeded; sim engine produces real `SimulationResult`; Advisor returns real LLM output with canned fallback.
4. **Freeze**: demo script run end-to-end twice (see §12 of the proposal doc for the demo sequence).
