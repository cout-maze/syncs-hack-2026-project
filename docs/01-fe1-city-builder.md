# FE #1 — City Builder (map + drag-and-drop)

**Mission:** the core build loop — the 2.5D grid, the service bar, placing/moving/removing blocks, and the block budget. This is the first thing judges see; polish matters most here.

**Stack:** React shell, **Phaser** scene for the grid map, Zod schemas from `/shared`.

## You own

- Phaser scene: 10×10 grid rendered 2.5D (isometric-ish), two-tone cartoon style, placement highlight states (valid / occupied / over-budget), hover tooltips per block.
- Drag-and-drop service bar (React, beside/below the canvas) → drop onto grid cells. HTML5 drag or pointer-events into the Phaser canvas — prototype this first, it's the riskiest interaction.
- Block budget display (`blocksUsed / blockBudget`) and per-type costs from the catalog.
- Tab navigation shell (City / Residents / Simulation / Proposals) and the auth screens (login/register) — you own the app shell; keep them minimal, others plug their tabs in.
- City selection/creation (new city, load my city).

## API you consume

Spec: `specs/city-service.yaml` + `specs/auth-service.yaml` (mock: Prism ports 4010/4013).

| Call | Use |
|---|---|
| `POST /auth/register`, `POST /auth/login`, `GET /auth/me` | app shell auth; store JWT in memory + localStorage |
| `GET /catalog/block-types` | build the service bar (names, costs, icons, tooltips) |
| `POST /cities`, `GET /cities`, `GET /cities/{id}` | create/load city |
| `PUT /cities/{id}/blocks` | **primary save path**: mutate local state instantly on drag-drop, debounce-autosave the whole layout (~1s) |
| `POST/PATCH/DELETE .../blocks*` | granular alternatives if you prefer per-action saves |

Handle `409` on save (over budget / overlap) by rolling back to last-good local state and toasting the `error.message`.

## Integration points

- **FE #2** renders journeys/animations on *your* Phaser scene during simulation — expose a small API from your scene (e.g. `scene.highlightPath(blockIds)`, `scene.setBlockState(id, 'flooded')`) and agree it by end of day 1.
- **FE #3** needs a "show proposal location on map" hook (optional, stretch).
- Blocks carry the stable `typeId` slugs from the overview doc — never invent new ones locally.

## Done means

Register → new city → drag 5 block types on → budget updates → reload page → city persists → move + delete a block. All against the real backend by end of day 1.
