# FE #1 — Shared Map + Voting Popup

**Mission:** the landing experience — the shared city map with proposal indicators and the thumbs-voting popup. This is the first thing judges (and voters on their phones) see; polish matters most here.

**Stack:** React shell + canvas map renderer (Phaser / PixiJS / plain canvas — pick with FE #2, only the stylized-grid look is locked), Zod schemas from `/shared`.

## You own

- **Map canvas**: 40×40 grid, stylized 2D blocks, pan + zoom (Google-Maps feel), hover highlight. Viewable logged-out.
- **Proposal indicators**: a badge on each cell with a proposal — pulsing for `open`, greyed for `closed`. Data = `GET /proposals` keyed by `x`/`y`; refresh every ~10s.
- **Voting popup** (click an indicator): title, human summary of the change (e.g. "Replace **Park** → **Housing** at (4, 7)" built from `changeType` + `blockTypeId` + the catalog), 👍/👎 buttons with live counts, my-vote highlighted, "voting closed" state with frozen counts, and an **Explain this** button (thinking spinner for 2–8s; render `fallback: true` results identically, optionally with a small "offline summary" hint).
- **Vote interaction**: optimistic update, then the toggle contract — same thumb as `myVote` → `DELETE .../vote`, other thumb → `PUT .../vote`. Roll back and toast `error.message` on 409 `PROPOSAL_CLOSED`. Poll `GET /proposals/{id}` every ~5s while the popup is open.
- **App shell**: nav (Map / Sandbox / + Admin when `me.role === 'admin'`), auth screens (login/register), JWT in memory + localStorage. Logged-out users can browse the map and see counts; voting prompts login.

## API you consume

Specs: `specs/map-service.yaml`, `specs/proposal-service.yaml`, `specs/advisor-service.yaml`, `specs/auth-service.yaml` (Prism ports 4010/4011/4012/4013).

| Call | Use |
|---|---|
| `POST /auth/register`, `POST /auth/login`, `GET /auth/me` | app shell auth (`me.role` drives the Admin nav) |
| `GET /catalog/block-types` | names/icons/descriptions for rendering and the popup summary |
| `GET /map` | the shared city — grid + blocks |
| `GET /proposals` | indicator layer (poll ~10s) |
| `GET /proposals/{id}` | popup detail + `myVote` (poll ~5s while open) |
| `PUT /proposals/{id}/vote`, `DELETE /proposals/{id}/vote` | cast / switch / retract |
| `POST /advisor/proposal-explanation` | the Explain button |

Prism is stateless — vote toggling won't behave against mocks. Build the interaction against MSW/local state; use Prism for shapes only.

## Integration points

- **The map canvas is a shared component.** FE #2 reuses it for admin editing and the sandbox — expose `mode: 'view' | 'edit'` and an `onCellClick(x, y, block | null)` callback, and agree the interface by end of day 1.
- Block types carry the stable `blockTypeId` slugs from the overview — never invent new ones locally.
- Vote counts on screen come only from the API — never fabricate or extrapolate numbers client-side.

## Done means

Land unauthenticated → see the seeded city + indicators → open a popup, see counts → log in → vote 👍 (count +1) → switch to 👎 → retract → a closed proposal shows greyed with frozen counts → Explain renders both a real and a `fallback: true` explanation. All against the real backend.
