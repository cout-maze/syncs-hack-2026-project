# BE #2 — Proposals/Voting + Advisor modules

**Mission:** the community brain and the AI voice. Proposals/voting is pure CRUD + arithmetic (do it first — FE #3 is waiting); Advisor is an LLM wrapper with strict guardrails.

**Stack:** same Node app as BE #1 (`server/src/modules/{proposals,advisor}`), reusing BE #1's auth middleware and error middleware.

**Contracts:** `specs/proposal-service.yaml`, `specs/advisor-service.yaml` — spec-first for any change.

## Proposals module (build first)

- **Model**: proposal (spec `ProposalInput` + status) and votes: one row per `(userId, proposalId, metric)` with boolean `support`; `PUT /votes` deletes-and-reinserts the user's ballot (that's what makes re-voting idempotent).
- **Ballot validation**: must cover exactly the proposal's `votingMetrics` — reject unknown/missing/duplicate metrics (400), closed proposals (409 `PROPOSAL_CLOSED`).
- **Aggregation** (in SQL or code, recomputed on read — no caching needed at this scale):
  - per metric: `supportPct = support / (support + oppose) × 100` (1 dp; 0 voters → 0)
  - `overallApprovalPct` = mean of per-metric supportPcts
  - `totalVoters` = distinct users with a ballot
  - `outcomeIfClosedNow`: ≥60 approved, <40 rejected, else reconsider (put thresholds in config)
- **Hard rule**: results derive only from vote rows. No AI, no manual overrides. `POST /proposals/{id}/close` snapshots the outcome into `status`.
- **Seeds**: 3 council proposals ("Add a community garden", "Expand public transport", "Convert heritage site into new development" — locations/costs/affected personas per spec examples) + ~20 seed-user votes each, shaped so results are interesting (e.g. garden: community 91% / affordability 58%). Seed votes are ordinary vote rows from seed user accounts. Agree copy with FE #3.

## Advisor module

- Server-side LLM call (Claude API — key in env, never shipped to the browser).
- `POST /advisor/analysis`: build a compact prompt from `{city, simulation}` (blocks by type+position, metrics, failed journeys, failed events) → request **structured JSON** matching `AdvisorReport` → validate before returning; retry once on parse failure.
- `POST /advisor/proposal-explanation`: fetch the proposal (in-process call/service function, not HTTP), include `votingResults` if provided. Prompt guardrails: *describe* voting results, never predict scores or tell users how to vote; never invent metrics.
- **Fallback**: on LLM timeout (~10s) or failure, return a canned-but-plausible report computed from the sim data (lowest metric → weakness; worst journey → affected group) with `fallback: true`. The demo must never hang on an API outage.
- Latency: 2–8s expected; FE shows a thinking state, so don't stream — keep it a simple JSON response.

## Integration points

- Reuse BE #1's auth + error middleware; same `{error:{code,message}}` shape.
- Metric enum, persona ids, block-type ids: import from the shared constants module, same values as city-service.yaml.
- Give FE #3 the seeded proposals early (day 1 if possible) — even with hardcoded aggregation values at first.
- FE #2 sends you sim results verbatim — if the Advisor prompt needs another field, negotiate it into `SimulationResultInput` (spec change in city-service.yaml, BE #1 + FE #2 involved).

## Done means

FE #3's flow passes against you (list → vote → results shift → change vote → explain), the garden proposal demo numbers look right, and pulling the network cable on the LLM still returns a sensible `fallback: true` advisor report.
