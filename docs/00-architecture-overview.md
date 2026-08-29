# Rebuild My City — Architecture Overview (read this first)

One shared city map everyone can see. The government (admins) proposes one-block changes on it; citizens tap 👍/👎 on the proposal popup. Each user also gets a private **Sandbox** — a copy of the city to remix however they like. That's the whole app.

> **Status (29 Aug 2026):** this docs package **supersedes** `Rebuild_My_City_Feature_Proposal_Final.docx` and the earlier per-user-city design. `backend/src` still implements the old design — a refactor to match these specs is pending. If code and spec disagree, **the spec wins**; don't "fix" a spec back toward the code.

## Decisions (locked, 29 Aug 2026)

| Decision | Choice |
|---|---|
| Map | **One shared city** — a stylized 2D block grid with pan/zoom (Google-Maps feel, no real geo tiles). Public to view, only admins edit it. |
| Auth | Email + password → JWT, with `role: "user" \| "admin"`. Register always creates `user`; admins exist only via the seed script. |
| Voting | One vote per user per proposal, `up` or `down`. Tap the same thumb again = retract, tap the other = switch. Counts always visible, even before voting and to logged-out viewers. |
| Proposals | Admin-only. Exactly **one cell** per proposal: `add`, `replace`, or `remove` a block at `(x, y)`, plus title + description. |
| Closing | Admin closes a proposal → voting stops, counts freeze. **The map does not change.** Building the change is a separate, explicit admin map edit. |
| Sandbox | One private city per user, lazily created as a **copy of the current real map**. Free placement, no voting, no scoring. |
| AI | **Proposal explainer only** — plain-language summary of a change, canned fallback when the LLM is unavailable. AI never decides, predicts, or recommends votes. No residents, no personas, no metrics, no simulation engine. |
| Realtime | None. Poll the open popup's `GET /proposals/{id}` every ~5s, lists every ~10s. |
| Backend stack | Node.js — Fastify + Prisma + SQLite (already scaffolded in `backend/`). |
| Frontend stack | React shell + a canvas map renderer (Phaser / PixiJS / plain canvas — FE pair picks; only the stylized-grid *look* is locked) + Zod schemas mirroring these specs. |

## Defaults (used everywhere; say so in the channel before changing)

| Default | Value |
|---|---|
| Grid size | **40×40** (sandboxes copy it) |
| Seed density | ~400–600 placed blocks so the map reads as a city |
| Open proposals per cell | Max **one** (keeps one indicator per cell) |
| Closed proposals | Stay on the map, greyed indicator, popup shows frozen final counts |
| Seed accounts | `admin@city.dev` (admin), `demo@city.dev` (user), ~2–3k voter accounts for big vote counts |
| Block costs / budgets | **Gone.** No budget anywhere; the catalog has no `cost` field. |

## Module map

| Module | Spec file | Backend owner | Frontend consumer |
|---|---|---|---|
| Auth | `specs/auth-service.yaml` | BE #1 | both FEs (shared auth context) |
| Map + Sandbox (catalog, shared map, admin edits, sandboxes) | `specs/map-service.yaml` | BE #1 | FE #1 (view), FE #2 (edit) |
| Proposals + Votes | `specs/proposal-service.yaml` | BE #2 | FE #1 (vote popup), FE #2 (admin) |
| Explainer (AI) | `specs/advisor-service.yaml` | BE #2 | FE #1 (popup "explain" button) |

## The integration contract

Things that must stay in sync everywhere (source of truth = the specs):

1. **Block type ids** (9, unchanged): `housing, healthcare, education, transport, park, community_hub, technology_hub, shared_resource_hub, culture_heritage`.
2. **Enums**: `changeType ∈ add | replace | remove`; vote `value ∈ up | down`; proposal `status ∈ open | closed`; `role ∈ user | admin`.
3. **Field name**: a placed block's type is `blockTypeId` — everywhere (map blocks, sandbox blocks, proposals). Never `typeId`.
4. **Error shape**: `{ "error": { "code", "message", "details?" } }` on every non-2xx response, codes in UPPER_SNAKE.
5. **Id prefixes**: `usr_ cty_ blk_ prp_ vot_`.

Frontend: hand-write or generate **one shared Zod schema package** (`/shared/schemas.ts`) from these specs on day 1 and import it in both FE workstreams.

## Auth conventions

- **Public (no token)**: `POST /auth/register`, `POST /auth/login`, `GET /catalog/block-types`, `GET /map`, `GET /proposals`.
- **Optional token**: `GET /proposals/{id}` — includes `myVote` when authenticated.
- **Bearer required**: everything else. 401 → redirect to login. JWT claims `sub, email, role`, 24h expiry.
- **Admin only** (403 `FORBIDDEN` for role `user`): map edits, proposal create/close.

## Working in parallel from day 1

```bash
# Mock any module instantly from its spec (Prism):
npx @stoplight/prism-cli mock specs/map-service.yaml -p 4010
npx @stoplight/prism-cli mock specs/proposal-service.yaml -p 4011
npx @stoplight/prism-cli mock specs/advisor-service.yaml -p 4012
npx @stoplight/prism-cli mock specs/auth-service.yaml -p 4013
```

Point the frontend at the mocks via `VITE_API_URL`, switch to the real app (`http://localhost:3000/api/v1`) when a module lands. **Prism is stateless** — it returns static examples, so vote-toggle and admin flows can't be exercised realistically against it. Use MSW (or local component state) for interaction logic; Prism is for shapes.

## Target data model (for the backend refactor)

One `City` table serves both the real map and sandboxes:

```prisma
model User        { id, email @unique, passwordHash, displayName,
                    role String @default("user")        // "user" | "admin"
                    createdAt }

model City        { id, kind String,                    // "real" | "sandbox"
                    ownerId String? @unique,            // null for the one real city
                    name, gridWidth Int @default(40), gridHeight Int @default(40),
                    createdAt, updatedAt }

model PlacedBlock { id, cityId, blockTypeId, x Int, y Int
                    @@unique([cityId, x, y]) }

model Proposal    { id, title, description, x Int, y Int,
                    changeType String,                  // add | replace | remove
                    blockTypeId String?,                // null iff remove
                    status String @default("open"),     // open | closed
                    createdById, createdAt, closedAt DateTime? }

model Vote        { id, userId, proposalId, value String, // up | down
                    updatedAt
                    @@unique([userId, proposalId]) }
```

SQLite allows multiple NULLs in the unique `ownerId`, so "exactly one real city" is enforced by seed + service code — accepted.

**Delta from the current `backend/prisma/schema.prisma`**: add `User.role`; `City` gains `kind` and nullable-unique `ownerId`, loses `blockBudget`; rename `PlacedBlock.typeId → blockTypeId`; drop `SimulationResult` entirely; reshape `Proposal` (drop `blockCost`, `expectedBenefits`, `affectedPersonaIds`, `votingMetrics`); `Vote` loses `metric` (one row per user per proposal). Delete `personas.json` and the personas catalog route. In `src/config/constants.ts`: keep `BLOCK_TYPE_IDS`; set `PROPOSAL_STATUSES = ['open','closed']`; add `CHANGE_TYPES`, `VOTE_VALUES`, `ROLES`; delete `METRIC_NAMES`, `PERSONA_IDS`, `EVENT_TYPES`, `OUTCOME_RULE`, `DEFAULT_BLOCK_BUDGET`.

Vote counts derive **only** from `Vote` rows — no counter columns, no seed offsets. Big demo numbers come from seeding real voter accounts sharing one precomputed argon2 hash (`createMany`; hashing per-user at that scale takes minutes).

## Integration milestones

1. **Hour 0–2**: specs agreed (this package), shared Zod package, Prism mocks running, seed city layout drafted with PX.
2. **Day 1 end**: Auth + Map + Sandbox real; FE #1 renders the seeded city against the real backend; FE #2 still on mocks.
3. **Day 2 mid**: Proposals + votes real and seeded; popup voting works end-to-end; explainer returns real LLM output with the canned fallback verified.
4. **Freeze**: PX's demo script run end-to-end twice from a clean seed.
