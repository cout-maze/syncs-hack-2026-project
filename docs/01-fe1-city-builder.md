# FE #1 — City Builder (the shared map workspace)

**Mission:** the map is the product's main mechanic, and you own it. The 2.5D grid, the
service bar, placing/moving/removing blocks, the block budget — plus the app shell that
switches between the two modes. **Both Simulation mode and Proposal mode render your
workspace**, so this is the most reused code in the repo and the first thing judges see.
Polish matters most here.

**Stack:** React shell, **Phaser** scene for the grid map, Zod schemas from `/shared`.

## You own

- Phaser scene: 10×10 grid rendered 2.5D (isometric-ish), two-tone cartoon style,
  placement highlight states (valid / occupied / over-budget), hover tooltips per block.
- Drag-and-drop service bar (React, beside/below the canvas) → drop onto grid cells. HTML5
  drag or pointer-events into the Phaser canvas — prototype this first, it's the riskiest
  interaction.
- Block budget display (`blocksUsed / blockBudget`) and per-type costs from the catalog.
- **The workspace layout**: map + service bar + budget on one side, a mode panel on the
  other. FE #2 and FE #3 fill the panel; neither of them rebuilds the map.
- **The mode switch** — two modes, not four tabs:
  - **Simulation** — "learn how it works"
  - **Proposal** — "decide together"
  There is **no City tab and no Residents tab**. Do not add one.
- Auth screens (login/register) and city selection/creation (new city, load my city).

## API you consume

Spec: `specs/city-service.yaml` + `specs/auth-service.yaml` (mock: Prism ports 4010/4013).

| Call | Use |
|---|---|
| `POST /auth/register`, `POST /auth/login`, `GET /auth/me` | app shell auth; store JWT in memory + localStorage |
| `GET /catalog/block-types` | build the service bar (names, costs, icons, tooltips) |
| `POST /cities`, `GET /cities`, `GET /cities/{id}` | create/load city |
| `PUT /cities/{id}/blocks` | **primary save path**: mutate local state instantly on drag-drop, debounce-autosave the whole layout (~1s) |
| `POST/PATCH/DELETE .../blocks*` | granular alternatives if you prefer per-action saves |

Handle `409` on save (over budget / overlap) by rolling back to last-good local state and
toasting the `error.message`.

## The map contract

Other workstreams drive your scene through a small published interface only — they never
import the scene class. It lives in `web/src/features/builder/scene/sceneApi.ts`.

- **FE #2 (Simulation mode)** animates journeys and event effects:
  `highlightPath(blockIds)`, `setBlockState(id, 'flooded' | 'offline' | …)`,
  `animateResident({ personaId, pathBlockIds })`, `clearStates()`.
- **FE #3 (Proposal mode)** needs the map to show what a proposal *would do*. Add and own:
  - `previewChanges(changes)` — render a proposal's block delta over the current city:
    ghosted/translucent for `place`, struck-through or dimmed for `remove`, an arrow or
    before/after pair for `move`. Build it on the existing `setGhost` and
    `BlockVisualState` machinery rather than a new code path.
  - `clearPreview()` — back to the real city.
  - `pulseCell({x, y})` — "show this proposal here" (already there).

Agree any addition to this interface in the team channel — it is a cross-workstream change.

## Integration points

- Blocks carry the stable `typeId` slugs from the overview doc — never invent new ones locally.
- The scene must survive a mode switch, or be cheap enough to remount. FE #2's animation
  and FE #3's preview both assume the map is on screen in their mode.
- Personas are engine internals; you never render them.

## Done means

Register → new city → drag 5 block types on → budget updates → reload page → city persists
→ move + delete a block. Switch between Simulation and Proposal mode and the same map stays
put. `previewChanges` visibly ghosts a proposed block. All against the real backend by end
of day 1.
