# PX — Product, Content & Integration

**Mission:** the glue nobody else owns — the seed city everyone demos on, the visual direction, the mocks that keep four people unblocked, and the demo script that wins the room.

**Stack:** whatever gets it done — Figma/Canva for mocks, a spreadsheet for the city layout, the terminal for Prism.

## You own

- **Seed content** (agree with both BEs on day 0 — they're blocked on it):
  - The city: a name, and a 40×40 layout with ~400–600 blocks that *reads* as a city (districts, a park belt, a transport spine — not noise). Deliver as JSON/CSV of `{x, y, blockTypeId}`.
  - The 3 seed proposals: real copy (title ≤80 chars, description ≤500) on real cells — one loved (~85% 👍), one contested (~50%), one opposed (~30%) — plus the vote splits BE #2 turns into rows. Optionally one pre-closed proposal for the greyed state.
- **Visual direction**: two-tone stylized block look, indicator states (open = pulsing, closed = greyed), the voting popup mock (thumbs, counts, Explain button), admin form mock. FE pair implements; you keep it coherent.
- **Mocks + shared schemas running**: the four Prism commands from the overview, and shepherding `/shared/schemas.ts` into existence on day 1.
- **Demo script** (rehearse it, own the clock):
  1. Land logged-out → the city with pulsing indicators.
  2. Click one → popup: what's proposed, 15k 👍 / 10k 👎.
  3. Log in, vote — the count ticks up. Switch. Retract. ("Your voice, one tap, reversible.")
  4. **Audience moment**: QR code → phones open the map → live votes move the counts on the big screen (needs nothing but the polling that already exists).
  5. Explain button → plain-language AI summary ("AI informs, people decide").
  6. Sandbox → remix the real city freely → Reset.
  7. Admin: create a proposal live → it appears on everyone's map → close the loved one → counts freeze → **build it** on the real map → every screen updates on next poll.
- **Judging narrative**, tied to `README.md`'s themes: genuine connection & participation (everyone votes on the same map), accessibility of civic information (one tap, plain language, works logged-out), technology serving community decisions (AI explains, never decides).
- **QA**: run every brief's "Done means" flow after each integration milestone; keep a one-page checklist; call freeze.
- **README status note** (below) and making sure nobody designs from the old `.docx`.

## Integration points

- Layout + proposal copy to the BEs by end of day 0; vote splits can trail to day 1.
- Watch for enum drift (`blockTypeId` slugs, `changeType`, `up/down`) between FE copy and specs — you're the one reading everything.

## Done means

The demo script runs end-to-end **twice** from a clean reseed with zero improvisation, on the projector and on a phone.
