# Slice ownership contract

GitHub [roadmap #3](https://github.com/MaximilianMauroner/dps.lol/issues/3) and the linked slice
issues own current requirements, acceptance, owner activity, and progress. The offline
[`scripts/plan-contract.json`](../../scripts/plan-contract.json) holds only the 31 parent issue
identities and machine-checked boundaries. Run `bun run plan:check`; `bun run check` includes it.
The validator never needs GitHub access. Changes to an active slice's path or handoff require
coordination with that slice owner before editing this contract. In particular, P02 owns the exact
future `CONTENT_TASKS.json` and `CONTENT_MANIFEST.json` claims under the P00 carve-out; P04's
kernel paths remain solely its own.

## Field inventory from the P00 snapshot

| Former `TASKS.json` field                                                                          | Disposition          | Reason                                                                                   |
| -------------------------------------------------------------------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------- |
| `schemaVersion`, `repository`                                                                      | Keep                 | Version and repository identity for offline validation.                                  |
| `baselineCommit`, `baselineTree`                                                                   | Keep                 | Immutable audited path-state reference; historical evidence remains in `baseline.md`.    |
| `roadmapIssue.number`, `.url`                                                                      | Keep                 | Issue identity/link.                                                                     |
| `roadmapIssue.updatedAt`                                                                           | Retire               | Stale issue revision snapshot.                                                           |
| `integrationOwner.role`, `.reviewer`, `.note`                                                      | Retire               | Live coordination belongs to issues and reviews.                                         |
| `contentWorkOrderTemplate`                                                                         | Retire from contract | A document location is not an ownership invariant; the child template remains available. |
| `pathStateDefinition.existsAtAuditedBaseline`, `.excludes`                                         | Retire               | Explanatory prose is now described here and enforced in code.                            |
| `tasks[].id`, `.issue`, `.url`, `.prerequisites`, `.ownedPaths`                                    | Keep                 | Slice identity, issue mapping, dependency graph, and ownership contract.                 |
| `tasks[].issueUpdatedAt`, `.title`, `.ownerLane`, `.workOrder`, `.scope`                           | Retire               | Revision, task scope, owner/status, and copied work-order prose belong to live issues.   |
| `tasks[].ownedPaths[].path`, `.existsAtAuditedBaseline`, `.excludes`, `.handoffFrom`, `.handoffTo` | Keep                 | Exact path claims, audited path state, carve-outs, and two-sided transfers.              |

`existsAtAuditedBaseline` states whether a claim matches at least one file in the immutable Git
tree, not whether it exists in the current checkout. `excludes` must be strictly narrower than
the claimed scope. A transferred carve-out requires both the sender's `handoffTo` and the
receiver's `handoffFrom` for the same scope. The validator checks wildcard syntax and overlaps;
current checkout path presence is informational.

## Validator migration matrix

| Check                                                             | Before                                  | After                                                                            |
| ----------------------------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------- |
| 31 unique P00–P30 IDs; issue #4–#34 mapping and URLs              | `check-plan.ts` over `TASKS.json`       | Same gate over `plan-contract.json`; duplicate, missing, and wrong-map fixtures. |
| Existing prerequisites and acyclic graph                          | Enforced                                | Enforced; missing and cycle fixtures.                                            |
| Audited baseline commit/tree and path-state declarations          | Enforced                                | Enforced against the same immutable Git tree.                                    |
| Safe path syntax, overlap conflicts, strict exclusions            | Enforced                                | Enforced; adversarial glob, conflict, and exclusion fixtures.                    |
| Sender/receiver handoffs, including P00→P02 and P24→P29           | Enforced for receiver claims            | Enforced in both directions; missing receiver fixture added.                     |
| Roadmap, coordination, template, and 31 work-order file existence | Required snapshot files                 | Retired; GitHub issues own their live content, and the child template remains.   |
| Local/CI entry point                                              | Manual `bun scripts/check-plan.ts` only | `bun run plan:check` included in `bun run check`.                                |

The former roadmap, coordination snapshot, `TASKS.json`, and 31 parent work orders are retired.
The content child template is retained without becoming a status board. The P00 baseline report
and product, architecture, mechanics, storage, and validation guidance remain historical or
normative records as appropriate.
