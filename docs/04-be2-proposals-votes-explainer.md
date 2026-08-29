# BE #2 — Proposals + Votes + Explainer modules

**Mission:** the civic core — admin proposals, thumbs voting with honest counts, and the app's one AI feature. The demo's emotional beat ("the audience votes and the numbers move") runs through you.

**Stack:** the existing `backend/` app — Fastify 5 + Zod + Prisma 7 + SQLite, modules under `src/modules/{proposals,advisor}`. Reuse BE #1's `authenticate` + `requireAdmin` middleware and the shared error convention.

**Contracts:** `specs/proposal-service.yaml`, `specs/advisor-service.yaml` — source of truth; spec-first for any deviation.

## Refactor context (read once)

The current proposals module implements per-metric ballots with a 60/40 outcome formula — all of that goes. `Vote` collapses to one row per `(userId, proposalId)` with `value: "up" | "down"`; `Proposal` drops `blockCost`, `expectedBenefits`, `affectedPersonaIds`, `votingMetrics` and gains `x, y, changeType, blockTypeId?, closedAt`. The advisor module keeps only the proposal-explanation path — delete `/advisor/analysis` and its schemas. Data-model target: overview §"Target data model".

## Proposals module

- **`POST /proposals`** (`requireAdmin`): validate against the *current* real map — `add` needs the cell empty (409 `CELL_OCCUPIED`), `replace`/`remove` need it occupied (409 `CELL_EMPTY`), max one **open** proposal per cell (409 `PROPOSAL_EXISTS_AT_CELL`), in-bounds (400 `OUT_OF_BOUNDS`), `blockTypeId` required unless `remove` (400 `BLOCK_TYPE_REQUIRED`) and must be a known slug (400 `BLOCK_TYPE_INVALID`). Validation happens **only at creation** — later map edits may orphan a proposal; accepted, no reconciliation.
- **`GET /proposals`** (public, `?status=`): newest first, each with `counts` — this draws every indicator.
- **`GET /proposals/{id}`** (optional auth): adds `myVote` (null when anonymous). The popup polls this at ~5s; two `COUNT` queries per read is fine at this scale — no caching, no counter columns.
- **`POST /proposals/{id}/close`** (`requireAdmin`): set `status: "closed"` + `closedAt`; already closed → 409 `PROPOSAL_CLOSED`. Counts freeze automatically because votes are now rejected — **no snapshot columns, and never touch the map**.

## Votes module

- **`PUT /proposals/{id}/vote`**: upsert my row to `value` (Prisma `upsert` on the `(userId, proposalId)` unique). Idempotent — same value twice is a 200 no-op. Closed proposal → 409 `PROPOSAL_CLOSED`.
- **`DELETE /proposals/{id}/vote`**: delete my row if it exists; 200 with `myVote: null` either way. Same 409 when closed.
- Both return `VoteState { myVote, counts }` — the popup repaints from the response without waiting for the next poll.
- Counts derive **only** from `Vote` rows. No offsets, no fabrication — the seed creates real rows from BE #1's voter accounts.

## Explainer module

- Keep the existing `advisor.service.ts` machinery: Anthropic client only when `ANTHROPIC_API_KEY` is set, tool-forced structured output, Zod-validated, one retry, ~10s AbortController timeout.
- **`POST /advisor/proposal-explanation`** (auth): load the proposal (404 `PROPOSAL_NOT_FOUND`), prompt = proposal fields + the target block type's catalog `description`/`benefits`/`tradeoffs` (for `remove`, the block currently at the cell).
- **Guardrail in the system prompt**: describe the change and its trade-offs in plain language; NEVER predict, score, or recommend a vote; never mention vote counts.
- On LLM failure/timeout: canned explanation composed from the same inputs, `fallback: true`. 503 `LLM_UNAVAILABLE` only if even that fails.

## Seeds (with PX's content)

3 proposals on real seeded cells — one clearly loved (~85% up), one contested (~50%), one clearly opposed (~30%) — with per-proposal target splits turned into real `Vote` rows across BE #1's voter accounts. Optionally one pre-closed proposal so the greyed state is demoable without touching anything live.

## Done means

FE #1's vote flow (cast → switch → retract → closed rejection) and FE #2's create/close flow pass against you; unplugging `ANTHROPIC_API_KEY` still returns a sensible `fallback: true` explanation; `npx @redocly/cli lint specs/*.yaml` stays green.
