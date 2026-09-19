# Content work-order template

P02 owns generation and dispatch of content child tasks. This template is not a content manifest
and does not authorize a P00 worker to enumerate, ingest or implement content.

## Identity

- Child ID: `P14:item:<mode>:<id-or-family>`, `P15:aux:<mode>:<id>`, or `P17:champion:<id>`
- Parent issue: `<P14|P15|P17>` and GitHub URL
- Child issue URL and revision timestamp
- Ruleset/coverage-manifest hash
- Owner and independent reviewer

## Exact scope

- Patch, mode, queue and map
- Champion/item/rune/summoner/environment IDs and forms/ranks/variants
- Mechanic IDs, trigger families and transitive dependencies
- Explicit exclusions with evidence; never omit an ID because it is expensive or unpopular

## Ownership and dependencies

- Exact source paths owned by this child
- Parent and prerequisite child issues
- Shared services/capabilities consumed from P01/P04-P12
- Any copy, possession, transformation or cross-content interaction that needs joint acceptance

## Evidence and implementation

- Pinned source artifact, field/section and retained-byte identity
- Documented formula, timing, state reads, trigger tags and uncertainty
- Implementation status: discovered, specified, implemented, tested, empirically validated
- Controlled observation protocol or explicit unavailable-observation disposition

## Tests and acceptance

- Unit/formula cases, event-order/lifecycle cases and interaction cases
- Negative/invalid cases and scenario-scoped irrelevance predicates
- Reproducible command, result and trace/replay identity
- Remaining discrepancy, invalidation condition and next integration action
