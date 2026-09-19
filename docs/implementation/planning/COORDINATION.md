# Rift Delta coordination rules

## Integration ownership

Integration owner and reviewer: **ChatGPT advisor/orchestrator**. This names the coordinating
review role requested by the roadmap; it does not imply that an external approval service exists.
The active slice owner supplies the evidence, and the integration reviewer records whether the
slice is accepted against the current integration commit.

Each active parent slice gets one branch, one isolated worktree and one owner. Work only inside the
declared ownership paths in [`TASKS.json`](TASKS.json). A path marked future is a planning claim,
not evidence that a directory already exists. The validator resolves `baselineCommit` and
`baselineTree`, reads the immutable Git tree, and reports audited-tree existence separately from
current filesystem state; it does not use newly materialized P00 files as baseline evidence.

## Shared-path rules

- P01 owns shared contracts and their fixtures; downstream slices request revisions through an ADR
  and migration rather than copying a local contract.
- P02 owns generated ruleset registries and, after the P00 handoff, the exact future planning
  artifacts `docs/implementation/planning/CONTENT_TASKS.json` and
  `docs/implementation/planning/CONTENT_MANIFEST.json`. P00 owns the remaining
  `docs/implementation/planning/**` envelope and explicitly excludes those two paths. P02's
  `handoffFrom: ["P00"]` claims match P00's sender-side `handoffTo: ["P02"]` coordination and are
  therefore narrow, machine-checked transfers rather than concurrent ownership. P00 does not
  generate content children or ingest source data.
- The advisor reserves dependency manifests, lockfiles, migration numbering and cross-cutting
  facade integration unless a parent issue explicitly owns the path.
- P24 owns the first `src/app/page.tsx` integration and explicitly authorizes its exact transfer
  with `handoffTo: ["P29"]`; P29 receives it only with the matching
  `handoffFrom: ["P24"]` declaration. The validator requires this two-sided agreement before
  P29 takes the path over; no broader P24 or P29 ownership is implied.
- P16 owns Yunara ID 804; P17's generic champion scope explicitly excludes that subtree.
- A missing shared service is a coordination request, not permission to create a second simulator.

## Required handoff evidence

Every parent handoff records the exact starting/current commit, changed paths, commands and exit
statuses, source/observation IDs, remaining discrepancies, performance effects, migration effects,
and the next integration action. Commands are labeled passed, failed or not run. A failed check is
never silently converted into a warning; a known incorrect behavior is never made a golden truth
just to make a test green.

## Data and operational safety

P00 and planning work use fixtures and read-only source inspection only. Do not run Riot ingestion,
write production Postgres or bucket state, change retention, deploy, or expose credentials. Future
archive work must retain original match and timeline responses before lossy extraction, verify
content-addressed bytes before publishing a manifest, and keep existing legacy rows detectable and
untouched until separately authorized backup/restore and retention decisions exist.

The current operational envelope is bounded: at most 1,000 new matches and 5,000 Riot requests in
the stated implementation policy, with the current ingest script defaulting to 256 MiB bucket
bytes, 64 MiB projected hot Postgres bytes, 100 players, 200 requested matches and a 4,000
candidate discovery cap. P00 records the README/code distinction; it does not reconcile or widen
those limits.

## Dispatch gate

P00 -> P01 is the only next integration action after this baseline handoff. P02, P03, P04 and P23
may start independently only after P01 contracts are accepted. Later work must use the graph and
the current issue bodies, not stale linked plans.
