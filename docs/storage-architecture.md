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
- `matches.raw` holds the match-details JSONB; timeline responses are currently unpacked into
  `timeline_snapshots` and `snapshot_items` rather than retained as raw timeline JSON.
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
| `matches.raw` JSONB storage (`pg_column_size`)                              |     47,492 B |
| same match JSON text                                                        |     84,935 B |
| same match JSON piped directly through gzip                                 |     12,468 B |
| normalized snapshot JSON (230 rows)                                         |     73,840 B |
| normalized snapshot-item JSON (1,104 rows)                                  |     54,842 B |
| reconstructed archive object (match + snapshots + items) JSON               |    213,663 B |
| reconstructed archive object piped directly through gzip                    |     24,185 B |
| eight-row compact scenario cohort JSON                                      |      1,923 B |
| same cohort piped through gzip                                              |        454 B |

Exact row counts are: 1 patch, 173 champions, 868 items, 1 match, 10 participants, 230
snapshots, 1,104 snapshot items, 1 ingestion run, and 8 scenario samples. Scenario provenance is
kept as rows: one distinct anchor match and eight distinct target snapshots in this corpus.

A warm `scenario_samples -> timeline_snapshots -> participants` query with the current index,
filters, ordering, and limit executed in **0.248 ms** (planning 0.678 ms, 26 shared buffers hit)
on this tiny database. That is a useful shape check, not a scale claim. A local Bun benchmark of
the pure simulator took **0.437 ms** per A/B comparison for 20 targets and **42.1 ms** for a
synthetic 2,000-target cohort; machine, JIT warm-up, and target complexity make those numbers
non-representative. They do show why a bounded pack plus a worker is preferable to shipping full
logs for every row.

The current `matches.raw` value is therefore a concrete hot-Postgres duplication to remove in a
future migration: archive and verify it first, then make the hot record metadata-only (or retain a
strictly bounded emergency copy until retention proves the archive is usable). Nothing is removed
by this document.

## Tier ownership

### Hot: Postgres

Keep these searchable and typed:

- patch/static manifests and the pinned champion/item metadata required to derive stats;
- match identity, patch, game version, region, queue, duration, provenance, and archive manifest
  status/checksum/byte count;
- participant champion/team/role/rank metadata. Avoid raw PUUIDs in new client-facing data;
- current and previous **verified** patches' target snapshots, inventory item IDs, and scenario
  anchors; use compact numeric columns and indexes rather than a large JSON blob;
- `ingestion_runs`, retry/cursor state, cohort manifests, schema/data/engine versions, and
  reconciliation state.

The current `timeline_snapshots` and `snapshot_items` tables can be the first hot implementation;
an eventual `target_snapshot_hot` projection is optional, not a reason to add another database.

### Warm: bounded packs and caches

A cohort pack is keyed by all inputs that affect its meaning:

`patch + Data Dragon version + region + queue + phase/fallback + role/champion/rank filters +
corpus version + cohort version + engine/mechanics version`.

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

- one content-addressed gzip JSON object per match containing the original match details and raw
  timeline response (or a capped NDJSON equivalent when a response is too large);
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
counts, schema version, source API/corpus version, and verification state. Content-addressed keys
make retries idempotent and prevent an overwrite from being the only copy.

## Ingestion and publication flow

1. Fetch details/timeline with the existing rate-limited, retrying Riot client.
2. Canonicalize the response, gzip it, calculate SHA-256 and byte counts, and upload to the bucket
   through an S3 adapter.
3. `HEAD`/read the object and verify checksum and bytes. Do not rely on an ETag as a SHA-256 for
   all upload modes.
4. In one Postgres transaction, upsert the archive manifest as `verified`, match/participant
   metadata, hot snapshots/items, ingestion progress, and deterministic scenario rows. Publish a
   cohort manifest only after its source rows and archive manifests are verified.
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

The first request for a filter set should resolve a cohort manifest from Postgres and load one
bounded pack (or generate it asynchronously for a cold historical filter). Subsequent level,
ability-rank, build, duration, armor, and bonus-HP changes run the pure simulator locally in a Web
Worker. Summary mode returns totals, split, win rate, quantiles, and source aggregates for the
cohort. Detailed event logs are generated only for a selected representative target or an explicit
debug request.

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

This is workload-driven: the live UI needs recent patches and indexed filters, while historical
rebuilds need the cold source. A longer hot window can be enabled when usage data shows that old
patch filters are common.

There is currently no second service to sleep. The existing Postgres is a persistent database and
the Railway deployment reports `sleepApplication: false`. Keeping it running has a hidden baseline:
RAM includes the database process, OS, and filesystem cache; CPU and memory are metered while idle,
not just when a query is active. The supplied Railway rates are $10/GB-month RAM and $20/vCPU-month
CPU, so even a small always-on database can cost more than a few gigabytes of bucket storage.

Scaling this Postgres to zero is not a safe “wake on request” design: it adds cold-start/recovery
latency and there is no separate always-on broker in this project to guarantee a wake before the
UI query. The minimal choice is therefore a small always-on Postgres plus a worker/ingestion process
that is run on demand or as a bounded cron job and exits when idle. If a future web service is
added, it can have its own sleep policy; do not keep a dedicated idle ingestion worker running.
Measure actual RAM/CPU and first-query wake latency before considering a database stop/start
workflow. Bucket storage persists while compute sleeps, but bucket requests still traverse public
network paths from Railway services.

## Illustrative monthly cost model (not a bill)

The only size input measured here is one smoke match: about **24,185 compressed bytes** for a
reconstructed archive object and about **454 compressed bytes** for its eight-row cohort. This is
not representative of a complete Riot timeline corpus; replace it with p50/p95 measurements after
at least 100 matches. The table rounds to 25 KB raw archive + 2 KB derived cohort per retained
match to make the arithmetic readable.

Assumptions below are deliberately separate: retained volume is not monthly upload volume; the
Postgres RAM/CPU values are full-month average usage examples, not measurements; UI egress is an
assumed cohort response volume. Bucket egress/API operations are free according to Railway docs, but
traffic from a Railway service to a bucket or browser is service egress.

| Scale  | Retained matches; new/month | Bucket stored (raw + cohort) | Bucket storage @ $0.015/GB-mo | Monthly archive upload | Service egress for upload @ $0.05/GB | Assumed UI egress; service cost | Illustrative hot PG volume |          Illustrative PG RAM + CPU | Usage subtotal before plan credit |
| ------ | --------------------------: | ---------------------------: | ----------------------------: | ---------------------: | -----------------------------------: | ------------------------------: | -------------------------: | ---------------------------------: | --------------------------------: |
| Small  |                  1,000; 100 |                    ~0.027 GB |                      ~$0.0004 |             ~0.0025 GB |                             ~$0.0001 |               0.05 GB; ~$0.0025 |          0.05 GB; ~$0.0075 | 0.25 GB + 0.05 vCPU; $2.50 + $1.00 |                     **~$3.51/mo** |
| Medium |               10,000; 1,000 |                     ~0.27 GB |                      ~$0.0041 |              ~0.027 GB |                             ~$0.0014 |                 0.5 GB; ~$0.025 |          0.25 GB; ~$0.0375 |   0.5 GB + 0.1 vCPU; $5.00 + $2.00 |                     **~$7.07/mo** |
| Large  |             100,000; 10,000 |                      ~2.7 GB |                      ~$0.0405 |               ~0.27 GB |                             ~$0.0135 |                    5 GB; ~$0.25 |                1 GB; $0.15 |   1 GB + 0.25 vCPU; $10.00 + $5.00 |                    **~$15.45/mo** |

These totals exclude the account plan subscription and apply no credit. Railway's current docs list a
$5 Hobby subscription with $5 of included resource usage and a $20 Pro subscription with $20 of
included resource usage; apply the selected plan's credit once, not once per line item. Actual
Postgres memory/cache, CPU, volume billing semantics, cohort response sizes, and Riot payload sizes
could dominate these examples. The current 5,000 MB volume capacity is not substituted for a
measured used-volume bill.

## Why not Parquet/DuckDB yet?

Parquet plus embedded DuckDB is a good **offline history** path once there are millions of typed
snapshots, repeated columnar scans, or analysts rebuilding many cohorts. It enables partition and
column pruning without adding a server. It is not justified by 230 snapshots: gzip JSON is simpler,
portable, inspectable, and already sufficient for immutable per-match recovery. Revisit at measured
multi-million-row or multi-gigabyte history, keeping the raw gzip source and a reproducible export
version so Parquet remains a derived cache rather than the only copy.

## Smallest implementation sequence (next instruction)

1. Add typed `archive_objects` and `cohort_manifests` migrations plus a narrow S3 adapter interface;
   no provider-specific calls in the domain or UI.
2. Change ingestion to upload/verify immutable gzip objects before publishing a manifest transaction;
   keep the current normalized write path as the hot projection during a transition.
3. Add a reconciliation command and a bounded, match-balanced cohort builder that preserves joint
   vectors, weights, `matchCount`, `snapshotCount`, phase/fallback, and provenance.
4. Stop returning full event logs for every comparison row. Add a cohort endpoint and move repeated
   pure simulation to a Web Worker/browser cache; keep one selected-target debug log.
5. After an observed retention window and successful archive restore test, make `matches.raw`
   metadata-only for new rows and migrate old rows only when their archive manifests are verified.
6. Measure p50/p95 archive sizes, upload/read latency, Postgres RAM/CPU while idle, and first-request
   latency before deciding whether any service should sleep.

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
