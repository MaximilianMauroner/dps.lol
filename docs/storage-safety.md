# Storage safety runbook

The ingestion contract is archive-first. A source match is accepted only after the original Match-
V5 response and original timeline have been compressed, written under an immutable content-addressed
key, downloaded again, decompressed, and verified for compressed checksum, compressed length,
uncompressed length, gzip encoding, and source schema. Postgres then stores a small manifest, a
pointer/provenance value, and compact typed observations.

## Safe commands

All commands print aggregates only:

```sh
bun run storage:status
bun run archive:reconcile -- --repair-orphans
bun run archive:rebuild                 # dry-run; no production rows changed
bun run archive:rebuild -- --apply      # additive rebuild of compact rows only
```

`archive:reconcile` paginates the complete bucket listing. It leaves unmanifested objects in the
`archive_orphans` ledger unless source identity, current-patch/queue/shape checks, and the existing
match state make registration safe. It never deletes an object. A pending or failed manifest whose
object is present can be repaired; a missing or checksum-invalid object remains explicitly failed
for a later retry.

The ingestion batch has explicit ceilings. Configure `INGEST_MAX_ACCEPTED_MATCHES`,
`INGEST_MAX_REQUESTS`, `INGEST_MAX_BUCKET_BYTES`, and `INGEST_MAX_PROJECTED_PG_BYTES` (or use the
corresponding command-line flags). The process stops at a boundary and records the reason in the
run cursor.

## Rebuild and backup semantics

The bucket archive is not a backup of Postgres. It cannot restore searchable metadata, manifests,
job state, typed static data, or application configuration by itself. Before any retention or
pruning work:

1. Create a Railway Postgres backup/snapshot using the project’s configured Railway backup policy,
   or run `pg_dump --format=custom --no-owner --no-privileges "$DATABASE_URL"` to an encrypted,
   access-controlled destination. Record the backup timestamp and test restore it into an isolated
   database; do not test by overwriting production.
2. Run `bun run storage:status` and `bun run archive:reconcile -- --repair-orphans`; require zero
   missing verified objects and zero unresolved integrity failures.
3. Run the default dry-run `bun run archive:rebuild`; compare source verification, compact row
   counts, and projection checksums. Restore the Postgres backup into an isolated database and
   repeat the dry-run there.
4. Run canary queries against the restored/rebuilt data and compare them with the production
   query results for the same bounded cohort.
5. Obtain an explicit retention decision before removing any old rows or source copies.

`rebuild-from-archives` is the derived-data recovery path: it reads only verified source envelopes,
reconstructs compact level observations, same-frame target vectors, and selected scenario rows, and
is dry-run by default. It does not claim to restore Postgres-only metadata.

## Existing cold data migration rule

No existing source object or hot row is pruned by the storage-safety slice. A future migration of a
misplaced value must copy it to the private bucket under a versioned/content-addressed key, verify
the downloaded bytes and envelope, insert/update a manifest, and run rebuild/count/checksum and
canary-query equivalence checks. Only after a verified Postgres backup, archive integrity pass,
rebuild equivalence, and explicit retention approval may the old value be removed. The known legacy
full `matches.raw` row and existing static `raw` columns remain detectable and untouched.
