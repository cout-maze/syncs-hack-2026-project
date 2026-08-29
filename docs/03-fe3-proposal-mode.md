# FE #3 — Proposal Mode (the decision-making platform)

**Mission:** Proposal mode is **the actual product**. Simulation mode is the tutorial that
teaches the mechanic; this is where real people look at a real change to the city, rate it
on each quality, and the community's answer — not yours, and not an AI's — decides.

You own proposal browsing, the map-backed proposal detail, proposal **authoring**, the
per-quality ballot, and the results display.

**Stack:** React + Zod schemas from `/shared`. You drive FE #1's Phaser scene through the
map contract; you never touch the scene class.

## You own

### 1. Proposal list

Cards from `GET /proposals` — title, the stated **issue**, block cost, expected benefits,
status badge (open / approved / rejected / reconsider), current overall approval %. One
**default proposal is seeded** by BE #2, so the mode is demonstrable from a cold start and
your UI is never empty.

### 2. Proposal detail, on the map

Open a proposal and the shared map shows the current city **with the proposal's change
previewed** — `scene.previewChanges(proposal.changes)` ghosts the additions and dims the
removals; `scene.clearPreview()` on close. Falls back to `scene.pulseCell(location)` for a
proposal that only names a spot. Beside it: the issue, what's proposed, where, cost, who's
affected, then the ballot.

### 3. The ballot — rating the qualities

One support/oppose toggle **per quality** in the proposal's `votingMetrics` (Accessibility
👍/👎, Sustainability 👍/👎, …). Build the form from `votingMetrics` and always send all of
them — the API rejects partial ballots so aggregation stays comparable across qualities. If
`myVotes` is non-null, pre-fill it and let the user change their answer: the same `PUT` is
how re-voting works.

### 4. Results

Per-quality support bars + overall approval % + total voters, from `VotingResults`. Make it
visibly *derived from votes* — show **counts**, not just percentages. Show
`outcomeIfClosedNow` as a live hint while voting is open, labelled as a hint.

Poll `GET /proposals/{id}/results` every 5–10s while the detail view is open.

### 5. Authoring a proposal on the map

This is what "manual issues/proposals" means, and it's the feature that ties Proposal mode
back to the main mechanic:

1. State the **issue** — the problem in plain language.
2. Express the **change** by editing the map (FE #1's builder), captured as `changes[]`
   using the same shape Simulation mode's auto-proposals produce.
3. Title, description, expected benefits, affected personas (optional).
4. Pick **which qualities** the community will rate it on → `votingMetrics`.
5. `POST /proposals` → it appears in the list, open for rating.

`blockCost` should equal the summed cost of the placed blocks in `changes`; compute it from
the catalog as the user edits so they see the budget impact live.

### 6. Advisor explanation (secondary)

"Explain this proposal" → `POST /advisor/proposal-explanation` with the current
`votingResults` → render explanation + trade-offs + community readout. Never render it as a
prediction or a recommendation on how to vote.

## API you consume

Specs: `proposal-service.yaml`, `advisor-service.yaml` (mock ports 4011/4012).

| Call | Use |
|---|---|
| `GET /proposals`, `GET /proposals/{id}` | list + detail (+ `myVotes`) |
| `POST /proposals` | authoring a new proposal |
| `PUT /proposals/{id}/votes` | submit/update ballot; response includes fresh `results` — update UI instantly |
| `GET /proposals/{id}/results` | polling |
| `POST /advisor/proposal-explanation` | optional explanation panel |

Errors to handle: `409 PROPOSAL_CLOSED` (voting ended — show the outcome), `400` invalid
ballot (shouldn't happen if you build the form from `votingMetrics`).

## Integration points

- **FE #1** owns `previewChanges` / `clearPreview` / `pulseCell` on the scene. Agree the
  `changes[]` shape with FE #1 and FE #2 on day 1 — all three of you use it.
- **FE #2** produces the same `changes[]` shape for its auto-proposals. A simulated proposal
  and a real one must render on the map identically; only the surrounding UI differs.
- **BE #2** seeds the default proposal + seed votes. Agree the copy early so your UI text
  matches. Extra seeded proposals are a bonus, not a requirement.
- Quality display names and order: reuse the shared label map so simulation results and
  rating results speak the same language.
- **Hard rule:** nothing from Simulation mode is ever submitted here. Auto-ratings are not
  votes, and a simulated proposal is not a proposal.

## Done means

Open Proposal mode → the default proposal is listed → open it → the map previews the change
it would make → rate all its qualities → percentages and voter count update immediately →
change a rating → results shift → the Advisor explains the trade-offs. Then author a new
proposal by editing the map, submit it, and rate that one too.
