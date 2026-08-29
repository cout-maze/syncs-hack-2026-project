# BE #1 — Auth + City modules

**Mission:** the foundation everyone else stands on. Auth issues the tokens every request carries; City is the shared state the whole product reads. Ship these first — FE #1 goes off mocks the moment you're up.

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
- **Cities CRUD**: scoped to `ownerId` from JWT (404, not 403, for other users' cities). New city = 10×10 grid, budget 100, no blocks.
- **Block placement**: granular `POST/PATCH/DELETE` + bulk `PUT /cities/{id}/blocks` (FE #1's autosave path). Validate server-side: in-bounds, one block per cell, `Σ cost ≤ blockBudget` → 409 with codes `CELL_OCCUPIED` / `OUT_OF_BOUNDS` / `BUDGET_EXCEEDED`. `blocksUsed` is always recomputed server-side.
- **Simulation storage**: `PUT/GET /cities/{id}/simulation` — validate against the `SimulationResultInput` schema (share a JSON-schema/Zod validation with FE #2 if convenient), store verbatim + `runAt`. You never compute sim results — the browser does.

## Error convention (whole app)

Every non-2xx: `{ "error": { "code": "UPPER_SNAKE", "message": "human readable", "details?": {} } }`. Ship this as shared middleware for BE #2 too.

## Integration points

- Catalog ids/metric enums are locked in the spec — changing them breaks FE #2's engine and BE #2's voting. Spec-first.
- Give FE #1 a seeded test account (`demo@city.dev`) once auth is up.
- CORS for the Vite dev origin; `docker-compose`/`npm run dev` that boots app + DB in one command.

## Done means

The whole FE #1 "done" flow passes against you instead of Prism, and `npx @redocly/cli lint` + a quick contract test (e.g. schemathesis/dredd or supertest asserting response shapes) stay green.
