# BE #2 — Proposals/Voting + Advisor modules

**Mission:** the community brain and the AI voice. Proposal mode is **the actual product** — the vote and decision-making platform — and you own its backend. It is pure CRUD + arithmetic, so do it first: FE #3 is waiting. Advisor is an LLM wrapper with strict guardrails.

> Simulation mode's auto-generated issues, proposals and ratings live entirely in the
> browser and never reach you. Nothing you store was produced by a simulation or by an AI.

**Stack:** same Node app as BE #1 (`server/src/modules/{proposals,advisor}`), reusing BE #1's auth middleware and error middleware.

**Contracts:** `specs/proposal-service.yaml`, `specs/advisor-service.yaml` — spec-first for any change.

## Proposals module (build first)

- **Model**: proposal (spec `ProposalInput` + status + author) and votes: one row per `(userId, proposalId, metric)` with boolean `support`; `PUT /votes` deletes-and-reinserts the user's ballot (that's what makes re-voting idempotent).
- **Authoring**: `POST /proposals` is now a **first-class, user-facing endpoint**, not just a seed hook — FE #3 lets a citizen raise an issue by editing the map. Requires auth; record the authenticated user as the author. Validate the new fields: `issue` (plain-language problem statement) and `changes[]` (the block delta, `{op, typeId?, x, y, blockId?}`). Recompute `blockCost` from `changes` against the block catalog rather than trusting the client.
- **Ballot validation**: a ballot rates every quality in the proposal's `votingMetrics` — reject unknown/missing/duplicate metrics (400), closed proposals (409 `PROPOSAL_CLOSED`).
- **Aggregation** (in SQL or code, recomputed on read — no caching needed at this scale):
  - per metric: `supportPct = support / (support + oppose) × 100` (1 dp; 0 voters → 0)
  - `overallApprovalPct` = mean of per-metric supportPcts
  - `totalVoters` = distinct users with a ballot
  - `outcomeIfClosedNow`: ≥60 approved, <40 rejected, else reconsider (put thresholds in config)
- **Hard rules**: results derive **only from vote rows** — no AI, no manual overrides, and no synthetic ratings. Simulation mode's auto-ratings are not votes and must never be written to the vote tables; there is no endpoint that would let them in, and there should not be one. `POST /proposals/{id}/close` snapshots the outcome into `status`.
- **Seeds**: **one default proposal** is the requirement — "Add a community garden", with its `issue`, a small `changes[]` delta and `votingMetrics`, per the spec examples — plus ~20 seed-user votes shaped so the results are interesting (e.g. community 91%, efficiency 58%). It exists so Proposal mode is never empty on a cold start. The other two ("Expand public transport", "Convert heritage site into new development") are a nice-to-have once the first one works end to end. Seed votes are ordinary vote rows from seed user accounts. Agree copy with FE #3.

## Advisor module

- Server-side LLM call (Claude API — key in env, never shipped to the browser).
- `POST /advisor/analysis`: build a compact prompt from `{city, simulation}` (blocks by type+position, metrics, failed journeys, failed events) → request **structured JSON** matching `AdvisorReport` → validate before returning; retry once on parse failure.
- `POST /advisor/proposal-explanation`: fetch the proposal (in-process call/service function, not HTTP), include `votingResults` and the proposal's `issue`/`changes` if provided. Prompt guardrails: *describe* the ratings people gave, never predict scores or tell users how to vote; never invent qualities.
- **Fallback**: on LLM timeout (~10s) or failure, return a canned-but-plausible report computed from the sim data (lowest metric → weakness; worst journey → affected group) with `fallback: true`. The demo must never hang on an API outage.
- Latency: 2–8s expected; FE shows a thinking state, so don't stream — keep it a simple JSON response.

## Integration points

- Reuse BE #1's auth + error middleware; same `{error:{code,message}}` shape.
- Metric enum, persona ids, block-type ids: import from the shared constants module, same values as city-service.yaml.
- Give FE #3 the default seeded proposal early (day 1 if possible) — even with hardcoded aggregation values at first.
- FE #2 sends you sim results verbatim — if the Advisor prompt needs another field, negotiate it into `SimulationResultInput` (spec change in city-service.yaml, BE #1 + FE #2 involved).

## Done means

FE #3's flow passes against you (list → open → rate every quality → results shift → change a rating → explain), a citizen can author a new proposal with `issue` + `changes` via `POST /proposals` and it becomes votable, the default garden proposal's demo numbers look right, and pulling the network cable on the LLM still returns a sensible `fallback: true` advisor report.
