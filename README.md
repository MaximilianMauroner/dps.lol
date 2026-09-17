# Rift Delta

Rift Delta is an independent, patch-pinned League of Legends damage lab. It answers questions such as “Yunara’s third item: Infinity Edge or Lord Dominik’s Regards?” with an inspectable expected-value simulator and a queryable target distribution. The engine is a pure TypeScript library; the Next.js UI, Riot ingestion, and Postgres adapter are separate layers.

The current vertical slice is Yunara on patch **26.18** (Data Dragon `16.18.1`). It includes Infinity Edge, Lord Dominik’s Regards, Kraken Slayer, Runaan’s Hurricane, Berserker’s Greaves, Yunara’s passive/Q/W/R damage path, physical/magic/true mitigation, negative resistances, armor penetration, expected crits, Giant Slayer, target distributions, a breakpoint grid, and a per-event debug trace. E is represented as a surfaced mobility-only limitation.

## Run locally

```bash
bun install
cp .env.example .env.local
bun run dev
```

The UI works without either credential. It labels the target set **FIXTURE / DEMO MODE** and never presents those values as live match observations.

Useful checks:

```bash
bun run format:check
bun run lint
bun run typecheck
bun test
bun run build
```

## Postgres / Railway

The schema is isolated under `lol_dps`; migrations only create or update objects in that schema and do not drop or alter unrelated tables. Set `DATABASE_URL` to the intended Railway Postgres service and run:

```bash
bun run db:migrate
bun run data:sync
```

Railway CLI is installed, but this workspace is intentionally **not linked**: the available account projects are `Lab4Code`, `tools-platform`, `Orderly`, `LoL Esports Power Index`, and `voxtd`, and none unambiguously identifies the app database. Select the intended project/service first, then either copy its private Postgres URL into `.env.local` or run `railway link` in this directory and `railway run bun run db:migrate`. Do not point this app at a service until that choice is explicit.

## Riot ingestion

Put a Riot key in `RIOT_API_KEY` locally (never commit it), then:

```bash
bun run data:sync
bun run ingest:euw
# Optional bounded smoke run:
bun scripts/ingest.ts --region EUW1 --routing EUROPE --tiers MASTER --players 10 --matches 10
```

The ingestion path seeds Challenger/Grandmaster/Master ranked players via League-V4, resolves missing PUUIDs through Summoner-V4, deduplicates Match-V5 IDs, fetches details and timelines, retries 429/5xx responses, and persists progress in `lol_dps.ingestion_runs`. It filters to game versions beginning with `16.18` for patch 26.18. A future patch should change `LOL_PATCH`, `DDRAGON_VERSION`, and the release date in the sync command/config rather than silently using “latest”.

Timeline participant frames are stored with actual `healthMax`, armor, MR, attack stats, level, gold, and a reconstructed inventory. Scenario samples are anchored to Yunara’s first observed third completed legendary item and point to enemy snapshots at that same frame. The query falls back to bot-lane carry timing and then reports no-sample status rather than fabricating live rows. See [docs/realistic-targets.md](docs/realistic-targets.md).

## Architecture

- `src/domain/` — pure simulator, item/champion plugins, formulas, aggregation, and health derivation.
- `src/ingestion/` — Riot timeline shapes, inventory event replay, and completed-item classification.
- `src/db/` + `migrations/` — optional Postgres persistence in an isolated schema.
- `src/data/` — realistic-target query plus explicit fixture fallback.
- `src/app/` — original dark desktop-first App Router UI and API route.
- `scripts/` — migration, Data Dragon sync, and bounded Riot ingestion commands.

New champions should implement `ChampionPlugin` and be selected by the API; they do not need to modify mitigation or aggregation code.

## Current limitations

Expected crit mode averages crits instead of rolling a seeded sequence. Yunara’s Runaan’s bolts are excluded for a single target, W’s lingering damage uses one representative tick, and E contributes no damage. Temporary max-health effects can add noise to derived bonus health. Crowd control, shields, resist buffs/debuffs, turret/minion targets, and all non-Yunara champion plugins remain unsupported and are labeled rather than silently approximated.

Rift Delta is not endorsed by Riot Games. League of Legends and Riot Games are trademarks or registered trademarks of Riot Games, Inc.
