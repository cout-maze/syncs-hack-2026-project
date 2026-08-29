# Next session — FE #1 context

Written for whoever (or whatever) picks this up next. Read
`00-architecture-overview.md` first for the product; this file is only about the
**state of the frontend right now**, and the things that are easy to get wrong.

Owner: FE #1 (maaz), branch `frontend`.

---

## 1. Where things stand

Everything below is **uncommitted** on `frontend` at the time of writing. Last
commit is `2602a98` (merge of `frontend-maaz`). Run `git status` before assuming.

The map and the UI shell both went through a visual overhaul. Three passes, in
order:

1. **Buildings** — every service type got its own silhouette instead of a coloured
   box with a glyph on top. Housing became white.
2. **Ground** — the grid became an actual road network (arterials, lane markings,
   kerbs) instead of a chessboard.
3. **UI theme** — warm blush page, cool grey cards, pure black ink, big radii,
   pill buttons, single type family.

### Commands

```bash
npm run dev
```

```bash
npm run typecheck
```

Mock backend runs in the browser (MSW). Sign in as `demo@city.dev` / `demo1234`.
`__rmcResetMocks()` in the console reseeds it.

---

## 2. Map rendering — what's where

All of it is under `web/src/features/builder/scene/`.

| File | Holds |
|---|---|
| `CityScene.ts` | The Phaser scene. Ground, buildings, roofs, camera, preview/ghost. ~1300 lines. |
| `props.ts` | `BuildingProfile` (floors, windows, roof style, footprint), housing variants, street scenery. |
| `isometric.ts` | Projection, tile constants, colour helpers (`shade`, `tint`, `nudge`). |
| `sceneApi.ts` | The **only** contract other features use. Never import `CityScene` directly. |

### Buildings

Every building is drawn the same way: extruded mass, windowed faces, then a **flat
roof with a parapet rim and a recessed deck**, then a type-specific accessory.
`RoofStyle` in `props.ts` is that accessory:

| Type | Roof |
|---|---|
| healthcare | `cross` — white helipad circle, red cross |
| education | `flagpole` |
| community_hub | `dome` |
| technology_hub | `antenna` + cool `glass` windows |
| shared_resource_hub | `skylight` — two glazed lanterns |
| culture_heritage | `pediment` — raised attic + facade columns |
| housing / everything else | `plain` |

Buildings of 2+ storeys also get deterministic rooftop clutter (plant rooms, and
~18% get a green roof), seeded per cell so it never reshuffles on redraw.

**Transport is a special case** — `paintTransportHub()`, not the normal path. It
is a glazed concourse building with an entrance awning. It was originally a
canopy on posts, which is the honest shape for a bus stop but reads as *a plate
laid over the tile* from this camera angle, because a wide flat roof covers
everything under it. If you are tempted to make it a canopy again: that was tried
twice, and the mass has to come first.

### Ground

`drawGround()`. The whole grid is one carriageway polygon, plots are laid back on
top, and the strip left showing between them is the street. Arterials every
`ARTERIAL_EVERY` (4) grid lines in a darker mix, drawn **under** the plots so they
get trimmed back to the channel for free. Lane markings are one dashed run per
road.

That structure is deliberate and it is about cost: the per-tile pass is still only
two fills (kerb + plot), same as before the roads existed. There is an older
comment in git history explaining why lane markings were once *removed* for
performance — the answer was to stop drawing per tile, not to go without.

---

## 3. The two-city model

This trips people up. There are **two** cities:

- **Personal / generated** (`cty_demo`) — per user, 30×30, budget 900. This is
  what Simulation mode edits, and what "Generate a city" replaces.
- **Council** (`cty_council`) — fixed, 10×10, the same for every user, owner
  `'council'`, seed-only. **Proposal mode shows this one**, and the seeded
  proposals' `changes`/`location` are written against it.

Fetched via `GET /cities/council` → `useCouncilCity()` (cached with
`staleTime: Infinity`). In `handlers.ts` the literal `/cities/council` route
**must stay registered before** `/cities/:cityId`, or the wildcard swallows it.

Closing the Proposals window does *not* leave the council map — only switching to
Simulation does. See the comment in `AppShell.tsx`.

Note `BlockChangeSchema` documents `blockId` as required for remove/move but does
not enforce it, and the seed proposals omit it. The scene resolves it by
coordinate fallback (`change.blockId ?? this.blockAt(...)`). Don't remove that.

---

## 4. UI theme

Tokens live in `web/src/styles/index.css` and are the single source of truth.
The map palette in `lib/visuals.ts` and the constants in `CityScene.ts` mirror
them — **change both or they drift.**

The shape of it:

- **Warm page (`paper-50` `#f4e9e1`), cool cards (`paper-100` `#eef1f5`).** That
  warm/cool split is what separates a card from the page, which is why most
  borders were removed.
- **Pure black ink**, used as a *surface* too: primary buttons, armed dock tile,
  active vote buttons, hover tooltip.
- **Radii**: `--radius-card` 28px for panels, pills for anything clickable. Nested
  `Card` uses a tighter `rounded-2xl` so the nesting stays legible.
- **Panel outlines**: `ring-[1.5px] ring-black/15`, consistent across all ten
  floating surfaces.
- **Manrope** throughout, headings at 800 / `-0.03em`.

### The one trap

`Card` is filled `bg-paper-100`. **Anything else that is also `bg-paper-100`
disappears inside it.** This already bit four components (the secondary button,
the Advisor's nested boxes, the vote buttons, the composer textarea) — all now
white or `paper-200`. If something goes invisible, check this first.

---

## 5. Chrome layout

- **Top left** — menu (`AppMenu`).
- **Top centre** — wordmark, `xl:` and up only.
- **Top right** — Simulation / Proposals mode buttons + `BudgetPill`.
- **Bottom centre** — `ServiceDock`.
- **Bottom left** — selected-block card *only*.
- **Bottom right** — hover readout **+ zoom**, in one shared flex row inside
  `CityCanvas`. They live together on purpose: both answer "where am I", and a
  shared row means they can't overlap as the zoom label's width changes. The
  hover label is passed down as `hoverLabel` from `CityWorkspace`.

`CityWorkspace` mounts once at the shell level and never unmounts — that's why
animations and selections survive opening and closing windows.

---

## 6. Gotchas that cost real time

**Stale HMR tabs.** This is the big one. A tab that has been open across file
edits or a dev-server restart accumulates errors that are *not real* —
`useCityWorkspace must be used inside <CityWorkspace>`, `onAccent is not
defined`, `Failed to resolve import`. All of these were chased at least once and
all were phantoms. **Always confirm in a freshly created tab before believing a
console error**, and check the source actually says what the error claims.

**Judging visuals in isolation.** The proposal dimming was declared broken and
debugged for a while; it had been working the whole time. It only became obvious
when the dimmed and undimmed states were put side by side. Compare, don't squint.

**The isometric roof diamond has four corners.** The first pitched-roof attempt
filled three of them and left the back open — that was the "roofs look
incomplete" bug. Any custom roof geometry needs all four.

---

## 7. Not done

- Nothing is committed. Decide what lands as one commit vs. several.
- `web/index.html` still has `class="dark"` on `<html>`, left over and unused
  (`color-scheme` is light). Harmless, but it's noise.
- Auth screens got the theme but have had the least visual review — they were
  never opened in a browser during the restyle, only edited.
- `IntroCurtain` inherited the new tokens but its composition wasn't revisited.
- Arrow-key cell navigation is still a `TODO(FE#1)` in `CityCanvas.tsx`; the grid
  is not reachable without a pointer.
