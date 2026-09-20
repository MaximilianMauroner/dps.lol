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

Every persisted or worker-facing envelope carries `schemaVersion: 1`. The
schemas are strict: unknown object fields, executable values, symbol-keyed or
non-enumerable properties, accessor properties, extra array properties, `Map`,
`Set`, `Date`, `undefined`, sparse arrays, `NaN`, `Infinity` and `-Infinity`
are not contract values. `null` is used when a value is intentionally not
applicable. `parseContract` returns a typed value or throws
`ContractValidationError` with actionable paths; it never silently fills a
default.

`canonicalJson` sorts object keys, preserves array order, normalizes negative
zero, rejects hidden/accessor/executable values and extra array properties, and
rejects values that are not JSON-safe or structured-clone-safe, including
proxies and exotic objects. `hashCanonical` hashes that byte representation
with Web Crypto SHA-256 and returns
`sha256:<64 lowercase hex characters>`. This is the identity basis for replay
and cache keys. `parseContract` applies the same canonical-input rejection
before schema parsing and detaches accepted own data into null-prototype
objects, so inherited pollution, accessors, executable values or otherwise
ignored properties cannot satisfy or disappear at a Zod boundary. Timestamps,
labels and UI text must not be substituted for a content hash.

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
between them. Its status can retain an explicitly `incomplete` run, and all
timestamps require an ISO-8601 timezone; completion timestamps must follow creation. A
candidate result therefore cannot silently rewrite the frozen search context.

## Main data contracts

The runtime schemas are exported from `src/domain/contracts`. The names below
are the public minimum; fields are intentionally explicit even when an array
or map is empty.

| Contract               | Purpose                                                                                                              |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `RulesetManifest`      | patch/data version, retained source artifacts, supported modes and manifest hash                                     |
| `ScenarioSpec`         | serializable request before resolution, including entities, cohort, policy, objective, mode and search constraints   |
| `ResolvedScenario`     | effective values, policy/candidate provenance identities and provenance for every replay-affecting field             |
| `EntityState`          | stable entity and nullable owner identity, health/resources/stats, abilities, buffs, inventory, position and origins |
| `ItemInstance`         | instance identity, immutable base item, effective upgraded item, slot, stacks and charges                            |
| `ActionPolicy`         | scripted or conditional-priority action DSL; no callback or function values                                          |
| `ObjectiveSpec`        | objective, metric, finite horizon, warm-up, censoring, aggregation and tie policy                                    |
| `SearchConstraints`    | slot/boot legality and a discriminated incremental-gold or final-inventory budget                                    |
| `EvaluationMode`       | analytical expectation, average-state approximation, seeded trajectory or sampled estimate                           |
| `RunManifest`          | engine/ruleset/scenario/cohort/policy/search/candidate hashes plus full objective/evaluation configuration           |
| `MechanicEvidence`     | patch-scoped source identity, implementation status and unavailable/discrepancy disposition                          |
| `Trace` / `TraceEvent` | chronological events, causal IDs and typed effects                                                                   |
| `CombatResult`         | status, tagged metrics, censoring, result hashes and optional trace identity                                         |

### Provenance and observed state

`Provenance` is attached to each effective stat and to every top-level resolved
scenario field, including the policy and candidate identity hashes. An observed
value requires a retained source hash. `EntityState`
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

`Trace` and `EventQueueSnapshot` reject out-of-order entries, globally
duplicate trace sequences, duplicate `(timeMs, sequence)` tie keys, duplicate
queue sequence IDs and stale `nextSequence` values. Snapshot queues also reject
events earlier than their `currentTimeMs`; a past event cannot be revived by a
resume. Every event and command carries stable IDs and causal predecessor IDs.
A future event is only state after it executes; it cannot mutate a current
snapshot. `StateRead.kind` distinguishes a snapshot read from an impact-time
read in service requests.

Action policies receive a versioned `PolicyVisibleState` projection containing
only current declared entities, readiness, public health/resources/buffs and
positions. It carries the policy's `visibleEntityIds`; hidden stats, inventory,
ability internals, provenance, queue state, RNG internals and future events are
not representable in the projection. The policy visibility contract hard-codes
`allowFutureEvents: false` and `allowHiddenOpponentState: false` in v1.
The designated scenario actor must belong to the actor team. Step IDs and
priorities are unique, selector-relative actor IDs match their
commands, and tolerant tie policies carry an explicit non-negative tolerance.

## Ports and failure behavior

`CombatKernelPorts` exposes narrow interfaces for stats, damage, resources,
timers, movement, targeting, lifecycle, triggers, RNG and tracing. Each call
receives a deterministic `PortContext` containing run ID, integer time,
sequence and causal IDs. Port return values are serializable and carry either
an accepted/complete result or an explicit reason. Implementations must not
read the wall clock, network, mutable UI state or hidden future state.

`EngineCommand` and `EngineEvent` are versioned serializable envelopes. The
command schema rejects scheduling work before the command's issue time, while
complete traces require every causal ID to name an earlier event. Damage port
results reconcile attempted, absorbed, prevented, applied and overkill amounts
and bind death to zero remaining health; shields absorb damage before health.
`StatsSnapshot` and damage responses are runtime-validated against their requests.
RNG results validate value range, draw count and cumulative position. Seeded modes
must name a real random algorithm rather than the deterministic `none` sentinel,
and resource/RNG ports restore persisted state before resumed mutations or draws. The
`WorkerMessageSchema` validates command, event and bounded-step envelopes
before they cross a worker. The engine-facing `CombatEngine` has three paths
over the same session semantics:

1. `createSession(input)` starts a run.
2. `EngineSession.step({ maxEvents, untilTimeMs })` advances bounded work;
   `snapshot()` captures resumable state.
3. `resumeSession(input, snapshot)` continues the exact queue, entity/buff,
   pending-action, trigger, RNG and numerical-branch state. It must call
   `assertResumeCompatible`, which rejects non-resumable snapshots, any
   run/scenario/engine identity mismatch, or policy progress whose policy ID,
   revision, exact step IDs, or repeat counters are impossible under the scenario policy. Bounded-step results must preserve
   the snapshot interruption state and exact reason; a progress result cannot
   claim cancellation or carry an unrelated interruption reason. `run(input)`
   is the synchronous convenience entry point, not a second simulator.

Invalid contract data fails at the schema boundary. A valid but unsupported or
interrupted execution returns a typed `invalid`, `cancelled` or `incomplete`
status with a reason/result state; it is never published as a complete score.

## Numeric results and replay

`MetricValue` is tagged as `value`, `censored`, `undefined` or `not-applicable`.
There is no JSON `Infinity`, `NaN` or negative combat metric. A complete killed result must carry a
finite, non-negative, uncensored TTK. A complete non-kill result must be
right-censored with a censored TTK; interrupted/invalid results use invalid
censoring with an undefined or not-applicable TTK. Contradictory
kill/censoring combinations are rejected. Result metrics cover damage, DPS,
TTK, time to first death and time to final elimination. A complete result must
carry a value (or valid right-censoring for a time metric) for the objective's
primary metric. Every censored metric must use the transferred objective's
horizon. An exact transfer also rejects a
complete right-censored non-kill when the objective uses `fail-if-not-killed`.
Coverage-first aggregation additionally carries machine-readable killed/total
counts and weights with a weight-consistent fraction. Sampled estimates carry
effective sample count, confidence and standard errors. Uncensored elapsed-time
metrics cannot exceed the objective horizon. Sustained DPS requires a non-empty
measurement window after warm-up. Objective, horizon, censoring and aggregation
remain in the result's run context.

`EngineSnapshot` contains engine/ruleset/cohort/policy/scenario/candidate
identity, queue IDs/order, current time, entity state, buff state, pending
actions, per-step policy cursor/repeat progress, trigger state, uniquely named
RNG stream/counters, numerical branch state and typed result/status.
Pending-action, trigger and numerical-branch IDs are unique; owners must resolve;
and retained buffs may not already be expired at snapshot time. It
explicitly records `resumability` and an interruption state (`none`,
`budget-exhausted`, `cancelled`, `invalid` or `completed`). Running snapshots
are resumable; complete/incomplete/cancelled/invalid snapshots are not and must
not retain queued or pending work. Every terminal snapshot requires a matching
typed result, and step envelopes require the full result payload to equal the
snapshot result. A snapshot is data only and is safe for worker structured
clone and JSON replay.
Top-level snapshot buffs must exactly match the canonical entity-owned buff
state; they cannot disagree on stacks, sources or expiry.

`ExactComparisonTransferSchema` is itself versioned and carries the selected
complete `CombatResult`, its `ResolvedScenario`, `RunManifest` and candidate
input hash together. It checks run ID, schema version, ruleset/cohort/policy/
scenario/candidate provenance, objective identity and full evaluation
configuration. Incomplete or cancelled results cannot cross this exact
comparison boundary. The comparison adapter must use those exact bytes and
hashes rather than fetching a new cohort or re-resolving defaults. The legacy
adapter may present the result in the old UI shape, but it cannot change the
effective scenario.

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

The follow-up repair keeps contract revision `1` but makes the previously
unaccepted shape stricter: exact transfers now carry their own version and
complete objective/evaluation/provenance identities; run manifests carry full
objective/evaluation configuration; snapshots carry replay identities and
explicit resumability/interruption state; policy views are projections rather
than full `EntityState` values. A downstream consumer must adopt these fields
before resuming runs or accepting comparison transfers.

No P01 contract reserves a database migration number or authorizes production
data changes. The current legacy runtime remains the compatibility boundary
until a later accepted migration retires it.
