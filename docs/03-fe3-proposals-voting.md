# FE #3 — Proposals & Community Voting

**Mission:** the Proposals tab — the participatory-democracy feature that makes this more than a solo game. Council proposals, per-metric support/oppose voting, live aggregated results, and the outcome display.

**Stack:** React + Zod schemas from `/shared`. No Phaser needed (map-location preview is a stretch goal via FE #1's scene API).

## You own

- **Proposal list**: cards from `GET /proposals` — title, block cost, expected benefits, affected residents (persona names via catalog), status badge (open / approved / rejected / reconsider), current overall approval %.
- **Proposal detail**: what's proposed, where, cost, who's affected; then the voting panel.
- **Voting panel**: one support/oppose toggle **per metric** in `votingMetrics` (e.g. Accessibility 👍/👎, Sustainability 👍/👎 …). Submit sends the full ballot — the API rejects partial ballots. If `myVotes` is non-null, pre-fill and let the user change their vote (same `PUT`).
- **Results display**: per-metric support bars + overall approval % + total voters, from the `VotingResults` object. Make it visibly *derived from votes* — show counts, not just percentages (hackathon rule: outcomes come from citizens, never AI).
- **Live-ish updates**: poll `GET /proposals/{id}/results` every 5–10s while the detail view is open.
- **Advisor explanation** (secondary): "Explain this proposal" button → `POST /advisor/proposal-explanation` with current `votingResults` → render explanation + trade-offs + community readout. Never render it as a prediction or recommendation.

## API you consume

Specs: `proposal-service.yaml`, `advisor-service.yaml` (mock ports 4011/4012).

| Call | Use |
|---|---|
| `GET /proposals`, `GET /proposals/{id}` | list + detail (+ `myVotes`) |
| `PUT /proposals/{id}/votes` | submit/update ballot; response includes fresh `results` — update UI instantly |
| `GET /proposals/{id}/results` | polling |
| `POST /advisor/proposal-explanation` | optional explanation panel |

Errors to handle: `409 PROPOSAL_CLOSED` (voting ended — show outcome), `400` invalid ballot (shouldn't happen if you build from `votingMetrics`).

## Integration points

- **BE #2** seeds 3 demo proposals ("Add a community garden", "Expand public transport", "Convert heritage site") + seed votes — agree the seed content early so your UI copy matches.
- Metric display names/order: same six metrics as the rest of the app — reuse the shared label map so Simulation results and voting results look like the same language.
- For the demo, one teammate votes live on stage; seed votes provide the crowd.

## Done means

Open Proposals tab → see 3 seeded proposals with results → open one → vote on 4 metrics → percentages and voter count update immediately → change vote → results shift → Advisor explains the trade-offs. This is demo step 6.
