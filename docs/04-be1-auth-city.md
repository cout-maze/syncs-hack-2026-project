# BE #1 — Auth + City modules

**Mission:** the foundation everyone else stands on. Auth issues the tokens every request carries; City is the shared state the whole product reads — the city-builder map is the product's main mechanic, and **both Simulation mode and Proposal mode render it**, so everything downstream depends on this module. Ship it first — FE #1 goes off mocks the moment you're up.

**Stack:** Node.js (pick Express/Nest/Fastify with BE #2 — one app, `server/src/modules/{auth,city}`). Any simple DB (SQLite via Prisma/Drizzle is plenty).

**Contracts:** `specs/auth-service.yaml`, `specs/city-service.yaml` — these are the source of truth; if implementation needs to deviate, change the spec first and tell the team.

## Auth module (build first, ~half a day)

- `POST /auth/register` — bcrypt/argon2 the password, unique email (409 `EMAIL_TAKEN`), return JWT + user.
- `POST /auth/login` — same 401 for wrong email vs wrong password.
- `GET /auth/me` — from token.
- JWT: `sub`, `email`, 24h expiry, secret in env. Export an auth middleware BE #2 reuses for proposals/advisor.
- Deliberately swappable: nothing else may import auth internals — only the middleware + `User` shape.

## City module

- **Catalog** (static): ship `GET /catalog/block-types` and `GET /catalog/personas` from JSON seed files **in the first hour** — three teammates are blocked on these ids/costs. Copy the 9 block types and 7 personas (with `maxComfortableJourneyMinutes`, `priorityServices`) straight from the spec enums/examples; tune numbers with FE #2 later.
  Personas are **simulation-engine inputs, not a user-facing feature** — there is no residents screen. Only FE #2's engine reads them, so treat the endpoint as data plumbing rather than something to make pretty.
- **Cities CRUD**: scoped to `ownerId` from JWT (404, not 403, for other users' cities). New city = 30×30 grid, budget 900, no blocks. (Bumped up from the original 10×10 / 100 so the map feels like a real, explorable city rather than a small board - the block budget is what keeps a layout meaningful, not the grid size. The backend just needs the new defaults; nothing about the contract changed.)
- **The council's city** (`GET /cities/council`): one fixed city, the same for every user, never created or edited through the normal endpoints - it only ever exists from a seed. Proposal mode shows this instead of the caller's own city, and the seeded proposals' `changes`/`location` are written against it. Small and static (10×10, budget 100 in the mock seed) on purpose - it is not a per-user template. Registered ahead of `/cities/{cityId}` in the spec/router so the literal `council` segment is not swallowed by the `{cityId}` path param.
- **Block placement**: granular `POST/PATCH/DELETE` + bulk `PUT /cities/{id}/blocks` (FE #1's autosave path). Validate server-side: in-bounds, one block per cell, `Σ cost ≤ blockBudget` → 409 with codes `CELL_OCCUPIED` / `OUT_OF_BOUNDS` / `BUDGET_EXCEEDED`. `blocksUsed` is always recomputed server-side. None of this applies to the council city - it has no blocks endpoints at all.
- **Simulation storage**: `PUT/GET /cities/{id}/simulation` — validate against the `SimulationResultInput` schema (share a JSON-schema/Zod validation with FE #2 if convenient), store verbatim + `runAt`. You never compute sim results — the browser does.
  Simulation mode's auto-issues, auto-proposals and auto-ratings are **ephemeral browser state** and are deliberately not stored anywhere. If FE #2 asks you to persist them, that's a design change — raise it first.

## Error convention (whole app)

Every non-2xx: `{ "error": { "code": "UPPER_SNAKE", "message": "human readable", "details?": {} } }`. Ship this as shared middleware for BE #2 too.

## Integration points

- Catalog ids/metric enums are locked in the spec — changing them breaks FE #2's engine and BE #2's voting. Spec-first.
- Give FE #1 a seeded test account (`demo@city.dev`) once auth is up.
- CORS for the Vite dev origin; `docker-compose`/`npm run dev` that boots app + DB in one command.

## Done means

The whole FE #1 "done" flow passes against you instead of Prism (build a city, switch modes, reload, the map persists), and `npx @redocly/cli lint` + a quick contract test (e.g. schemathesis/dredd or supertest asserting response shapes) stay green.
