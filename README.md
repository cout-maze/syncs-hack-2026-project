# Rebuild My City

A gamified civic-planning website built for SYNCS Hack 2026, on the theme of the
**"blocks" that make up the world**.

You are a city planner with a hundred blocks and no perfect answer. Place housing,
healthcare, transport, parks, community hubs, technology and heritage on a 2.5D grid,
then meet the seven residents who have to live with your choices. Run the simulation and
watch a wheelchair user's route to healthcare fail. Hear the City Advisor explain why.
Open the Proposals tab, where citizens — not you, and not an AI — vote on what the city
should prioritise. Then rebuild.

**BUILD → TEST → DISCOVER → REBUILD.**

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
shared/    @rmc/shared: Zod schemas, types and locked ids mirroring the specs
web/       the React + Phaser frontend
server/    the Node backend (BE #1 / BE #2)
docs/      per-workstream briefs — read docs/00 first
```

## Documentation

| Doc | For |
|---|---|
| [docs/00-architecture-overview.md](docs/00-architecture-overview.md) | **Read this first** — decisions, module map, the integration contract |
| [docs/01-fe1-city-builder.md](docs/01-fe1-city-builder.md) | FE #1 — map, drag-and-drop, budget, app shell |
| [docs/02-fe2-simulation-residents.md](docs/02-fe2-simulation-residents.md) | FE #2 — simulation engine, residents, Advisor panel |
| [docs/03-fe3-proposals-voting.md](docs/03-fe3-proposals-voting.md) | FE #3 — proposals and community voting |
| [docs/04-be1-auth-city.md](docs/04-be1-auth-city.md) | BE #1 — auth and city modules |
| [docs/05-be2-proposals-advisor.md](docs/05-be2-proposals-advisor.md) | BE #2 — proposals/voting and the Advisor |
| [web/README.md](web/README.md) | Frontend handbook — ownership, conventions, the map contract |

## Ground rules

Two constraints hold the concept together, and both are load-bearing for the demo:

1. **Proposal outcomes come from citizen votes.** They are aggregated from vote rows and
   never generated, predicted or adjusted by AI.
2. **The Advisor explains; it never judges.** It translates simulation data into plain
   language and suggests changes. It does not change game state and does not score
   proposals.

The block-type ids, persona ids and the six metric names are shared across the sim
engine, the voting system and the Advisor prompts. They live in
[shared/src/constants.ts](shared/src/constants.ts) and in the specs. Changing one is a
spec change — say so before you do it.
