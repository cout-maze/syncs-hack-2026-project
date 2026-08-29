# BE #1 — Auth + Map + Sandbox modules

**Mission:** the foundation — tokens with roles, the one shared map, and per-user sandboxes. Ship these first; FE #1 leaves mocks the moment `GET /map` returns the seeded city.

**Stack:** the existing `backend/` app — Fastify 5 + Zod + Prisma 7 + SQLite, modules under `src/modules/{auth,map}`.

**Contracts:** `specs/auth-service.yaml`, `specs/map-service.yaml` — source of truth; if implementation must deviate, change the spec first and tell the team.

## Refactor context (read once)

The current code implements the old per-user-city design. Reusable as-is: the auth module (~90%), the error convention, plugins, `PlacedBlock` + `@@unique([cityId, x, y])`, the block CRUD skeleton in `city.service.ts`. To remove: budget math (`blockBudget`/`blocksUsed`), simulation storage (`SimulationResult`), the personas catalog (`personas.json` + route + `PERSONA_IDS`). To rename: `PlacedBlock.typeId` → **`blockTypeId`** (column + DTOs). Data-model target and constants delta: overview §"Target data model".

## Auth module (~half a day)

- Add `role String @default("user")` to `User`; include `role` in JWT claims and in every `User` response. `register` always creates `user`.
- Export **`requireAdmin`** alongside the existing `authenticate` preHandler (401 no token, 403 `FORBIDDEN` for role `user`) — BE #2 needs it for proposal create/close.
- Everything else stays: argon2, 409 `EMAIL_TAKEN`, identical 401 for both login failure modes, 24h expiry. Nothing else may import auth internals — only the middleware + `User` shape.

## Map module

- **Catalog**: `GET /catalog/block-types` from `block-types.json`, `cost` field dropped. Public. Ship in the first hour — both FEs need the slugs. Delete the personas route.
- **`GET /map`** (public): the single `kind: "real"` city (seed-created, `ownerId: null`) with all blocks. "Exactly one real city" is enforced by seed + service code, not the schema.
- **Admin edits**: `PUT /map/blocks/{x}/{y}` upsert (add and replace in one op) and `DELETE /map/blocks/{x}/{y}`. Validate: in-bounds → 400 `OUT_OF_BOUNDS`, known `blockTypeId` (actually call the existing `isKnownBlockType` this time) → 400 `BLOCK_TYPE_INVALID`, delete on empty → 404 `CELL_EMPTY`. Both behind `requireAdmin`. Return the full updated map.

## Sandbox module

- **`GET /sandbox`**: find the caller's `kind: "sandbox"` city; if none, create it and copy every real-map block **in one transaction** (lazy create). One per user (`ownerId` unique).
- **Cell edits**: same upsert/delete semantics and codes as map edits, minus the role check, scoped to the caller's sandbox.
- **`POST /sandbox/reset`**: delete the caller's sandbox blocks and re-copy from the current real map, in a transaction.

## Error convention (whole app, unchanged)

Every non-2xx: `{ "error": { "code": "UPPER_SNAKE", "message": "human readable", "details?": {} } }` — shared middleware BE #2 reuses.

## Seeds (with PX's content)

- `admin@city.dev` (role `admin`) and `demo@city.dev` (role `user`), passwords documented in the seed file.
- ~2–3k voter accounts for BE #2's vote seeding — generate ONE argon2 hash and reuse it via `createMany` (per-account hashing takes minutes at that scale).
- The real city: 40×40, `name` from PX, ~400–600 blocks from PX's layout.

## Integration points

- `blockTypeId` slugs and the enums in the overview are locked — spec-first for any change.
- Give the FEs the seeded accounts the moment auth is up; CORS for the Vite dev origin; one command boots app + DB.

## Done means

FE #1's and FE #2's "done" flows pass against you instead of Prism, and `npx @redocly/cli lint specs/*.yaml` stays green.
