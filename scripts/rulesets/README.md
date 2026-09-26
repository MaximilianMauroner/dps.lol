# Offline retained-source tools

Use a trusted, stable local snapshot and a `PinnedSourceSet` manifest. These tools
do not fetch sources, publish catalogs, or establish whether declared hotfix and
region mappings are historically correct. Concurrent hostile replacement of
parent directories is outside the filesystem adapter's confinement guarantee.

Verify every declared artifact's retained bytes and source-set identity:

```sh
bun scripts/rulesets/verify-retained.ts source-set.json retained-directory
```

Discover champion/item index IDs from selected artifact IDs in that manifest:

```sh
bun scripts/rulesets/discover-retained.ts source-set.json retained-directory champion-index item-index
```

The second command verifies the entire declared source set before discovering
selected indices from the same in-memory bytes. It prints canonical JSON with
source-set identity, artifact identities, source pointers, all index records,
empty-name gaps, and `undiscoveredArtifactIds`. Selection order does not change
output. Unknown, duplicate, empty or unsupported selections fail. Any verification
or discovery error produces a nonzero exit and no partial report on stdout.

Discovery preserves unnamed, nonpurchasable and inactive-map item records.
Neither a successful report nor an empty undiscovered list proves a complete
ruleset inventory, legality, implemented mechanics or combat-complete coverage.
The report only covers the explicitly declared and selected sources.

CLI limits are 1 MiB for the manifest, 16 MiB per artifact and 64 MiB total retained
bytes. Programmatic callers can supply artifact/total limits. No decompression or
production database/bucket writes occur.

# Source mapping verification

`bun scripts/rulesets/verify-source-mapping.ts <source-set.json> <retained-directory> <source-mapping.json>`
checks every declared retained file before validating the source mapping. The mapping binds one
PC patch, Data Dragon version, CommunityDragon revision, regional hotfix assignments, and explicit
mode/map/queue assignments to the verified source-set hash. Each region and mode names retained
artifact IDs as evidence. The command prints a compact hash and count report only after all checks
pass; it does not fetch, archive, publish, or certify complete mode or mechanic coverage.

Create a mapping through `buildSourceMapping` after `assertPinnedSourceSet`, then retain both
manifests and the raw artifact bytes. Reverify through `assertSourceMapping` or this command before
using an assignment. The current 26.18/16.18.1 source inventory has no accepted CommunityDragon
and mode/hotfix evidence bundle, so no real mapping manifest is published here.
