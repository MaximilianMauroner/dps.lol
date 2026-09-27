# Original archive size and resource measurement

Measured 2026-09-27 for [issue #54](https://github.com/MaximilianMauroner/dps.lol/issues/54). This is a read-only measurement of the existing private prototype corpus. No bucket object, database row, Railway setting, or retention policy was changed.

## Source and size method

The source set is every `lol_dps.archive_objects` row joined to its `lol_dps.matches` row with `object_kind='match-source'`, `status='verified'`, patch `26.18`, platform region `EUW1`, matching verified match state, and the `riot-match-timeline-v1` source schema. Each object is the gzip archive of the original Match-V5 match-details response **and** timeline response. All 1,139 matches are ranked solo queue 420. Their game start dates span 2026-09-10 through 2026-09-17. The dates contribute 112, 102, 153, 187, 188, 146, 141, and 110 objects respectively. This is the complete bounded archived prototype corpus, not a sample of derived target rows or aggregate bucket bytes. The collection favored Yunara and high-elo seed expansion, so it does not represent every patch, region, or player population.

Compressed sizes are manifest `compressed_bytes` for these source objects. The ingestion archive-first path verifies checksum and byte lengths before marking a source verified. At measurement time, 1,023 manifests recorded `downloaded-checksum` and 116 recorded the earlier `head-only` verification method. The latter are a weaker historical claim. As a direct check, two objects per game date and verification method were selected by stable `md5(object_key)` order, giving 32 objects across all eight dates and both methods. A read-only HEAD and download rechecked compressed checksum/length, uncompressed length, gzip and source-schema metadata: **32/32 passed**, including all 16 selected `head-only` objects. This validates the selected objects, not every historical `head-only` row. No raw match IDs, keys, responses, or private player data are published here.

| Source set                                        | Objects | Compressed bytes | p50 bytes | p95 bytes |    Range bytes |
| ------------------------------------------------- | ------: | ---------------: | --------: | --------: | -------------: |
| All verified original match-plus-timeline objects |   1,139 |       82,610,303 |    72,799 |    96,578 | 37,928–117,379 |
| `downloaded-checksum` subset                      |   1,023 |       74,388,752 |    72,913 |    96,522 | 37,928–117,379 |

Percentiles use PostgreSQL `percentile_cont` on individual compressed object sizes, with linear interpolation; values above are rounded to the nearest byte. The discrete all-object p95 is 96,794 bytes. The 32 downloaded objects totaled 2,279,400 compressed bytes and were verified in 7.06 seconds by a local Bun process (1.09 seconds user CPU, 0.16 seconds system CPU, 97 MiB peak RSS). This verification is a cross-check, not a second population estimate.

## Upload and rebuild resources

Fifteen logged 26.18/EUW1 ingestion runs with positive `matches_ingested` recorded 1,138 accepted matches and 5,973 seconds summed run elapsed time. They ran between 2026-09-17 11:13 and 22:03 UTC. The run duration includes Riot fetch, extraction, database work, and archive upload/verification; it is **not** isolated upload time. The archive census has one more object than those positive-run counters, so the counters must not be treated as an exact per-object upload ledger. Historical uploader CPU and peak memory were not recorded. Railway web-service CPU/memory metrics cover a different process and cannot be attributed to the local one-shot uploader.

For one successful upload of each archived source, compressed object payload alone is 82,610,303 bytes (82.61 decimal MB) sent toward the bucket. This is a **lower-bound transfer estimate**, not metered Railway service egress: it excludes request overhead, retries, verification downloads, Riot input traffic, and static or derived objects. At the illustrative `$0.05/GB` service-egress rate it would be about `$0.00413` if every payload byte were billed at that rate. Actual billing and route attribution remain unmeasured.

A new read-only `archive:rebuild` dry run checked the first 16 verified source manifests in archive ID order with `REBUILD_LIMIT=16`; it used no `--apply`. It took 8.40 seconds on the local Bun process through a read-only Postgres tunnel: 2.80 seconds user CPU, 0.69 seconds system CPU, and 120 MiB peak RSS. All 16 source archives verified. Their stored compressed sizes total 1,121,765 bytes. The dry run downloads each source once to verify and once to read, so source payload downloaded was at least 2,243,530 bytes, excluding protocol overhead. This 16-object prefix is a bounded resource probe, not a throughput or memory estimate for a full corpus rebuild.

The dry run reported **11 compact-row count mismatches and 16 missing stored projection checksums**. Its expected reconstructed rows were 44 levels, 220 targets, and 150 scenarios, while the corresponding stored compact-row counts were zero. These early archives predate parts of the compact projection. The run demonstrates source readability and resource use; it does **not** prove rebuild equivalence, backup recoverability, or safe pruning.

## Sleep-policy decision

Keep Postgres warm and retain all source archives and hot rows. The measured original archive size supports storage planning, but it does not close the recovery and rebuild discrepancies above or establish a safe Postgres sleep/wake path. No Railway sleep setting or pruning policy changes follow from this measurement. Revisit those decisions only with the backup/restore, canary, rebuild-equivalence, and deployment evidence required by [issue #34](https://github.com/MaximilianMauroner/dps.lol/issues/34), together with the resource budgets in [issue #32](https://github.com/MaximilianMauroner/dps.lol/issues/32). Web-service sleep remains a separate decision.

Reproduction used read-only SQL through `railway connect --ssh`, `verifyArchiveKey` on the deterministic 32-object sample, and the default dry-run `scripts/rebuild-from-archives.ts` with a limit of 16. Railway production variables were injected into a local process; credentials and raw source identifiers were not printed or retained in this document.
