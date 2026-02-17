# ARC Raiders Data Diff Explorer

Phase 1 implementation focused on correctness and diff visibility.

## Stack

- Frontend: Vite + React (`/src`)
- Backend: Node + Express (`/server`)
- Virtualized grid: `react-window`
- Data sources: ARDB, MetaForge, RaidTheory (GitHub), optional Mahcks

## Folder Structure

- `/server`: proxy + caching + connectors + normalize/match/diff pipeline
- `/src`: UI + filters + virtualized grid + side panel + frontend types

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. Create local env config:

```bash
cp .env.example .env
```

3. Start dev mode (backend + frontend):

```bash
npm run dev
```

- Frontend: `http://localhost:5173`
- API: `http://localhost:8787/api/health`

## Docker

Build and run with Docker Compose:

```bash
docker compose up --build
```

Then open: `http://localhost:8787`

## Config

Environment variables are documented in `.env.example`.

Most important values:

- `ENABLED_SOURCES=ardb,metaforge,raidtheory` (add `mahcks` if desired)
- `CACHE_TTL_MS` for server-side source cache
- `FUZZY_MATCH_THRESHOLD` for auto-merge behavior
- `METAFORGE_INCLUDE_COMPONENTS=true` to include `needed to craft`/recycle relations from MetaForge

## API

- `GET /api/health`
- `GET /api/diff-data`

`/api/diff-data` returns:

- source summaries (version/commit, fetched time, item counts, errors)
- normalized + merged canonical rows
- diff reports with missing sources, per-field flags, recipe flag, severity 0..100

## Matching and Diff Rules

- Primary match: exact normalized name
- Fallback match: fuzzy similarity with threshold (`FUZZY_MATCH_THRESHOLD`)
- Auto-match only when fuzzy confidence is above threshold
- Diff report per canonical item includes:
  - missing sources
  - per-field differences (`name`, `type`, `rarity`, `value`, `weight`)
  - recipe differences (`inputs`/`outputs`)
  - severity score 0..100

## Adding Another Source Connector

1. Add a connector file in `/server/connectors`, implementing `SourceConnector`:
   - fetch upstream raw JSON
   - return `{ sourceId, fetchedAt, versionOrCommit, itemsRaw }`
2. Register the connector in `/server/connectors/index.ts`.
3. Extend `SourceId` in `/server/types.ts` and `/src/types.ts`.
4. Add source-specific normalization handling in `/server/services/normalize.ts`.
5. Add the source in `ENABLED_SOURCES` and update `.env.example` defaults if needed.

## Notes

- The backend acts as a proxy with in-memory caching to reduce CORS/rate-limit pressure.
- If a source fails during fetch, it is reported in source summaries and excluded from active grid columns for that run.
