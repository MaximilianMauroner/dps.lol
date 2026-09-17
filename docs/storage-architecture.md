# Storage architecture decision

**Date:** 2026-09-17  
**Status:** accepted as the minimal direction; implementation is deliberately deferred to a
follow-up change  
**Scope:** the existing `rift-delta` Railway project, patch-pinned Riot ingestion, and the
interactive target-distribution simulator

## Decision

Use a three-tier hybrid:

1. **Postgres is the hot index and query store.** Keep small, typed, searchable metadata,
   ingestion/deduplication state, manifests, patch-static data, and a bounded hot set of target
   vectors/scenario rows needed by the UI.
2. **A Railway S3-compatible bucket is the cold immutable archive.** Store private, compressed
   Riot match/detail/timeline responses, Data Dragon snapshots, older derived snapshots, and
   versioned cohort packs. Do not put raw Riot responses on the browser path.
3. **Cohort packs are warm working sets.** A bounded, sanitized pack is loaded once into an
   in-memory/browser cache (eventually a Web Worker). Slider/build changes run the pure TypeScript
   simulator over that pack; they do not re-query Postgres, read the archive, or call Riot.

This keeps the fast path relational and deterministic while making raw history cheap to retain.
It does not make a bucket a database: bucket-only filtering would add public-network round trips,
object parsing, and repeated egress to every interactive change. It also does not pretend that
object storage removes the always-on cost of a persistent Postgres service.

No bucket, service, setting, or data was created, moved, deleted, or changed for this decision.

## What is actually in the repository today

The current schema is isolated in [`migrations/001_initial.sql`](../migrations/001_initial.sql)
under `lol_dps`:

- `patches`, `champions`, and `items` hold patch-pinned static data.
- `matches.raw` holds the original Match-V5 match-details response as JSONB. The original
  Match-V5 timeline response is **not** retained: it is unpacked into `timeline_snapshots` and
  `snapshot_items` instead.
- During that extraction, the MVP keeps each frame timestamp, participant level/gold, selected
  `championStats` fields (`healthMax`, armor, MR, attack damage/speed, and AP when present), and
  the reconstructed item IDs at each snapshot. It replays only the item-event fields needed for
  purchase/sell/destroy/undo inventory state. Original timeline event payloads (including events
  unrelated to inventory), unused event fields, the original frame objects, and timeline metadata
  such as `frameInterval` are discarded after extraction. Scenario rows retain pointers to the
  anchor and target snapshots, not the source timeline itself.
- `participants` holds match/champion/team/role metadata and currently also has a raw PUUID
  column. PUUIDs are not needed by the UI and should not be copied into future client-facing
  packs.
- `ingestion_runs` tracks the bounded Riot job; `scenario_samples` points an anchor participant
  and timestamp at an enemy target snapshot.

The ingestion and serving paths are:

- [`scripts/ingest.ts`](../scripts/ingest.ts) fetches League-V4/Match-V5 data, replays item events,
  derives bonus-health estimates, and writes the normalized rows in one Postgres transaction per
  match.
- [`src/ingestion/inventory.ts`](../src/ingestion/inventory.ts) and
  [`src/ingestion/completed-items.ts`](../src/ingestion/completed-items.ts) own inventory replay
  and completed-item classification.
- [`src/data/realistic-targets.ts`](../src/data/realistic-targets.ts) queries the exact Yunara
  third-item phase, then bot-carry and minute-window fallbacks.
- [`src/app/api/simulate/route.ts`](../src/app/api/simulate/route.ts) queries up to 2,000 targets,
  simulates both builds, and returns `SimulationResult` event logs for the representative target
  **and every row in the comparison**.
- [`src/domain/simulator.ts`](../src/domain/simulator.ts) is pure TypeScript and is the correct
  boundary for a future worker. It currently preserves full event logs in each comparison row.

The latter two points are the main next implementation seam: fetch a cohort once and return
summary rows by default; generate a detailed event log only for an explicitly selected target.

## Verified Railway state (read-only)

The Railway CLI is linked to project `rift-delta`, workspace `Lab4Code`, environment `production`.
Current metadata shows:

- one service, a persistent Postgres deployment, currently running;
- no application/web service;
- no Railway bucket (`railway bucket list --json` is empty);
- the Postgres deployment manifest still has `sleepApplication: false`;
- a 5,000 MB Postgres volume is attached. The status view's `currentSizeMB` is not a billing
  measurement, so capacity must not be reported as used bytes.

The database contains the prior bounded smoke corpus: patch 26.18 / Data Dragon 16.18.1, one
match, 230 timeline snapshots, 1,104 snapshot-item rows, and 8 scenario samples (4
`bot-carry-third-item` and 4 `minute-window`). The only ingestion run is `stopped` after 10
players/matches were examined and 1 match was persisted. No broad live ingestion was started.

## Measurements from the current database

These are read-only measurements taken on 2026-09-17. They are **one-match smoke-corpus
measurements, not production sizing or latency guarantees**.

| Measurement                                                                 |        Value |
| --------------------------------------------------------------------------- | -----------: |
| `lol_dps` table relation bytes (including table indexes/toast per relation) |  3,727,360 B |
| `lol_dps` index bytes (reported separately by `pg_stat_user_indexes`)       |    491,520 B |
| whole database size                                                         | 11,933,375 B |
| `matches.raw` JSONB storage (match-details response; `pg_column_size`)      |     47,492 B |
| same match-details JSON text                                                |     84,935 B |
| same match-details JSON piped directly through gzip                         |     12,468 B |
| normalized snapshot JSON (230 rows)                                         |     73,840 B |
| normalized snapshot-item JSON (1,104 rows)                                  |     54,842 B |
| **reconstructed** object (match details + normalized rows) JSON             |    213,663 B |
| **reconstructed** object piped directly through gzip                        |     24,185 B |
| eight-row compact scenario cohort JSON                                      |      1,923 B |
| same cohort piped through gzip                                              |        454 B |

Exact row counts are: 1 patch, 173 champions, 868 items, 1 match, 10 participants, 230
snapshots, 1,104 snapshot items, 1 ingestion run, and 8 scenario samples. Scenario provenance is
kept as rows: one distinct anchor match and eight distinct target snapshots in this corpus.

A warm `scenario_samples -> timeline_snapshots -> participants` query with the current index,
filters, ordering, and limit executed in **0.248 ms** (planning 0.678 ms, 26 shared buffers hit)
on this tiny database. That is a useful shape check, not a scale claim. A local Bun benchmark of
the **engine only** took **0.437 ms** per A/B comparison for 20 targets and **42.1 ms** for a
synthetic 2,000-target cohort; machine, JIT warm-up, and target complexity make those numbers
non-representative. They are not browser, Web Worker, network, or end-to-end measurements.

### Scope correction for the archive-size measurements

The 213,663-byte / 24,185-byte object is reconstructed from the match-details JSONB plus the
normalized snapshot and inventory tables. It does **not** contain the original Match-V5 timeline
response or the discarded event/frame fields described above. The 454-byte cohort is likewise only
the current eight-row derived sample. Neither measurement is a complete Riot archive size, a
compression ratio for original match-plus-timeline responses, or a defensible full-corpus cost
forecast. The future archive must capture the original match response and original timeline response
before lossy extraction so inventory, anchor timing, and new extractors can be rebuilt later.

The current `matches.raw` value is therefore a concrete hot-Postgres duplication to remove in a
future migration: archive and verify the match details **and the original timeline response**
first, then make the hot record metadata-only (or retain a strictly bounded emergency copy until
retention proves the archive is usable). Nothing is removed by this document.

## Tier ownership

### Hot: Postgres

Keep these searchable and typed:

- patch/static manifests and the pinned champion/item metadata required to derive stats;
- match identity, patch, game version, region, queue, duration, provenance, and archive manifest
  status/checksum/byte count;
- participant champion/team/role/rank metadata. Avoid raw PUUIDs in new client-facing data;
- current and previous **verified** patches' target snapshots, inventory item IDs, and scenario
  anchors; use compact numeric columns and indexes rather than a large JSON blob;
- `ingestion_runs`, retry/cursor state, cohort manifests, source schema/extractor/dataset
  versions, separate engine/mechanics versions, and reconciliation state.

The current `timeline_snapshots` and `snapshot_items` tables can be the first hot implementation;
an eventual `target_snapshot_hot` projection is optional, not a reason to add another database.

### Warm: bounded packs and caches

A cohort pack is keyed by all inputs that affect its meaning:

`patch + Data Dragon version + region + queue + phase/fallback + role/champion/rank filters +
corpus version + cohort version + source schema/extractor/dataset versions`.

Result caches add the complete scenario configuration (level, ability ranks, builds, actions,
duration, crit mode, target mode, and mitigation inputs) plus the engine/mechanics version. A
change to simulation math therefore invalidates results without requiring raw source objects to be
reuploaded.

Each vector remains joint and carries at least:

`healthMax, bonusHealthEstimate, armor, magicResist, level, item IDs, role, target champion,
anchor timestamp/minute, source/provenance, fallback label, match/sample identity (private), and a
weight`.

Do not build a “median enemy” by combining independent field medians. A pack can include p25,
median, and p75 summaries for display, but simulation uses complete observed vectors so HP, armor,
MR, level, role, items, and anchor timing correlations survive.

Deduplicate and weight by match and anchor: cap nearby frames from one participant, give each match
bounded influence, and retain separate `matchCount` and `snapshotCount`. A UI should say, for
example, “8 snapshots from 1 match”, not imply eight independent games. Exact Yunara, bot-carry,
and minute-window phases remain explicit; a fallback must never be silently relabeled as exact.

The first pack format should be compact JSON (gzip at rest and over the wire), optionally capped
NDJSON for streaming generation. Keep a small server LRU and browser Cache API/IndexedDB cache if
needed; do not add Redis for this workload. The browser should receive only sanitized, bounded
vectors and summaries. If packs are client-signed later, sign the canonical bytes and include the
engine/data versions in the signed envelope.

### Cold: private bucket archive

Use a Railway bucket by default when implementation is authorized. Keep it private and use the
S3 adapter boundary so another S3-compatible provider remains possible.

Initial objects:

- one content-addressed gzip JSON object per match containing the original match-details response
  **and original timeline response captured before extraction** (or a capped NDJSON equivalent when
  a response is too large);
- patch-pinned Data Dragon/static snapshots;
- older normalized snapshot exports and reproducible cohort-pack versions;
- optional manifests/checksums alongside the objects, never credentials in the object body.

Use a hash-based key (not a public raw player/match identifier), for example:

```text
raw/patch=26.18/region=EUW1/sha256=<content-hash>/match-timeline.json.gz
static/ddragon=16.18.1/sha256=<content-hash>/snapshot.json.gz
cohort/patch=26.18/phase=yunara-third-item/cohort=<version>.json.gz
```

The Postgres manifest maps private source identity to key, checksum, compressed/uncompressed byte
counts, source schema/extractor/dataset versions, source API/corpus version, and verification
state. Content-addressed keys make retries idempotent and prevent an overwrite from being the only
copy.

## Ingestion and publication flow

1. Fetch details/timeline with the existing rate-limited, retrying Riot client and retain both
   original responses in memory until the source archive write is complete.
2. Canonicalize the original match-plus-timeline source, gzip it, calculate SHA-256 and byte counts,
   and upload it to the bucket through an S3 adapter **before lossy extraction**.
3. `HEAD`/read the object and verify checksum and bytes. Do not rely on an ETag as a SHA-256 for
   all upload modes.
4. In one Postgres transaction, upsert the archive manifest as `verified`, match/participant
   metadata, compact typed phase/target rows, ingestion progress, and deterministic scenario rows.
   Keep extra per-minute hot snapshots only when supported queries justify them and a configurable
   byte/patch budget allows them. Publish a cohort manifest only after its source rows and archive
   manifests are verified.
5. A reconciliation job handles the unavoidable lack of cross-system atomicity:
   - upload succeeded, DB failed: retain the immutable object, record/recover it as an orphan or
     pending manifest, and never delete an unknown object during routine cleanup;
   - DB says `pending_upload`, object missing: retry the upload and do not advertise the cohort;
   - DB and object both verified: the row is eligible for hot retention/compaction.

All steps are safe to repeat by content hash and unique source/corpus keys. Retention may delete a
derived hot row only after at least one verified raw archive and a verified reusable derived pack
exist. Railway currently lacks native bucket lifecycle/object-versioning/object-lock guarantees, so
immutability, retention, and recovery are application responsibilities.

## Interactive query flow

The first implementation slice should separate cohort retrieval from build changes: resolve a cohort
manifest from Postgres and load one bounded pack (or generate it asynchronously for a cold
historical filter), then let subsequent level, ability-rank, build, duration, armor, and bonus-HP
changes run the pure simulator locally in a Web Worker. Summary-only cohort mode returns totals,
split, win rate, quantiles, and source aggregates. Detailed event logs are generated only for a
selected representative target or an explicit debug request. Enforce byte limits as well as target
counts; the worker avoids introducing an always-on Redis/cache service for this workload.

Large historical filters must be labeled **building/async** rather than pretending to be an instant
query. Raw archives stay private and are never scanned for each slider event.

Cache invalidation is versioned, not time-only: a patch/static change, Riot corpus correction,
cohort sampling rule, schema change, or mechanics/engine change creates a new key. Raw immutable
objects remain useful across engine revisions; only derived packs/results need rebuilding.

## Retention and “sleep when unused”

Recommended defaults are configurable, not applied yet:

- keep current and previous **verified** patches in Postgres hot tables;
- keep older raw match/timeline archives and static snapshots in the private bucket;
- retain at least one verified cohort pack for every published phase/filter family before removing
  old hot snapshots;
- never delete the only usable raw or derived copy; keep a manifest/tombstone for every retirement.

No delete/prune job is enabled until archive checksums and a rebuild/restore test pass. Archive blobs
also do not back up Postgres-only manifests, ingestion state, or hot projections; those require a
separate Postgres backup/recovery plan.

This is workload-driven: the live UI needs recent patches and indexed filters, while historical
rebuilds need the cold source. A longer hot window can be enabled when usage data shows that old
patch filters are common.

There is currently no second service to sleep. The existing Postgres is a persistent database and
the Railway deployment reports `sleepApplication: false`. Keeping it warm has a hidden baseline:
RAM includes the database process, OS, and filesystem cache; CPU and memory are metered while idle,
not just when a query is active. The supplied Railway rates are $10/GB-month RAM and $20/vCPU-month
CPU, so even a small always-on database can cost more than a few gigabytes of bucket storage.

Railway's current [serverless deployment documentation](https://docs.railway.com/deployments/serverless)
says the sleep flag takes effect on a **new deployment** and that a sleeping service wakes on
internet or private-network traffic. The existing `sleepApplication: false` observation therefore
does not prove that sleep/wake is unavailable. However, this specific Postgres has not had sleep,
wake, reconnect, recovery, or first-query latency safely verified, and Railway's
[cut-idle-costs guide](https://docs.railway.com/guides/cut-idle-costs-serverless) lists databases
as a poor fit for this pattern. Budget this database as warm for now; make no stop/start automation
or service change in this task. A future worker/ingestion process should run on demand or as a
bounded cron job and exit when idle. If a web service is added, test its sleep policy separately.
Bucket storage persists while compute sleeps, but bucket requests from Railway services still use
public network paths.

## Illustrative monthly cost model (not a bill)

The 24,185-byte value above is a **reconstructed** object, not a complete original Riot
match-plus-timeline archive. It must not be used to estimate corpus storage, compression savings,
or upload volume. Until original source archives have been captured and measured across a useful
sample, use variables rather than a scale table.

```text
A = verified compressed bytes per original match-details + original timeline object
C = verified compressed bytes per derived cohort contribution
retained bucket GB = retained matches * (A + C) / 1,000,000,000
monthly upload egress = new matches * (A + C) / 1,000,000,000 * $0.05
bucket storage = retained bucket GB * $0.015/month
```

Relevant Railway rates are: bucket storage `$0.015/GB-month`; unlimited/free S3 operations and
bucket egress; service egress `$0.05/GB`; volume storage `$0.15/GB-month`; RAM `$10/GB-month`; and
CPU `$20/vCPU-month`. The $5 Hobby and $20 Pro plan credits/subscriptions must be applied once to
the account total, not once per line item. Persistent Postgres RAM/CPU/cache is the likely baseline
cost to measure; the current 5,000 MB volume capacity is not a measured used-volume bill.

## Why not Parquet/DuckDB/DuckLake yet?

Gzip JSON is the first format: simple, inspectable, portable, and sufficient for immutable
per-match recovery. Partitioned Parquet plus embedded DuckDB (or DuckLake, with a Postgres catalog
and Parquet object storage) becomes useful only when measured historical scans, column pruning, or
repeated cohort rebuilds justify it. It is not required by the current 230-snapshot cohort-serving
workflow. Revisit at measured multi-million-row or multi-gigabyte history, keeping the original
gzip source and a reproducible export version so columnar files remain derived data rather than the
only copy.

## Smallest implementation sequence (next instruction)

1. Make cohort retrieval separate from build changes: return summary-only cohort results, keep a
   detailed event log only for selected traces, enforce byte limits as well as target counts, and
   move repeated pure simulation to a Web Worker/browser cache. Do not add an always-on Redis/cache
   service.
2. Add typed `archive_objects` and `cohort_manifests` migrations plus a narrow S3 adapter. Capture
   the original match and timeline responses, gzip them, checksum/size them, and publish immutable
   versioned keys before lossy extraction.
3. Add reconciliation and a bounded, match-balanced cohort builder that preserves complete joint
   vectors, item IDs, weights, `matchCount`, `snapshotCount`, phase/fallback, and provenance.
4. Keep compact typed phase/target rows in Postgres. Retain extra per-minute hot snapshots only
   when supported queries justify them and a configurable byte/patch budget allows them; do not
   duplicate unbounded minutes alongside scenarios.
5. Store source schema/extractor/dataset versions separately from engine/mechanics versions. Raw
   objects should not be reuploaded for a math-only change; result keys must include engine version
   and the full scenario configuration.
6. After checksum verification and a successful rebuild/restore test, consider metadata-only
   `matches` rows for new data and conservative hot retention. Do not enable deletion/pruning until
   the recovery path is proven. Measure p50/p95 original archive sizes and resource usage before
   revisiting sleep policy.

No step requires Kubernetes, Redis, Kafka, ClickHouse, or a second database.

## Risks and hard objection

- **Public network:** Railway buckets are private but not on Railway private networking. Service
  uploads and browser responses can incur service egress and add latency. This is the reason the
  archive is never the slider query path.
- **No provider-managed retention/versioning:** Railway's current bucket documentation lists object
  versioning, object locks, and lifecycle configuration as not yet supported. Application-managed
  content-addressed keys, manifests, checksums, and conservative cleanup are mandatory.
- **Raw identifiers/privacy:** raw Riot responses and PUUIDs must remain private. Do not put raw
  payloads or unbounded match identifiers in client packs, logs, or public URLs.
- **Sampling bias:** repeated frames and long matches can overwhelm a naïve cohort. Preserve whole
  observed vectors, cap/weight by match and anchor, and expose match versus snapshot counts.
- **Cross-store atomicity:** S3 and Postgres cannot commit as one transaction. The manifest state
  machine and reconciliation flow above are required.
- **Cold historical filters:** a large archive rebuild is asynchronous; the UI must say so.
- **Hard objection:** if the requirement is provider-enforced object locking/versioning, private
  networking, or managed server-side encryption rather than application-level safeguards, Railway
  Buckets are not sufficient and a different object store should be selected behind the same adapter.
  For the stated cost/speed goal and bounded UI cohorts, that objection is not present today.

## Sources checked

- [Railway Storage Buckets](https://docs.railway.com/storage-buckets) — private S3-compatible buckets,
  immutable region, public-network connectivity, supported/not-yet-supported S3 features, and
  comparison pricing.
- [Railway Storage Buckets Billing](https://docs.railway.com/storage-buckets/billing) —
  $0.015/GB-month, unlimited/free S3 operations and bucket egress, and the service-egress caveat.
- [Railway Pricing Plans](https://docs.railway.com/pricing/plans) — current RAM, CPU, volume,
  network-egress rates and plan credits.
- [Railway Serverless Deployments](https://docs.railway.com/deployments/serverless) — sleep takes
  effect on a new deployment and sleeping services wake on internet/private-network traffic.
- [Cut idle costs with serverless](https://docs.railway.com/guides/cut-idle-costs-serverless) —
  databases are called out as a poor fit for this sleep pattern.
