# Rebuild My City

SYNCS Hack 2026. A gamified civic-planning site: place services on a limited grid, simulate who can still reach them, then let citizens vote on council proposals.

Theme: sharing underused resources, connecting cultures, genuine connection, and making essential services accessible across ability, language, age, and digital literacy.

Architecture (locked in `docs/`): one Node app, four `/api/v1` modules, four OpenAPI specs, React + Phaser on the frontend. The **City** object is the shared integration point.

## Layout

```
docs/                   team module briefs
specs/                  OpenAPI contracts (source of truth)
shared/                 Zod schemas + generated TS types
server/                 Express app — auth, city, proposals, advisor
web/                    Vite + React + Phaser
```

## Run

```bash
cp .env.example .env
npm install
npm run generate:types
npm run dev
```

- API: http://localhost:3000/api/v1
- Web: http://localhost:5173
- Demo login: `demo@city.dev` / `rebuild-city`

Without `ANTHROPIC_API_KEY`, the City Advisor returns a canned report with `fallback: true`.

Frontend can also point at Prism mocks via `VITE_API_URL` (see `docs/00-architecture-overview.md`).

## Module owners

| Module | Spec | Code |
| --- | --- | --- |
| FE #1 City builder | city + auth | `web/src/features/builder/`, app shell |
| FE #2 Sim / residents / advisor UI | city + advisor | `web/src/features/simulation/`, `residents/`, `advisor/` |
| FE #3 Proposals | proposal + advisor | `web/src/features/proposals/` |
| BE #1 Auth + city | auth + city | `server/src/modules/{auth,city}/` |
| BE #2 Proposals + advisor | proposal + advisor | `server/src/modules/{proposals,advisor}/` |

Do not invent new metric / block-type / persona ids. Change `specs/city-service.yaml` first.
