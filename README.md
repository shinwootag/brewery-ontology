# Brewery Ontology

An ontology-backed operations platform for a simulated brewery, plus a set of Claude agents that work on top of it.

Brewery data (tanks, lines, batches, bottling runs, recipes, quality tests, operators, and maintenance logs) is modeled as typed objects in Postgres. An HTTP API serves those objects and the actions that can change them. Agents read the ontology, raise flags, and submit proposals. Proposals are reviewed by a human before they take effect.

## Structure

| Path | What it is |
| --- | --- |
| `apps/ontology` | Hono + Kysely API on `:3456`. Serves object types, instances, and actions (`/api/objects`). |
| `apps/data-platform` | React + Blueprint UI (Vite) for exploring the ontology, investigating batches, and reviewing the proposals queue. |
| `apps/agents` | Claude Agent SDK agents (monitoring, planning, verification, analytics, shift report, ingredient disruption). Each agent can call only its own ontology tools. A live run dashboard is served on `:3455`. |
| `seeds/` | SQL files that create the `manufacturing` schema and load the demo data. |
| `run-sql.ts` | Applies a SQL file to the database. |

## Setup

Requires Node 22+ and pnpm.

```bash
pnpm install
cp .env.example .env   # fill in DATABASE_URL (Postgres), COURSE_NOW, ANTHROPIC_API_KEY
pnpm run-sql seeds/04-manufacturing-with-monitoring.sql
```

`COURSE_NOW` pins the date that the app and agents treat as "now". Langfuse tracing is turned on when `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` are set.

## Running

```bash
# API
pnpm --filter @ontology/ontology dev

# UI (proxies /api to :3456)
pnpm --filter data-platform dev

# An agent, e.g. fermentation monitoring
cd apps/agents
node --env-file=../../.env src/agents/manufacturing/monitoring.ts
```
