# P01 combat contracts

Status: version 1 minimum contract, frozen for downstream implementation slices.

This document is the integration boundary for Rift Delta. It defines data that
can cross a worker, be retained for replay, or be handed between the scenario,
engine, optimizer, trace and comparison surfaces. It does not implement a
combat simulator and does not certify any mechanic as in-game accurate.

## Boundary and ownership

P01 owns the versioned schemas, port signatures and contract fixtures. P04
owns the kernel that implements the session and queue semantics. P05–P10 own
the service implementations behind the ports. P11 owns numerical execution
and result aggregation. P21–P26 own search, worker, replay and comparison
adapters. A later slice may add a field only through an additive contract
revision and migration; it may not copy or locally redefine a shared type.

The existing Yunara simulator remains unchanged during P01. Its eventual
compatibility adapter is an edge concern: it converts legacy input into a
`ScenarioSpec` and presents a `CombatResult` back to the old caller. The
shared engine never imports the legacy simulator as a service.

## Versioning, serialization and identity

Every wire object carries `schemaVersion: 1`. The schemas are strict: unknown
object fields, executable values, `Map`, `Set`, `Date`, `undefined`, sparse
arrays, `NaN`, `Infinity` and `-Infinity` are not contract values. `null` is
used when a value is intentionally not applicable. `parseContract` returns a
typed value or throws `ContractValidationError` with actionable paths; it never
silently fills a default.

`canonicalJson` sorts object keys, preserves array order, normalizes negative
zero, and rejects values that are not JSON-safe. `hashCanonical` hashes that
byte representation with Web Crypto SHA-256 and returns
`sha256:<64 lowercase hex characters>`. This is the identity basis for replay
and cache keys. Timestamps, labels and UI text must not be substituted for a
content hash.

The following identities are deliberately separate:

| Identity               | Covers                                                  | Consumer                     |
| ---------------------- | ------------------------------------------------------- | ---------------------------- |
| `engineHash`           | engine implementation and contract-compatible revision  | run/replay parity            |
| `rulesetHash`          | pinned patch, data artifacts, modes and content mapping | all calculations             |
| `cohortHash`           | retained cohort bytes and declared weighting            | comparison/search            |
| `policyHash`           | serialized action policy and visibility rules           | action execution             |
| `resolvedScenarioHash` | all effective scenario values                           | replay                       |
| `searchContextHash`    | frozen search inputs and constraints                    | candidate enumeration/cache  |
| `candidateInputHash`   | one resolved candidate's effective simulation input     | finalist/comparison transfer |

`RunManifest` requires both search and candidate hashes and rejects equality
between them. A candidate result therefore cannot silently rewrite the frozen
search context.

## Main data contracts

The runtime schemas are exported from `src/domain/contracts`. The names below
are the public minimum; fields are intentionally explicit even when an array
or map is empty.

| Contract               | Purpose                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `RulesetManifest`      | patch/data version, retained source artifacts, supported modes and manifest hash                                   |
| `ScenarioSpec`         | serializable request before resolution, including entities, cohort, policy, objective, mode and search constraints |
| `ResolvedScenario`     | effective values plus provenance for every replay-affecting top-level field                                        |
| `EntityState`          | stable entity identity, health/resources/stats, abilities, buffs, inventory, position and origins                  |
| `ItemInstance`         | instance identity, immutable base item, effective upgraded item, slot, stacks and charges                          |
| `ActionPolicy`         | scripted or conditional-priority action DSL; no callback or function values                                        |
| `ObjectiveSpec`        | objective, metric, finite horizon, warm-up, censoring, aggregation and tie policy                                  |
| `SearchConstraints`    | slot/boot legality and a discriminated incremental-gold or final-inventory budget                                  |
| `EvaluationMode`       | analytical expectation, average-state approximation, seeded trajectory or sampled estimate                         |
| `RunManifest`          | engine/ruleset/scenario/cohort/policy/search/candidate hashes and random configuration                             |
| `MechanicEvidence`     | patch-scoped source identity, implementation status and unavailable/discrepancy disposition                        |
| `Trace` / `TraceEvent` | chronological events, causal IDs and typed effects                                                                 |
| `CombatResult`         | status, tagged metrics, censoring, result hashes and optional trace identity                                       |

### Provenance and observed state

`Provenance` is attached to each effective stat and to every top-level resolved
scenario field. An observed value requires a retained source hash. `EntityState`
keeps `statProvenance` beside `stats`, and declares whether its inventory is an
`observed-effective` snapshot or a `modeled-loadout`. Downstream snapshot
construction must not add modeled item stats to an already observed effective
stat without an explicit transformation contract.

An observed target can therefore carry an explicit health/armor vector with
`inventoryOrigin: "observed-effective"` and no invented item, stack or cooldown
state. Missing information is represented by `unknown` provenance or an
explicit unavailable evidence record; it is never promoted to an observation.

`ItemInstance.instanceId` is stable across upgrades. An upgrade changes
`effectiveItemId` and records `fromItemId`/`toItemId`; it does not create a new
instance or lose slot, charges, stacks or provenance.

Ability state has explicit `native`, `copied` and `transformed` origins. This
lets P08/P10 model copied or transformed abilities without branching the
kernel on a champion-specific identity.

## Time, ordering and visibility

Combat time is a non-negative integer number of milliseconds. The queue orders
events by `(timeMs, sequence)`. The kernel allocates a unique monotonically
increasing sequence for every scheduled event; `phase` is retained as a
semantic extension point for input, windup, impact, periodic, expiry,
lifecycle and checkpoint events. Insertion order and wall-clock time are not
ordering inputs.

`Trace` and `EventQueueSnapshot` reject out-of-order entries. Every event and
command carries stable IDs and causal predecessor IDs. A future event is only
state after it executes; it cannot mutate a current snapshot. `StateRead.kind`
distinguishes a snapshot read from an impact-time read in service requests.

Action policies receive `PolicyVisibleState`, which contains current visible
entities, readiness and declared resources. The policy visibility contract
hard-codes `allowFutureEvents: false` and `allowHiddenOpponentState: false`.
The queue, RNG internals and hidden entities are engine state, not policy input.

## Ports and failure behavior

`CombatKernelPorts` exposes narrow interfaces for stats, damage, resources,
timers, movement, targeting, lifecycle, triggers, RNG and tracing. Each call
receives a deterministic `PortContext` containing run ID, integer time,
sequence and causal IDs. Port return values are serializable and carry either
an accepted/complete result or an explicit reason. Implementations must not
read the wall clock, network, mutable UI state or hidden future state.

`EngineCommand` and `EngineEvent` are versioned serializable envelopes. The
`WorkerMessageSchema` validates command, event and bounded-step envelopes
before they cross a worker. The engine-facing `CombatEngine` has three paths
over the same session semantics:

1. `createSession(input)` starts a run.
2. `EngineSession.step({ maxEvents, untilTimeMs })` advances bounded work;
   `snapshot()` captures resumable state.
3. `resumeSession(input, snapshot)` continues the exact queue, entity/buff,
   pending-action, trigger, RNG and numerical-branch state. `run(input)` is the
   synchronous convenience entry point, not a second simulator.

Invalid contract data fails at the schema boundary. A valid but unsupported or
interrupted execution returns a typed `invalid`, `cancelled` or `incomplete`
status with a reason/result state; it is never published as a complete score.

## Numeric results and replay

`MetricValue` is tagged as `value`, `censored`, `undefined` or `not-applicable`.
There is no JSON `Infinity` or `NaN`. A killed result carries a finite TTK;
an uncensored non-kill carries a tagged censored/undefined TTK. Objective,
horizon, censoring and aggregation remain in the result's run context.

`EngineSnapshot` contains queue IDs/order, current time, entity state, buff
state, pending actions, trigger state, RNG stream/counters, numerical branch
state and typed result/status. A snapshot is data only and is safe for worker
structured clone and JSON replay.

`ExactComparisonTransferSchema` carries the selected `CombatResult`, its
`ResolvedScenario`, `RunManifest` and candidate input hash together and checks
that all four references agree. The comparison adapter must use those exact
bytes and hashes rather than fetching a new cohort or re-resolving defaults.
The legacy adapter may present the result in the old UI shape, but it cannot
change the effective scenario.

## Migration and reserved integration paths

P01 adds only the contract module, contract documentation and contract tests.
It does not edit `src/domain/types.ts`, the simulator, workers, UI, migrations,
dependency manifests or lockfiles. P04/P11 implement the session and numerical
ports; P22 supplies bounded worker driving; P24–P26 connect exact result
transfer. Any incompatible change requires:

- a new schema/contract revision and migration note;
- fixture updates proving old and new forms are not silently conflated;
- consumer migration at the owning slice; and
- advisor review before shared files change.

No P01 contract reserves a database migration number or authorizes production
data changes. The current legacy runtime remains the compatibility boundary
until a later accepted migration retires it.
