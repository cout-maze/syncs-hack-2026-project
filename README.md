# Rebuild My City

A gamified civic-planning website built for SYNCS Hack 2026, on the theme of the
**"blocks" that make up the world**.

You are a city planner with a hundred blocks and no perfect answer. Place housing,
healthcare, transport, parks, community hubs, technology and heritage on a 2.5D grid.
That map is the whole product — and it has two modes.

**Simulation mode** teaches you the mechanic. Build freely, hit Run, and the city tells on
itself: a wheelchair user's route to healthcare fails, resilience collapses in a flood. The
system raises the issues, drafts proposals to fix them, and rates each one automatically —
so you can see, in sixty seconds, that every block changes what happens to everyone else.

**Proposal mode** is the real thing: a decision-making platform. Someone states an issue,
expresses the fix by editing the map, and the community rates it on each quality —
accessibility, sustainability, efficiency, community, resilience, inclusion. The outcome
comes from those votes. Not from you, and not from an AI.

**BUILD → TEST → DISCOVER → REBUILD** in Simulation mode.
**PROPOSE → RATE → DECIDE** in Proposal mode.

> A city is not a collection of buildings. It is a network of people, resources,
> technology and relationships — and every block changes what happens to everyone else.

## Quick start

```bash
npm install
npm run dev
```

http://localhost:5173 — sign in as `demo@city.dev` / `demo1234`.

No backend needed: the frontend ships with a stateful in-browser mock of all four
services. See [web/README.md](web/README.md) for how to point it at Prism or the real
backend instead.

## Repo layout

```
specs/     the four OpenAPI contracts — the source of truth, PR-reviewed
shared/    @rmc/shared: Zod schemas, types, locked ids, and the city generator
web/       the React + Phaser frontend (features/builder is the shared map both modes use)
server/    the Node backend (BE #1 / BE #2)
docs/      per-workstream briefs — read docs/00 first
```

## Documentation

| Doc | For |
|---|---|
| [docs/00-architecture-overview.md](docs/00-architecture-overview.md) | **Read this first** — decisions, module map, the integration contract |
| [docs/01-fe1-city-builder.md](docs/01-fe1-city-builder.md) | FE #1 — the shared map workspace, drag-and-drop, budget, app shell, mode switch |
| [docs/02-fe2-simulation-mode.md](docs/02-fe2-simulation-mode.md) | FE #2 — Simulation mode: sim engine, auto-issues, auto-proposals, auto-rating, Advisor |
| [docs/03-fe3-proposal-mode.md](docs/03-fe3-proposal-mode.md) | FE #3 — Proposal mode: authoring, per-quality rating, results |
| [docs/04-be1-auth-city.md](docs/04-be1-auth-city.md) | BE #1 — auth and city modules |
| [docs/05-be2-proposals-advisor.md](docs/05-be2-proposals-advisor.md) | BE #2 — proposals/voting and the Advisor |
| [web/README.md](web/README.md) | Frontend handbook — ownership, conventions, the map contract |

## Ground rules

Three constraints hold the concept together, and all three are load-bearing for the demo:

1. **Proposal outcomes come from citizen votes.** They are aggregated from vote rows and
   never generated, predicted or adjusted by AI.
2. **The Advisor explains; it never judges.** It translates simulation data into plain
   language and suggests changes. It does not change game state and does not score
   proposals.
3. **Simulated is never real.** Simulation mode's auto-issues, auto-proposals and
   auto-ratings are computed in the browser, deterministically from the sim, and thrown
   away on reload. They are never submitted to the proposals API and never stored as votes.

There is **no Residents tab**. The seven need profiles ("personas") exist only as inputs to
the simulation engine, which walks each of them to the services they need and reports the
routes that fail.

The block-type ids, persona ids and the six quality names are shared across the sim
engine, the rating system and the Advisor prompts. They live in
[shared/src/constants.ts](shared/src/constants.ts) and in the specs. Changing one is a
spec change — say so before you do it.
