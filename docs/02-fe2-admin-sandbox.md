# FE #2 — Admin Tools + Sandbox

**Mission:** the two editing surfaces — the government side (create/close proposals, edit the real map) and every citizen's private Sandbox playground. You reuse FE #1's map canvas in edit mode for both.

**Stack:** React + FE #1's shared map canvas component (`mode: 'edit'`), Zod schemas from `/shared`.

## You own

- **Admin mode** (visible only when `me.role === 'admin'`):
  - **Create proposal**: click a cell → empty cell offers *add*, occupied cell offers *replace* / *remove* → block-type picker (from the catalog) + title/description form → `POST /proposals`. Surface the 409s (`CELL_OCCUPIED`, `CELL_EMPTY`, `PROPOSAL_EXISTS_AT_CELL`) as inline messages.
  - **Close voting**: button on a proposal → `POST /proposals/{id}/close` → indicator greys out, counts freeze.
  - **Real-map editor**: `PUT /map/blocks/{x}/{y}` (place/replace) and `DELETE /map/blocks/{x}/{y}` (remove) — including the demo's "we decided to build it" moment: after closing a well-supported proposal, the admin makes the matching map edit and every viewer's map updates on next poll.
- **Sandbox page** (any logged-in user): `GET /sandbox` (first call copies the current real map), the same click-to-edit cell UX (`PUT`/`DELETE /sandbox/blocks/{x}/{y}`), and a **Reset** button (`POST /sandbox/reset`, confirm first — it discards their remix). No voting, no scoring — it's a toy, make it feel like one.

## API you consume

Specs: `specs/map-service.yaml`, `specs/proposal-service.yaml` (Prism ports 4010/4011).

| Call | Use |
|---|---|
| `GET /auth/me` | gate admin mode on `role` |
| `GET /catalog/block-types` | the placement palette |
| `GET /map` | base layer for the admin editor |
| `PUT /map/blocks/{x}/{y}`, `DELETE /map/blocks/{x}/{y}` | admin map edits |
| `GET /proposals`, `POST /proposals`, `POST /proposals/{id}/close` | admin proposal flow |
| `GET /sandbox`, `PUT /sandbox/blocks/{x}/{y}`, `DELETE /sandbox/blocks/{x}/{y}`, `POST /sandbox/reset` | the playground |

Every edit returns the full updated city — replace local state with the response, no diffing.

## Integration points

- **FE #1's canvas contract** (`mode`, `onCellClick(x, y, block | null)`) — agree it by end of day 1; you're its second consumer and the reason it exists.
- The admin UI is role-gated client-side for UX, but the backend enforces 403 `FORBIDDEN` — handle it gracefully anyway (e.g. token from before a reseed).
- Proposals validate against the map **only at creation**; if you edit the map under an open proposal the UI may show a mismatch. Accepted — don't build reconciliation.

## Done means

Log in as `admin@city.dev` → edit the real map (place, replace, remove) → create a proposal live → its indicator appears for a second, non-admin user → close it → counts freeze, indicator greys → as `demo@city.dev`: open Sandbox (it's a copy of the real map) → place/remove freely → reload, edits persist → Reset re-copies the current map. All against the real backend.
