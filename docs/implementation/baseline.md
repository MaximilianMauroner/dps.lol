# P00 baseline and characterization evidence

Evidence captured on `2026-09-19` in UTC from the isolated checkout
`/home/codex/worktrees/lol-dps-p00`.

## Exact provenance

The mandatory pre-edit gate passed:

```text
pwd                                      /home/codex/worktrees/lol-dps-p00
git rev-parse --show-toplevel            /home/codex/worktrees/lol-dps-p00
git branch --show-current                rift-delta/p00-baseline
git rev-parse HEAD                       f2747db43ca89d12338982b0e7ed2f700ee2b591
git status --short --branch              ## rift-delta/p00-baseline
```

The audited starting commit and tree are exact:

- Commit: `f2747db43ca89d12338982b0e7ed2f700ee2b591`
- Tree: `c009c80956c8eb844dbbd8e75f6c820b89530d2b`
- Parent: `3d9b7fcc9d6990dab20e82d5052060aeda2919ef`
- Subject: `feat: expand optimizer coverage with modeled item mechanics`
- Commit timestamp: `2026-09-18T19:13:43Z`
- Author: Maximilian Mauroner `<github@relay.mauroner.eu>`
- Baseline compare: `git diff --quiet f2747db43ca89d12338982b0e7ed2f700ee2b591 HEAD` passed before
  the P00 edits; there was no pre-existing working-tree change.
- Repository refs at the gate: `main`, `origin/main`, `feature/optimal-build-search` and this
  worktree all resolved to the audited commit; P00 does not merge or push any ref.

The current final commit remains the same starting commit because P00 changes are intentionally
left as a local working-tree diff. No source runtime, dependency, lockfile or production file is
part of this slice.

## Authority and product requirements

Current authoritative issue bodies observed from GitHub:

- [Roadmap #3](https://github.com/MaximilianMauroner/dps.lol/issues/3), revision
  `2026-09-18T20:10:48Z`.
- [P00 #4](https://github.com/MaximilianMauroner/dps.lol/issues/4), revision
  `2026-09-18T20:10:12Z`.

The product requirement retained in the planning snapshot is a complete patch-versioned League
theorycrafting system: all combat-relevant champion/ability/passive/item/rune/summoner/buff/debuff,
defensive, utility, environment and mode mechanics and interactions; realistic match-derived
scenarios; legal complete item-combination search through one reusable engine; burst, fixed-window,
sustained-DPS and TTK objectives; and reproducible traces/explanations. Yunara is the first
integration proof, not the product scope. P00 only establishes evidence and the P01 dispatch gate.

## Source observations

These observations are static or local-fixture evidence, not claims of in-game validation:

| ID  | Observation                                                                                                                            | Exact source                                                                                                                                           |
| --- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R01 | Audited commit and commit metadata                                                                                                     | [commit f2747db](https://github.com/MaximilianMauroner/dps.lol/commit/f2747db43ca89d12338982b0e7ed2f700ee2b591)                                        |
| R03 | Pinned patch, current limits and local setup                                                                                           | [README at baseline](https://github.com/MaximilianMauroner/dps.lol/blob/f2747db43ca89d12338982b0e7ed2f700ee2b591/README.md)                            |
| R04 | Optimizer invokes the existing Yunara simulator                                                                                        | [optimizer-engine.ts](https://github.com/MaximilianMauroner/dps.lol/blob/f2747db43ca89d12338982b0e7ed2f700ee2b591/src/domain/optimizer-engine.ts)      |
| R05 | Existing `check` and benchmark commands                                                                                                | [package.json](https://github.com/MaximilianMauroner/dps.lol/blob/f2747db43ca89d12338982b0e7ed2f700ee2b591/package.json)                               |
| R06 | Archive verification, rebuild and retention safety                                                                                     | [storage-safety.md](https://github.com/MaximilianMauroner/dps.lol/blob/f2747db43ca89d12338982b0e7ed2f700ee2b591/docs/storage-safety.md)                |
| R07 | Yunara action loop, cooldowns and eager W linger mutation                                                                              | [yunara.ts](https://github.com/MaximilianMauroner/dps.lol/blob/f2747db43ca89d12338982b0e7ed2f700ee2b591/src/domain/champions/yunara.ts)                |
| R08 | Existing single-target simulation/result contracts                                                                                     | [types.ts](https://github.com/MaximilianMauroner/dps.lol/blob/f2747db43ca89d12338982b0e7ed2f700ee2b591/src/domain/types.ts)                            |
| R09 | Current legal-build validation and candidate generation                                                                                | [optimizer.ts](https://github.com/MaximilianMauroner/dps.lol/blob/f2747db43ca89d12338982b0e7ed2f700ee2b591/src/domain/optimizer.ts)                    |
| R10 | Existing worker protocol and candidate materialization                                                                                 | [optimizer-protocol.ts](https://github.com/MaximilianMauroner/dps.lol/blob/f2747db43ca89d12338982b0e7ed2f700ee2b591/src/workers/optimizer-protocol.ts) |
| R11 | Current Yunara/patch/queue data assumptions                                                                                            | [level-targets.ts](https://github.com/MaximilianMauroner/dps.lol/blob/f2747db43ca89d12338982b0e7ed2f700ee2b591/src/data/level-targets.ts)              |
| R12 | Current hardcoded UI integration                                                                                                       | [page.tsx](https://github.com/MaximilianMauroner/dps.lol/blob/f2747db43ca89d12338982b0e7ed2f700ee2b591/src/app/page.tsx)                               |
| R13 | Pure simulator and weighted comparison                                                                                                 | [simulator.ts](https://github.com/MaximilianMauroner/dps.lol/blob/f2747db43ca89d12338982b0e7ed2f700ee2b591/src/domain/simulator.ts)                    |
| R14 | Deterministic benchmark source and fixture fallback                                                                                    | [benchmark-optimizer.ts](https://github.com/MaximilianMauroner/dps.lol/blob/f2747db43ca89d12338982b0e7ed2f700ee2b591/scripts/benchmark-optimizer.ts)   |
| O01 | Credential-free W chronology probe; current output shows W at `0`, future linger at `1` mutating health, then an earlier `AA` at `0.5` | [`p00-baseline.test.ts`](../../tests/regressions/legacy-characterization/p00-baseline.test.ts)                                                         |

The `R` sources support code/provenance observations only. They do not establish that the modeled
mechanics are in-game correct. `O01` is a synthetic fixture observation and is intentionally not a
golden output.

## Storage and operational safety boundaries

The existing archive contract is archive-first: retain original Match-V5 match and timeline
responses, gzip/hash them under private content-addressed keys, download/read/verify checksums and
byte lengths before publishing a verified Postgres manifest, then derive compact typed observations.
Postgres is the hot searchable index; bounded sanitized cohort packs are warm working sets; the
private bucket is cold source storage. The bucket is not a Postgres backup. Existing legacy raw
rows remain detectable and untouched until a separately authorized backup, isolated restore,
rebuild-equivalence and retention decision.

P00 performs no ingestion, database write, archive write, production read, migration, retention
change, deployment or credential use. No private player identifiers enter the fixtures or
benchmark artifact.

Recorded operational boundaries:

- README policy: at most 1,000 new matches, 5,000 Riot requests and 1 GB compressed source upload
  per implementation run.
- Current `scripts/ingest.ts` defaults/caps: 100 players, 200 requested matches (1,000 hard cap),
  4,000 discovery candidates, 5,000 requests, 256 MiB bucket bytes and 64 MiB projected hot
  Postgres bytes; environment/CLI values are bounded only where the code applies a cap.
- Discrepancy `P00-DOC-001`: the README's 1 GB narrative and the script's 256 MiB default are not
  silently reconciled here. P18 must define the single operational contract; P30 must review it
  before any live run. This is a documented planning discrepancy, not permission to widen limits.

## Untouched baseline checks

Environment: Linux `6.8.0-139-generic`, x86_64, Intel Core i7-6700K, 6 logical CPUs, 5.8 GiB
visible memory, Bun `1.3.14`, Node `v24.13.1`.

| Command                                                                        | Result           | Runtime/resources                 | Source/counts                                                                                               | Failure or disposition                                                                                                                                                                             |
| ------------------------------------------------------------------------------ | ---------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run check`                                                                | **failed** (127) | 0.01 s; max RSS 8,960 KiB         | Not reached past `format:check`                                                                             | `prettier: command not found`; `P00-ENV-001`: validation environment must run `bun install --frozen-lockfile` and rerun before P01 acceptance. No dependency/lockfile change is authorized in P00. |
| `format:check`, `lint`, `typecheck`, `bun test`, `build` stages inside `check` | **not run**      | Short-circuited by exit 127       | N/A                                                                                                         | This is retained as not run, not called verified.                                                                                                                                                  |
| `bun run benchmark:optimizer`                                                  | **passed** (0)   | 1.63 s wall; max RSS 185,924 KiB  | Fixture source; 20 targets each; 210/910/2,730 candidates; 4,200/18,200/54,600 candidate-target simulations | No failure. Raw output and matrix are in [`benchmarks/baseline/`](../../benchmarks/baseline/).                                                                                                     |
| `bun run benchmark:optimizer --targets-dir=<sanitized-pack>`                   | **not run**      | No sanitized real cohort supplied | No production data used                                                                                     | Real-cohort performance remains unmeasured.                                                                                                                                                        |

The fixture benchmark's internal times were 140.0 ms (level 10), 264.2 ms (level 13) and 814.6
ms (level 16). They are measurements, not proof of the proposed responsiveness or memory targets.

## Characterization matrix

The focused P00 file covers these existing contracts:

- **W chronology:** the future linger must not mutate health or kill before the eligible `AA` at
  `0.5`; this assertion is intentionally expected to fail against the untouched baseline. The
  current defect is exposed, not accepted as truth; repair belongs to P04/P08/P16.
- **Cooldown waiting:** scripted `W,W` currently produces initial W at `0` and the second cast at
  `10` seconds; the characterization records current readiness behavior without simulating an
  alternative action during the gap.
- **Averaged crit:** Infinity Edge's expected attack uses current crit chance/damage algebra, not
  a sampled roll; the test derives expected raw damage from returned stats.
- **Result transfer:** the selected candidate's item IDs and per-target damage/dps transfer from
  optimizer evaluation into the existing comparison path.
- **Inventory validation:** the current validator accepts a legal 3-slot boot build and rejects
  duplicate boots with `duplicate-item` and `too-many-boots` reasons.

## Agreed benchmark matrix

| Case                   | Source                              | Shape                                   | Metrics                                          | P00 status                |
| ---------------------- | ----------------------------------- | --------------------------------------- | ------------------------------------------------ | ------------------------- |
| Legacy reference       | built-in fixture                    | levels 10/13/16, 3/4/5 slots            | candidates, target rows, internal/wall time, RSS | Measured above            |
| Representative cohort  | sanitized `targets-{10,13,16}.json` | same levels/slots and weights           | same plus provenance/pack hash                   | Not run; no pack supplied |
| Long horizon           | fixture then sanitized cohort       | many events and cooldown waits          | throughput, trace load, cancellation             | Future P22/P28            |
| Large cohort           | sanitized bounded pack              | 2,000+ joint targets                    | memory, cache, row materialization               | Future P22/P28            |
| Full catalog           | pinned complete ruleset             | legal complete builds                   | lazy generation, top-K, proof status             | Future P20/P21/P28        |
| Randomized             | retained seed set                   | seeded/sample trials                    | variance, uncertainty, replay parity             | Future P11/P26/P28        |
| Multi-entity/defensive | synthetic and observed fixtures     | shields, CC, movement, several entities | survival, objective and interaction correctness  | Future P09/P11/P27        |

## Initial P00 validation status

The plan validator must remain a standalone command and must not weaken existing checks. Final
validation in this worktree was:

| Command                                                                                                                                                                                                    | Result                      | Evidence                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun install --frozen-lockfile`                                                                                                                                                                            | **passed**                  | Bun `1.3.14`; 349 packages installed; `package.json` and `bun.lock` unchanged. Environment setup only.                                                                                                                                                          |
| `bun scripts/check-plan.ts`                                                                                                                                                                                | **passed**                  | 31 unique parents; issue/prerequisite/cycle/ownership checks passed; declared-existing `28`, declared-future `98`, current-present `33`, current-absent `93`; 0.05 s.                                                                                           |
| `bun run format:check`                                                                                                                                                                                     | **passed**                  | All repository files formatted; 2.73 s; exit `0`.                                                                                                                                                                                                               |
| `bun run check`                                                                                                                                                                                            | **failed** (1)              | Format, lint and typecheck passed. Bun test reached `93 pass / 1 fail`; the only failure is the intentional P00 W chronology regression. Build was short-circuited by the expected test failure and is separately verified below; 13.28 s; max RSS 542,892 KiB. |
| `bun test tests/cohort-cache.test.ts tests/compare-view.test.ts tests/storage-safety.test.ts tests/optimizer-engine.test.ts tests/domain.test.ts tests/optimizer.test.ts tests/optimizer-protocol.test.ts` | **passed**                  | Existing baseline suite: `89 pass / 0 fail`; 0.45 s; exit `0`. This separates pre-existing runtime behavior from the intentional P00 red test.                                                                                                                  |
| `bun test tests/regressions/legacy-characterization/p00-baseline.test.ts --test-name-pattern 'characterizes'`                                                                                              | **passed**                  | 4 pass, 1 filtered out, 0 fail; 0.04 s.                                                                                                                                                                                                                         |
| `bun test tests/regressions/legacy-characterization/p00-baseline.test.ts --test-name-pattern 'W future tick'`                                                                                              | **failed** (1, intentional) | 0 pass, 1 fail; failure is the expected old event-order defect (`attackIndex=2`, `lingerIndex=1`); 0.02 s. It is not a golden-output assertion.                                                                                                                 |
| `bun run build`                                                                                                                                                                                            | **passed**                  | Next production build completed; 33.63 s; max RSS 740,936 KiB; exit `0`.                                                                                                                                                                                        |
| `bun run benchmark:optimizer`                                                                                                                                                                              | **passed**                  | Fixture benchmark, exit `0`; untouched and post-validation captures are in `benchmarks/baseline/`; counts/rankings unchanged.                                                                                                                                   |
| `git diff --check`                                                                                                                                                                                         | **passed**                  | No whitespace errors; no source/dependency/lockfile paths changed.                                                                                                                                                                                              |

## First reviewed blocker repair validation

The reviewed repair was performed on the same isolated worktree and starting commit. The
validator now resolves the declared commit and tree with Git, verifies that the commit's tree is
the declared `baselineTree`, and compares path scopes against `git ls-tree`; newly materialized
P00 files are reported as current-present but do not change audited-baseline state. The final
plan result was 31 unique parents, 28 declared-existing paths, 100 declared-future paths, 28
audited-tree matches, 100 audited-tree absences, 33 current-present paths and 95 current-absent
paths.

| Command                                                                                                                                                                                                    | Result                      | Evidence                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun scripts/check-plan.ts`                                                                                                                                                                                | **passed** (0)              | Schema, 31 issue mappings/timestamps/prerequisites, cycle detection, audited path state, literal ancestor conflicts, strict exclusions, coherent handoffs and current artifact checks passed. |
| `bun test tests/regressions/legacy-characterization/check-plan.test.ts`                                                                                                                                    | **passed** (0)              | 6 pass, 0 fail, 21 assertions: malformed schema, audited-tree mismatch, ancestor conflict, invalid exclusion, invalid handoff and valid P00→P02 handoff.                                      |
| `bun run format:check`                                                                                                                                                                                     | **passed** (0)              | All files formatted.                                                                                                                                                                          |
| `bun run lint`                                                                                                                                                                                             | **passed** (0)              | ESLint completed without findings.                                                                                                                                                            |
| `bun run typecheck`                                                                                                                                                                                        | **passed** (0)              | TypeScript completed without errors.                                                                                                                                                          |
| `bun test`                                                                                                                                                                                                 | **failed** (1, intentional) | 99 pass, 1 fail across 100 tests; the only failure is the preserved W chronology regression (`attackIndex=2`, `lingerIndex=1`).                                                               |
| `bun run check`                                                                                                                                                                                            | **failed** (1, intentional) | Formatting, lint and typecheck passed; 8.84 s wall; the test stage reached the same 99 pass / 1 intentional fail result, so the build stage was not reached.                                  |
| `bun test tests/cohort-cache.test.ts tests/compare-view.test.ts tests/storage-safety.test.ts tests/optimizer-engine.test.ts tests/domain.test.ts tests/optimizer.test.ts tests/optimizer-protocol.test.ts` | **passed** (0)              | Existing non-P00 suite: 89 pass, 0 fail.                                                                                                                                                      |
| `bun test tests/regressions/legacy-characterization/p00-baseline.test.ts`                                                                                                                                  | **failed** (1, intentional) | 4 pass, 1 fail; only the W future-tick chronology assertion fails against the audited implementation.                                                                                         |
| `bun run build`                                                                                                                                                                                            | **passed** (0)              | Separate production build completed in 19.64 s wall after `bun run check` short-circuited.                                                                                                    |
| `bun run benchmark:optimizer`                                                                                                                                                                              | **not run for this repair** | Existing fixture-only benchmark captures and evidence were not changed; rerun was unnecessary because only planning/validator artifacts changed.                                              |

## Second reviewed blocker repair validation

The second repair adds explicit sender-side `handoffTo: ["P02"]` coordination for the two P00
content carve-outs. Broad/equivalent envelope claims now require the receiver's matching
`handoffFrom`, the sender's matching recipient, and containment in the sender's excluded scope;
exact literal transfers such as P24→P29 remain supported. Static P17/P16 exclusion boundaries
remain disjoint. Glob syntax is validated before matching and regex failures fail closed.

| Command                                                                   | Result                      | Evidence                                                                                                                                                                                |
| ------------------------------------------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun test tests/regressions/legacy-characterization/check-plan.test.ts`   | **passed** (0)              | 12 pass, 0 fail, 31 assertions; retains the original six cases and adds over-broad receiver, missing handoff, wrong recipient, exact carve-out, malformed glob and disjoint glob cases. |
| `bun scripts/check-plan.ts`                                               | **passed** (0)              | 31 unique parents; 28 audited-present, 100 audited-absent, 33 current-present and 95 current-absent; all ownership and handoff checks passed.                                           |
| `bun run format:check` / `bun run lint` / `bun run typecheck`             | **passed** (0)              | All three completed successfully.                                                                                                                                                       |
| Existing 89-test suite                                                    | **passed** (0)              | 89 pass, 0 fail.                                                                                                                                                                        |
| `bun test tests/regressions/legacy-characterization/p00-baseline.test.ts` | **failed** (1, intentional) | 4 pass, 1 fail; only the preserved W chronology assertion fails (`attackIndex=2`, `lingerIndex=1`).                                                                                     |
| `bun test`                                                                | **failed** (1, intentional) | 105 pass, 1 fail across 106 tests; the only failure is the same intentional W chronology regression.                                                                                    |
| `bun run build`                                                           | **passed** (0)              | 19.46 s wall.                                                                                                                                                                           |
| `bun run benchmark:optimizer`                                             | **not run**                 | Validator/planning-only changes did not alter benchmark evidence.                                                                                                                       |

The next integration action is for the ChatGPT advisor/orchestrator to review this P00 evidence and
dispatch P01 as the single owner of shared contracts. P00 does not claim engine correctness,
real-cohort measurement, in-game validation, production recovery or release readiness.
