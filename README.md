# Rift Delta

Rift Delta is an independent, patch-pinned League of Legends damage lab. It answers questions such
as “Yunara’s third item: Infinity Edge or Lord Dominik’s Regards?” with an inspectable expected-value
simulator and observed target cohorts. The engine is a pure TypeScript library; the Next.js UI,
Riot ingestion, Postgres adapter, and private Railway archive are separate layers.

The shipped vertical slice is Yunara on patch **26.18** (Data Dragon `16.18.1`). It includes IE,
LDR, Kraken Slayer, Runaan’s Hurricane, Berserker’s Greaves, Yunara’s passive/Q/W/R path, physical,
magic and true mitigation, negative resistances, armor penetration, expected crits, Giant Slayer,
mortal target death/overkill semantics, a deterministic match-balanced cohort comparison, and a
selected-target damage trace. E is surfaced as a mobility-only limitation.

## Local setup

```bash
bun install
cp .env.example .env.local
# add RIOT_API_KEY only if live ingestion is desired
bun run dev
```

Without a database the app uses clearly labelled fixture/demo targets. Never put a Riot key,
database URL, bucket credential, prototype password, or session secret in git or browser code.

Checks used for this revision:

```bash
bun run format:check
bun run lint
bun run typecheck
bun test
bun run build
```

## Postgres and Railway

The schema is isolated under `lol_dps`; migrations are additive and do not drop or alter unrelated
tables. With `DATABASE_URL` set to the intended database:

```bash
bun run db:migrate
bun run data:sync
```

The existing prototype uses Railway project `rift-delta` / workspace `Lab4Code` / `production`, one
persistent Postgres, one private Railway bucket, and one lean `web` service. Postgres is deliberately
kept warm; no database sleep or scale-to-zero setting was changed. The web pool is capped at three
connections with a 30-second idle timeout and telemetry is disabled. Ingestion is a bounded command,
not a cron or polling worker.

The current hybrid layout is documented in [docs/storage-architecture.md](docs/storage-architecture.md):
original match-plus-timeline responses are gzip archived by immutable SHA-256 key, while typed
snapshots, inventories, scenario anchors, manifests, and ingestion state stay searchable in
Postgres. Existing pre-archive rows remain `legacy`; they are not falsely labelled complete source
archives.

## Private prototype access

The deployed app is a private tester prototype protected server-side by a short-lived HttpOnly,
Secure, SameSite session and throttled password login. The access password is stored only in the
ignored local file `.prototype-access` and in the Railway `web` service variable
`PROTOTYPE_ACCESS_PASSWORD`. To copy/reveal it locally when testing:

```bash
tr -d '\n' < .prototype-access
```

The session secret is in `.prototype-session-secret`; neither secret is committed or emitted to the
client. Unauthenticated page and API requests are rejected/redirected before data access.

## Riot ingestion and pinned data

Put a Riot key in `RIOT_API_KEY` locally (development/personal keys are not for public consumption),
then run a bounded command such as:

```bash
bun run data:sync
bun scripts/ingest.ts --region EUW1 --routing EUROPE \
  --tiers CHALLENGER,GRANDMASTER,MASTER --players 100 --matches 200 --max-requests 5000
```

The hard ceilings are 1,000 new matches, 5,000 Riot requests, and 1 GB compressed source upload per
implementation run. League-V4 seeds ranked players; Match-V5 details and timelines are deduplicated,
retried on 429/5xx with `Retry-After`, and checkpointed in `lol_dps.ingestion_runs`. Only completed
10-participant ranked solo games whose `gameVersion` begins with `16.18` are accepted.

Before extraction, the original match and timeline responses are wrapped, gzip-compressed, SHA-256
hashed, uploaded to the private bucket, and verified with `HEAD` metadata/byte checks. The DB manifest
is published only after that verification. Repeating a source is idempotent by match/object key;
`bun run archive:reconcile` checks manifests without deleting anything. New hot rows contain an
archive pointer rather than duplicating the raw response. Timeline snapshots retain observed
healthMax, armor, MR, level, gold, attack stats, reconstructed item IDs, anchor timing, and a
bonus-health estimate only when patch-pinned base HP is available. Missing static HP is flagged and
excluded from precise cohorts rather than converted to fake bonus health.

Yunara exact third-item anchors are followed by bot-carry and bounded minute-window fallbacks. The
true purchase/undo event timestamp is stored separately from the selected frame timestamp; repeated
nearby frames are capped and match-balanced. The UI reports distinct matches, snapshots, phase,
patch/time range, rank-known coverage, deterministic truncation, and selection bias. See
[docs/realistic-targets.md](docs/realistic-targets.md).

## Architecture and tests

- `src/domain/` — pure simulator, champion plugins, formulas, and weighted aggregation.
- `src/ingestion/` — Riot timeline types, chronological inventory replay, anchor detection.
- `src/storage/` — S3-compatible immutable source archive adapter and verification helpers.
- `src/db/` + `migrations/` — isolated Postgres persistence.
- `src/data/` — realistic target query plus explicit fixture fallback.
- `src/domain/progression.ts` + `src/data/progression.ts` — deduped Yunara level/inventory
  distributions, percentile/tail rarity, core frequencies, and the authenticated progression API.
- `src/app/` — original dark desktop-first App Router UI, login, and gated API routes.
- `src/workers/` — summary-only cohort simulation with selected-target traces.
- `scripts/` — migration, Data Dragon sync, bounded ingestion, and archive reconciliation.

The test suite covers mitigation and negative resistance, current crit/IE math, Giant Slayer bands,
inventory sell/undo, mortal overkill/censoring/ties, legal AA timing, Q/R boundaries, source archive
replay, missing static HP, anchor event/frame separation, minute tolerance, summary/trace equality,
completed-item classification, level deduplication, mode fallback, progression percentile/tail
rarity, and exact core frequencies.

## Level-aware attacker inventory

The selected Yunara level loads a sanitized distribution from verified stored timeline snapshots via
`/api/progression`. One latest frame per match/participant/level is counted; repeated frames do not
dominate. The UI reports completed legendary count, separate boot tier/components, mean/median/mode,
common cores, midrank progression percentile, `>=k` tail rarity, exact-count frequency, and exact
core frequency. A small exact-level sample widens to nearby levels and labels that fallback. Both
build cards start from the same observed default, expose every supported item slot, and preserve
manual edits until the explicit realistic-default reset. This attacker distribution is separate from
the enemy target cohort used by the Worker damage comparison.

## Current limitations and practice-tool validation

Expected crit mode is deterministic expected damage, not a probability distribution. Runaan’s bolts
are excluded for one target; W uses one representative linger tick; E, runes, shields, resist buffs,
crowd control, champion-specific temporary defenses, and other champion plugins are unsupported and
surfaced in warnings. The engine has not been claimed as in-game verified.

For a practical manual check in Practice Tool, set Yunara to level 13 with the seeded Q5/W3/R2
assumption, buy Kraken + Runaan + Berserker’s Greaves, compare IE and LDR separately, use a target
whose HP/armor/bonus HP are recorded, and compare the trace’s first-crossing/overkill labels. Keep
the same target and opener, record whether it dies within the window, and treat any discrepancy as a
mechanics-model issue rather than evidence that a tiny cohort is representative.

Rift Delta is not endorsed by Riot Games. League of Legends and Riot Games are trademarks or
registered trademarks of Riot Games, Inc.
