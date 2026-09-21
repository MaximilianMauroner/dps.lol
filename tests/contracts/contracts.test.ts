import { describe, expect, test } from "bun:test";
import {
  ActionPolicySchema,
  ActionCommandSchema,
  assertDamageResolution,
  assertEngineRun,
  assertEngineInputCompatible,
  assertExactComparisonTransfer,
  assertLifecycleResolution,
  assertMovementResolution,
  assertResolvedScenarioPolicyHash,
  assertRngResult,
  assertResourceResolution,
  assertTargetingResolution,
  assertTimerCancelResult,
  assertTimerPeekResult,
  assertTriggerDispatchResult,
  assertStatsSnapshot,
  assertResumableSnapshot,
  assertResumeCompatible,
  CombatResultSchema,
  ContractValidationError,
  ContractSchemas,
  DamageResolutionSchema,
  EngineCommandSchema,
  EngineEventSchema,
  EngineStepResultSchema,
  EngineSnapshotSchema,
  EntityStateSchema,
  ExactComparisonTransferSchema,
  ItemInstanceSchema,
  ResolvedScenarioSchema,
  RunManifestSchema,
  PolicyVisibleStateSchema,
  ResumeCompatibilityError,
  SnapshotNotResumableError,
  ScenarioSpecSchema,
  TraceSchema,
  WorkerMessageSchema,
  canonicalJson,
  hashCanonical,
  parseContract,
} from "../../src/domain/contracts";
import { createMockPorts, mockPortContext } from "./mock-ports";
import {
  HASH_A,
  HASH_B,
  HASH_C,
  censoredResult,
  parsedItemInstance,
  samplePolicy,
  sampleResolvedScenario,
  sampleRuleset,
  sampleRun,
  sampleRunningRun,
  sampleScenario,
  sampleSnapshot,
  sampleTrace,
  sampleTransfer,
  transformedCopiedAbility,
  observedTarget,
} from "./fixtures";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function visiblePolicyStateFixture() {
  return {
    schemaVersion: 1,
    atTimeMs: 100,
    actorEntityId: "actor",
    visibility: clone(samplePolicy.visibility),
    entities: [
      {
        entityId: "actor",
        team: "actor",
        kind: "champion",
        alive: true,
        health: { current: 1200, maximum: 1200, shield: 0 },
        resources: [{ resourceId: "mana", current: 500, maximum: 500 }],
        visibleAbilityIds: ["arc-of-judgment"],
        buffs: [{ buffId: "test-buff", stacks: 2, expiresAtMs: 3000 }],
        position: { x: 0, y: 0, z: 0 },
      },
      {
        entityId: "enemy",
        team: "enemy",
        kind: "champion",
        alive: true,
        health: { current: 2500, maximum: 2500, shield: 0 },
        resources: [],
        visibleAbilityIds: [],
        buffs: [],
        position: { x: 500, y: 0, z: 0 },
      },
    ],
    readiness: [
      { entityId: "actor", abilityId: "arc-of-judgment", ready: true, cooldownRemainingMs: 0 },
    ],
    visibleResourceIds: ["mana"],
  };
}

function completeSnapshotForTest() {
  const snapshot = clone(sampleSnapshot);
  snapshot.currentTimeMs = 5000;
  snapshot.buffs.forEach((buff) => (buff.expiresAtMs = null));
  snapshot.entities.forEach((entity) => entity.buffs.forEach((buff) => (buff.expiresAtMs = null)));
  snapshot.status = "complete";
  snapshot.resumability = "non-resumable";
  snapshot.interruption = { state: "completed", reason: null };
  snapshot.queue.entries = [];
  snapshot.pendingActions = [];
  snapshot.queue.nextSequence = 4;
  snapshot.result = clone(censoredResult);
  return snapshot;
}

describe("P01 versioned contract fixtures", () => {
  test("round-trips through JSON and structured clone without executable values", () => {
    const values = [
      sampleRuleset,
      sampleScenario,
      sampleResolvedScenario,
      samplePolicy,
      sampleRun,
      sampleTransfer,
      censoredResult,
      sampleTrace,
      sampleSnapshot,
    ];

    for (const value of values) {
      const jsonRoundTrip = JSON.parse(JSON.stringify(value)) as unknown;
      expect(canonicalJson(jsonRoundTrip)).toBe(canonicalJson(value));
      expect(canonicalJson(structuredClone(value))).toBe(canonicalJson(value));
      expect(
        Object.values(value as Record<string, unknown>).some((item) => item instanceof Map),
      ).toBe(false);
    }
  });

  test("rejects unsupported versions, invalid ranks, item state, nonfinite numbers, and horizons", () => {
    const unsupported = clone(sampleScenario) as { schemaVersion: number };
    unsupported.schemaVersion = 2;
    expect(() => parseContract(ScenarioSpecSchema, unsupported)).toThrow(ContractValidationError);

    const invalidRank = clone(transformedCopiedAbility);
    invalidRank.abilities[0]!.rank = 7;
    expect(() => parseContract(EntityStateSchema, invalidRank)).toThrow(ContractValidationError);

    const invalidItemState = clone(parsedItemInstance) as { state: string };
    invalidItemState.state = "duplicated";
    expect(() => parseContract(ItemInstanceSchema, invalidItemState)).toThrow(
      ContractValidationError,
    );

    const nonfinite = clone(transformedCopiedAbility);
    nonfinite.stats.attackDamage = Number.POSITIVE_INFINITY;
    expect(() => parseContract(EntityStateSchema, nonfinite)).toThrow(ContractValidationError);

    const negativeHorizon = clone(sampleScenario);
    negativeHorizon.objective.horizonMs = -1;
    expect(() => parseContract(ScenarioSpecSchema, negativeHorizon)).toThrow(
      ContractValidationError,
    );
  });

  test("rejects invalid entity references before an engine can execute them", () => {
    const invalid = clone(sampleScenario);
    const action = invalid.policy.steps[0]!.action;
    if (action.kind !== "ability") throw new Error("fixture action should be an ability");
    action.target = { kind: "entity", entityId: "missing-entity" };

    expect(() => parseContract(ScenarioSpecSchema, invalid)).toThrow(/unknown entity/);
  });

  test("rejects duplicate entities and unknown copied-ability or buff sources", () => {
    const duplicate = clone(sampleScenario);
    duplicate.entities.push(clone(duplicate.entities[0]!));
    expect(() => parseContract(ScenarioSpecSchema, duplicate)).toThrow(/must be unique/);

    const unknownCopiedSource = clone(sampleScenario);
    const copied = unknownCopiedSource.entities[0]!.abilities[1]!;
    if (copied.origin.kind !== "copied") throw new Error("fixture ability should be copied");
    copied.origin.sourceEntityId = "missing-source";
    expect(() => parseContract(ScenarioSpecSchema, unknownCopiedSource)).toThrow(
      /unknown source entity/,
    );

    const unknownBuffSource = clone(sampleScenario);
    unknownBuffSource.entities[0]!.buffs[0]!.sourceEntityId = "missing-source";
    expect(() => parseContract(ScenarioSpecSchema, unknownBuffSource)).toThrow(
      /unknown source entity/,
    );
  });

  test("recursively validates policy conditions and scoped action references", () => {
    const condition = clone(sampleScenario);
    condition.policy.steps[1]!.condition = {
      kind: "all",
      clauses: [
        {
          kind: "not",
          clause: {
            kind: "any",
            clauses: [
              { kind: "resource-at-least", entityId: "actor", resourceId: "missing", amount: 1 },
              { kind: "buff-stacks-at-least", entityId: "actor", buffId: "missing", stacks: 1 },
            ],
          },
        },
      ],
    };
    expect(() => parseContract(ScenarioSpecSchema, condition)).toThrow(
      /unknown resource|unknown buff/,
    );

    const missingAbility = clone(sampleScenario);
    const ability = missingAbility.policy.steps[0]!.action;
    if (ability.kind !== "ability") throw new Error("fixture action should be an ability");
    ability.abilityId = "missing-ability";
    expect(() => parseContract(ScenarioSpecSchema, missingAbility)).toThrow(/unknown ability/);

    const missingItem = clone(sampleScenario);
    missingItem.policy.steps[0]!.action = {
      kind: "item-active",
      actorId: "actor",
      itemInstanceId: "missing-item",
      target: { kind: "entity", entityId: "enemy" },
    };
    expect(() => parseContract(ScenarioSpecSchema, missingItem)).toThrow(/unknown item instance/);

    const hiddenEntity = clone(sampleScenario);
    hiddenEntity.policy.visibility.visibleEntityIds = ["actor", "missing-entity"];
    expect(() => parseContract(ScenarioSpecSchema, hiddenEntity)).toThrow(
      /policy visibility references unknown entity/,
    );
  });

  test("requires provenance for every effective replay-affecting field", () => {
    const invalid = clone(sampleResolvedScenario);
    delete invalid.provenance.objective;

    expect(() => parseContract(ResolvedScenarioSchema, invalid)).toThrow(
      /replay-affecting field requires provenance/,
    );
  });

  test("preserves transformed and copied ability origins", () => {
    const parsed = parseContract(EntityStateSchema, transformedCopiedAbility);
    expect(parsed.abilities.map((ability) => ability.origin.kind)).toEqual([
      "transformed",
      "copied",
    ]);
    expect(parsed.abilities[1]!.origin).toMatchObject({
      sourceEntityId: "enemy",
      copyId: "copy-001",
    });
  });

  test("preserves item instance identity while an upgrade changes effective item identity", () => {
    const upgraded = parseContract(ItemInstanceSchema, {
      ...parsedItemInstance,
      effectiveItemId: 2002,
      upgrade: { upgradeId: "upgrade-002", fromItemId: 1001, toItemId: 2002 },
    });

    expect(upgraded.instanceId).toBe(parsedItemInstance.instanceId);
    expect(upgraded.baseItemId).toBe(parsedItemInstance.baseItemId);
    expect(upgraded.effectiveItemId).toBe(2002);
    expect(upgraded.stacks).toBe(parsedItemInstance.stacks);
  });

  test("keeps observed effective target stats separate from modeled inventory", () => {
    const target = parseContract(EntityStateSchema, observedTarget);

    expect(target.inventoryOrigin).toBe("observed-effective");
    expect(target.inventory).toEqual([]);
    expect(target.statProvenance.armor.kind).toBe("observed");
    expect(target.statProvenance.armor.sourceHash).toBe(HASH_B);
  });

  test("round-trips revive effects and retains the lifecycle boundary", () => {
    const revivedTrace = clone(sampleTrace);
    revivedTrace.events.push({
      eventId: "event-revive",
      sequence: 3,
      timeMs: 2000,
      phase: "lifecycle",
      kind: "lifecycle",
      actorEntityId: "enemy",
      targetEntityIds: ["enemy"],
      causeEventIds: ["event-002"],
      effects: [{ kind: "lifecycle", entityId: "enemy", transition: "revive" }],
      stateDigest: null,
    });
    const parsed = parseContract(TraceSchema, revivedTrace);
    expect(parsed.events.at(-1)?.effects[0]).toEqual({
      kind: "lifecycle",
      entityId: "enemy",
      transition: "revive",
    });
  });

  test("rejects trace sequence reuse across different timestamps", () => {
    const duplicate = clone(sampleTrace);
    duplicate.events.push({
      ...duplicate.events[1]!,
      eventId: "event-003",
      timeMs: 2000,
    });

    expect(() => parseContract(TraceSchema, duplicate)).toThrow(/globally unique/);
  });

  test("captures an interrupted long run with queue, actions, triggers, RNG and numerical state", () => {
    expect(sampleSnapshot.status).toBe("running");
    expect(sampleSnapshot.queue.entries[0]?.eventId).toBe("event-003");
    expect(sampleSnapshot.pendingActions[0]?.state).toBe("scheduled");
    expect(sampleSnapshot.triggerState[0]?.triggerId).toBe("trigger-001");
    expect(sampleSnapshot.rngStreams[0]?.drawCount).toBe(0);
    expect(sampleSnapshot.numericalBranches[0]?.accumulators.damage).toBe(100);
    expect(parseContract(EngineSnapshotSchema, clone(sampleSnapshot))).toEqual(sampleSnapshot);
  });

  test("rejects ambiguous queue ties, stale sequence allocation, and non-resumable work", () => {
    const duplicateTie = clone(sampleSnapshot);
    duplicateTie.queue.entries.push({
      ...duplicateTie.queue.entries[0]!,
      eventId: "event-004",
    });
    duplicateTie.queue.nextSequence = 5;
    expect(() => parseContract(EngineSnapshotSchema, duplicateTie)).toThrow(
      /sequence IDs must be unique|ordered by time/,
    );

    const staleSequence = clone(sampleSnapshot);
    staleSequence.queue.nextSequence = 3;
    expect(() => parseContract(EngineSnapshotSchema, staleSequence)).toThrow(
      /nextSequence must be greater/,
    );

    const staleEvent = clone(sampleSnapshot);
    staleEvent.queue.entries[0]!.timeMs = 99;
    expect(() => parseContract(EngineSnapshotSchema, staleEvent)).toThrow(
      /cannot precede currentTimeMs/,
    );

    const cancelledWithWork = clone(sampleSnapshot);
    cancelledWithWork.status = "cancelled";
    cancelledWithWork.resumability = "non-resumable";
    cancelledWithWork.interruption = { state: "cancelled", reason: "user cancelled" };
    expect(() => parseContract(EngineSnapshotSchema, cancelledWithWork)).toThrow(
      /non-resumable snapshots cannot retain/,
    );

    const unknownPendingActor = clone(sampleSnapshot);
    unknownPendingActor.pendingActions[0]!.command = {
      kind: "wait",
      actorId: "missing-actor",
      durationMs: 10,
    };
    expect(() => parseContract(EngineSnapshotSchema, unknownPendingActor)).toThrow(
      /pending actions must reference known actor/,
    );

    const cancelled = clone(sampleSnapshot);
    cancelled.status = "cancelled";
    cancelled.resumability = "non-resumable";
    cancelled.interruption = { state: "cancelled", reason: "user cancelled" };
    cancelled.queue.entries = [];
    cancelled.pendingActions = [];
    cancelled.queue.nextSequence = 4;
    cancelled.result = clone(censoredResult);
    cancelled.result.status = "cancelled";
    cancelled.result.censoring = "invalid";
    cancelled.result.metrics.ttk = { status: "undefined", reason: "cancelled" };
    expect(parseContract(EngineSnapshotSchema, cancelled).status).toBe("cancelled");
    expect(() => assertResumableSnapshot(cancelled)).toThrow(SnapshotNotResumableError);

    for (const status of ["cancelled", "incomplete"] as const) {
      const invalidComplete = completeSnapshotForTest();
      invalidComplete.result = clone(censoredResult);
      invalidComplete.result.status = status;
      invalidComplete.result.censoring = "invalid";
      invalidComplete.result.metrics.ttk = { status: "undefined", reason: status };
      expect(() => parseContract(EngineSnapshotSchema, invalidComplete), status).toThrow(
        /complete snapshots require a complete result/,
      );
    }
  });

  test("rejects contradictory engine step status and snapshot interruption state", () => {
    const cancelledSnapshot = clone(sampleSnapshot);
    cancelledSnapshot.status = "cancelled";
    cancelledSnapshot.resumability = "non-resumable";
    cancelledSnapshot.interruption = { state: "cancelled", reason: "cancelled by caller" };
    cancelledSnapshot.queue.entries = [];
    cancelledSnapshot.pendingActions = [];
    cancelledSnapshot.queue.nextSequence = 4;

    expect(() =>
      parseContract(EngineStepResultSchema, {
        schemaVersion: 1,
        status: "progress",
        snapshot: cancelledSnapshot,
        emittedEvents: [],
        result: null,
        reason: "still working",
      }),
    ).toThrow(/require a running snapshot/);

    expect(() =>
      parseContract(EngineStepResultSchema, {
        schemaVersion: 1,
        status: "cancelled",
        snapshot: sampleSnapshot,
        emittedEvents: [],
        result: null,
        reason: "cancelled by caller",
      }),
    ).toThrow(/require a cancelled snapshot/);

    expect(() =>
      parseContract(EngineStepResultSchema, {
        schemaVersion: 1,
        status: "cancelled",
        snapshot: cancelledSnapshot,
        emittedEvents: [],
        result: null,
        reason: "different cancellation reason",
      }),
    ).toThrow(/matching the snapshot interruption/);

    const idleSnapshot = clone(sampleSnapshot);
    idleSnapshot.interruption = { state: "none", reason: null };
    expect(() =>
      parseContract(EngineStepResultSchema, {
        schemaVersion: 1,
        status: "progress",
        snapshot: idleSnapshot,
        emittedEvents: [],
        result: null,
        reason: "unexpected reason",
      }),
    ).toThrow(/without interruption cannot carry a reason/);

    expect(() =>
      parseContract(EngineStepResultSchema, {
        schemaVersion: 1,
        status: "progress",
        snapshot: sampleSnapshot,
        emittedEvents: [],
        result: null,
        reason: "different budget reason",
      }),
    ).toThrow(/matching the snapshot interruption/);

    const completeSnapshot = completeSnapshotForTest();
    const completeResult = clone(censoredResult);
    expect(
      parseContract(EngineStepResultSchema, {
        schemaVersion: 1,
        status: "complete",
        snapshot: completeSnapshot,
        emittedEvents: [],
        result: completeResult,
        reason: null,
      }).result,
    ).toEqual(completeResult);

    const alteredResult = clone(completeResult);
    alteredResult.warnings = ["semantically different"];
    expect(() =>
      parseContract(EngineStepResultSchema, {
        schemaVersion: 1,
        status: "complete",
        snapshot: completeSnapshot,
        emittedEvents: [],
        result: alteredResult,
        reason: null,
      }),
    ).toThrow(/exactly match the snapshot result/);
  });

  test("resume guards reject non-resumable and incompatible snapshots", () => {
    const input = {
      scenario: sampleResolvedScenario,
      run: sampleRunningRun,
      ports: createMockPorts(),
    };
    expect(assertResumableSnapshot(sampleSnapshot)).toEqual(sampleSnapshot);
    expect(() => assertResumeCompatible(input, sampleSnapshot)).not.toThrow();

    const mismatchedRun = { ...sampleRunningRun, engineHash: HASH_C };
    expect(() => assertResumeCompatible({ ...input, run: mismatchedRun }, sampleSnapshot)).toThrow(
      ResumeCompatibilityError,
    );

    const complete = clone(sampleSnapshot);
    complete.currentTimeMs = 5000;
    complete.buffs.forEach((buff) => (buff.expiresAtMs = null));
    complete.entities.forEach((entity) =>
      entity.buffs.forEach((buff) => (buff.expiresAtMs = null)),
    );
    complete.status = "complete";
    complete.resumability = "non-resumable";
    complete.interruption = { state: "completed", reason: null };
    complete.queue.entries = [];
    complete.pendingActions = [];
    complete.queue.nextSequence = 4;
    complete.result = censoredResult;
    expect(() => assertResumeCompatible(input, complete)).toThrow(SnapshotNotResumableError);
  });

  test("uses tagged censored metrics instead of JSON Infinity or NaN", () => {
    const json = JSON.stringify(censoredResult);
    expect(json).not.toContain("Infinity");
    expect(json).not.toContain("NaN");
    expect(parseContract(CombatResultSchema, JSON.parse(json))).toEqual(censoredResult);
    expect(censoredResult.metrics.ttk).toEqual({ status: "censored", horizonMs: 5000 });
  });

  test("rejects contradictory kill and censoring combinations", () => {
    const killedAsCensored = {
      ...censoredResult,
      killed: true,
      censoring: "right-censored" as const,
      metrics: {
        ...censoredResult.metrics,
        ttk: { status: "value" as const, value: 4200 },
      },
    };
    expect(() => parseContract(CombatResultSchema, killedAsCensored)).toThrow(/cannot be censored/);

    const nonKillAsUncensored = { ...censoredResult, censoring: "not-censored" as const };
    expect(() => parseContract(CombatResultSchema, nonKillAsUncensored)).toThrow(
      /must be right-censored or invalid/,
    );

    const completeAsInvalid = {
      ...censoredResult,
      censoring: "invalid" as const,
      metrics: {
        ...censoredResult.metrics,
        ttk: { status: "undefined" as const, reason: "not completed" },
      },
    };
    expect(() => parseContract(CombatResultSchema, completeAsInvalid)).toThrow(
      /interrupted\/invalid result/,
    );

    const interruptedAsCensored = {
      ...censoredResult,
      status: "cancelled" as const,
      censoring: "right-censored" as const,
      metrics: {
        ...censoredResult.metrics,
        ttk: { status: "censored" as const, horizonMs: 5000 },
      },
    };
    expect(() => parseContract(CombatResultSchema, interruptedAsCensored)).toThrow(
      /right-censored results must be complete/,
    );

    const negativeTtk = {
      ...censoredResult,
      killed: true,
      censoring: "not-censored" as const,
      metrics: {
        ...censoredResult.metrics,
        ttk: { status: "value" as const, value: -1 },
      },
    };
    expect(() => parseContract(CombatResultSchema, negativeTtk)).toThrow(/non-negative TTK/);
  });

  test("canonical hashes ignore object insertion order but change with candidate input", async () => {
    const first = await hashCanonical({ b: 2, a: 1 });
    const second = await hashCanonical({ a: 1, b: 2 });
    const changed = await hashCanonical({ a: 1, b: 3 });

    expect(first).toBe(second);
    expect(changed).not.toBe(first);
    expect(first).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(sampleRun.searchContextHash).not.toBe(sampleRun.candidateInputHash);
    expect(HASH_A).not.toBe(HASH_C);
  });

  test("canonicalization rejects hidden, executable, and silently ignored values", () => {
    const symbolKey = Symbol("hidden");
    const symbolObject: Record<string | symbol, unknown> = { visible: 1 };
    symbolObject[symbolKey] = 2;
    expect(() => canonicalJson(symbolObject)).toThrow(/symbol-keyed/);

    const nonEnumerable = { visible: 1 };
    Object.defineProperty(nonEnumerable, "hidden", { value: 2, enumerable: false });
    expect(() => canonicalJson(nonEnumerable)).toThrow(/non-enumerable/);

    const accessor = {};
    Object.defineProperty(accessor, "value", { enumerable: true, get: () => 1 });
    expect(() => canonicalJson(accessor)).toThrow(/accessor/);

    const extraArrayProperty = [1] as number[] & { extra?: number };
    extraArrayProperty.extra = 2;
    expect(() => canonicalJson(extraArrayProperty)).toThrow(/extra properties/);

    const hiddenArrayProperty = [1];
    Object.defineProperty(hiddenArrayProperty, "hidden", { value: 2, enumerable: false });
    expect(() => canonicalJson(hiddenArrayProperty)).toThrow(/non-enumerable/);

    expect(() => canonicalJson({ executable: () => 1 })).toThrow(/structured-clone-safe/);
    expect(() => canonicalJson({ nonfinite: Number.NaN })).toThrow(/non-finite/);
    expect(() => canonicalJson(new Map([["key", 1]]))).toThrow(/plain objects/);

    const schemaBoundaryExecutable = clone(visiblePolicyStateFixture());
    Object.defineProperty(schemaBoundaryExecutable, "executable", {
      value: () => 1,
      enumerable: true,
    });
    expect(() => parseContract(PolicyVisibleStateSchema, schemaBoundaryExecutable)).toThrow(
      /structured-clone-safe/,
    );

    const schemaBoundaryHidden = clone(visiblePolicyStateFixture());
    Object.defineProperty(schemaBoundaryHidden, "hidden", {
      value: 2,
      enumerable: false,
    });
    expect(() => parseContract(PolicyVisibleStateSchema, schemaBoundaryHidden)).toThrow(
      /non-enumerable/,
    );

    const schemaBoundaryArray = clone(visiblePolicyStateFixture());
    (
      schemaBoundaryArray.entities as typeof schemaBoundaryArray.entities & { extra?: number }
    ).extra = 1;
    expect(() => parseContract(PolicyVisibleStateSchema, schemaBoundaryArray)).toThrow(
      /extra properties/,
    );
  });

  test("rejects inherited required fields and proxies at every canonical boundary", async () => {
    const previousSchemaVersion = Object.getOwnPropertyDescriptor(
      Object.prototype,
      "schemaVersion",
    );
    try {
      Object.defineProperty(Object.prototype, "schemaVersion", {
        value: 1,
        configurable: true,
        enumerable: false,
        writable: true,
      });
      const polluted = clone(sampleScenario) as Record<string, unknown>;
      delete polluted.schemaVersion;
      expect(() => parseContract(ScenarioSpecSchema, polluted)).toThrow(/schemaVersion|expected 1/);
    } finally {
      if (previousSchemaVersion) {
        Object.defineProperty(Object.prototype, "schemaVersion", previousSchemaVersion);
      } else {
        Reflect.deleteProperty(Object.prototype, "schemaVersion");
      }
    }

    const proxy = new Proxy({ value: 1 }, {});
    expect(() => canonicalJson(proxy)).toThrow(/structured-clone-safe/);

    let hashError: unknown;
    try {
      await hashCanonical(proxy);
    } catch (error) {
      hashError = error;
    }
    expect(String(hashError)).toMatch(/structured-clone-safe/);

    const proxyContract = new Proxy(visiblePolicyStateFixture(), {});
    expect(() => parseContract(PolicyVisibleStateSchema, proxyContract)).toThrow(
      /structured-clone-safe/,
    );

    const accessorContract = clone(sampleScenario);
    Object.defineProperty(accessorContract, "schemaVersion", {
      configurable: true,
      enumerable: true,
      get: () => 1,
    });
    expect(() => parseContract(ScenarioSpecSchema, accessorContract)).toThrow(/accessor/);
  });

  test("rejects a run that collapses search context and candidate input identity", () => {
    const invalid = { ...sampleRun, candidateInputHash: sampleRun.searchContextHash };
    expect(() => parseContract(RunManifestSchema, invalid)).toThrow(/must remain distinct/);
  });

  test("accepts incomplete manifests and requires timezone-qualified timestamps", () => {
    const incomplete = clone(sampleRun);
    incomplete.status = "incomplete";
    incomplete.completedAt = null;
    expect(parseContract(RunManifestSchema, incomplete).status).toBe("incomplete");

    const localTime = clone(sampleRun);
    localTime.createdAt = "2026-09-19T00:00:00";
    expect(() => parseContract(RunManifestSchema, localTime)).toThrow(/explicit timezone/);
  });

  test("validates exact comparison transfer hashes and versioned worker envelopes", () => {
    expect(parseContract(ExactComparisonTransferSchema, clone(sampleTransfer))).toEqual(
      sampleTransfer,
    );

    const mismatched = clone(sampleTransfer);
    mismatched.result.candidateInputHash = HASH_A;
    expect(() => parseContract(ExactComparisonTransferSchema, mismatched)).toThrow(
      /same candidate input/,
    );

    const message = parseContract(WorkerMessageSchema, {
      schemaVersion: 1,
      direction: "step",
      payload: {
        schemaVersion: 1,
        status: "progress",
        snapshot: sampleSnapshot,
        emittedEvents: [],
        result: null,
        reason: "step event budget exhausted",
      },
    });
    expect(message.schemaVersion).toBe(1);
    if (message.direction !== "step") throw new Error("fixture message should be a step");
    expect(message.payload.snapshot.runId).toBe(sampleRun.runId);
  });

  test("rejects a censored non-kill under fail-if-not-killed exact transfer policy", () => {
    const invalid = clone(sampleTransfer);
    invalid.run.objective.censoring = "fail-if-not-killed";
    invalid.resolvedScenario.effective.objective.censoring = "fail-if-not-killed";

    expect(() => parseContract(ExactComparisonTransferSchema, invalid)).toThrow(
      /fail-if-not-killed objectives cannot transfer a non-kill result/,
    );
  });

  test("rejects every exact-comparison provenance mismatch and interrupted result", () => {
    type MutableTransfer = Omit<typeof sampleTransfer, "schemaVersion"> & {
      schemaVersion?: number;
    };
    const cases: Array<{
      label: string;
      mutate: (value: MutableTransfer) => void;
      message: RegExp;
    }> = [
      {
        label: "schema version",
        mutate: (value) => delete value.schemaVersion,
        message: /schemaVersion|expected 1/,
      },
      {
        label: "run identity",
        mutate: (value) => {
          value.run.runId = "different-run";
        },
        message: /run and result must share run identity/,
      },
      {
        label: "scenario identity",
        mutate: (value) => {
          value.resolvedScenario.resolvedScenarioHash = HASH_C;
        },
        message: /same resolved scenario/,
      },
      {
        label: "result identity",
        mutate: (value) => {
          value.result.resolvedScenarioHash = HASH_C;
        },
        message: /same resolved scenario/,
      },
      {
        label: "ruleset provenance",
        mutate: (value) => {
          value.run.rulesetHash = HASH_C;
        },
        message: /ruleset provenance/,
      },
      {
        label: "cohort provenance",
        mutate: (value) => {
          value.run.cohortHash = HASH_C;
        },
        message: /cohort provenance/,
      },
      {
        label: "policy provenance",
        mutate: (value) => {
          value.run.policyHash = HASH_C;
        },
        message: /policy provenance/,
      },
      {
        label: "candidate provenance",
        mutate: (value) => {
          value.candidateInputHash = HASH_A;
        },
        message: /candidate input/,
      },
      {
        label: "objective configuration",
        mutate: (value) => {
          value.run.objective.horizonMs = 4000;
        },
        message: /objective configuration/,
      },
      {
        label: "evaluation configuration",
        mutate: (value) => {
          value.run.evaluationMode = {
            kind: "average-state-approximation",
            random: { kind: "deterministic", algorithm: "none", seed: null, trialCount: 1 },
            approximation: "expected-crit",
          };
        },
        message: /evaluation configuration/,
      },
      {
        label: "result objective identity",
        mutate: (value) => {
          value.result.objective = "ttk";
        },
        message: /objective identity/,
      },
      {
        label: "censoring horizon",
        mutate: (value) => {
          if (value.result.metrics.ttk.status !== "censored") {
            throw new Error("fixture result should be censored");
          }
          value.result.metrics.ttk.horizonMs = 4000;
        },
        message: /objective horizon/,
      },
      {
        label: "incomplete result",
        mutate: (value) => {
          value.result.status = "incomplete";
          value.result.censoring = "invalid";
          value.result.metrics.ttk = { status: "undefined", reason: "interrupted" };
        },
        message: /complete run and complete result/,
      },
      {
        label: "cancelled result",
        mutate: (value) => {
          value.result.status = "cancelled";
          value.result.censoring = "invalid";
          value.result.metrics.ttk = { status: "undefined", reason: "cancelled" };
        },
        message: /complete run and complete result/,
      },
    ];

    for (const testCase of cases) {
      const invalid = clone(sampleTransfer) as MutableTransfer;
      testCase.mutate(invalid);
      expect(() => parseContract(ExactComparisonTransferSchema, invalid), testCase.label).toThrow(
        testCase.message,
      );
    }
  });

  test("validates versioned command/event envelopes and exposes narrow mock ports", () => {
    const command = parseContract(EngineCommandSchema, {
      schemaVersion: 1,
      kind: "apply-damage",
      commandId: "command-001",
      issuedAtMs: 100,
      causeEventIds: [],
      packet: {
        sourceEntityId: "actor",
        targetEntityId: "enemy",
        damageType: "physical",
        rawAmount: 100,
        tags: ["basic-attack"],
        canOverkill: false,
      },
    });
    const event = parseContract(EngineEventSchema, {
      schemaVersion: 1,
      eventId: "event-command",
      timeMs: 100,
      sequence: 4,
      phase: "impact",
      kind: "damage",
      actorEntityId: "actor",
      targetEntityIds: ["enemy"],
      causeEventIds: [],
      payload: { commandId: command.commandId },
    });
    const ports = createMockPorts();
    if (command.kind !== "apply-damage") throw new Error("fixture command should apply damage");
    const resolution = ports.damage.resolve(
      {
        packet: command.packet,
        attacker: transformedCopiedAbility,
        target: observedTarget,
        attackerStats: { entityId: "actor", revision: 1, values: transformedCopiedAbility.stats },
        targetStats: { entityId: "enemy", revision: 1, values: observedTarget.stats },
        read: { kind: "impact", entityId: "enemy", atTimeMs: 100, stateRevision: 1 },
      },
      mockPortContext,
    );

    expect(event.payload).toEqual({ commandId: "command-001" });
    expect(resolution.applied).toBe(100);
    expect(ports.timers.cancel("missing-event", mockPortContext)).toBe(false);
  });

  test("keeps action policy visibility explicit and non-future-facing", () => {
    const parsed = parseContract(ActionPolicySchema, samplePolicy);
    expect(parsed.visibility.allowFutureEvents).toBe(false);
    expect(parsed.visibility.allowHiddenOpponentState).toBe(false);
    expect(parsed.steps.every((step) => step.condition !== undefined)).toBe(true);
  });

  test("exposes only declared policy-visible state", () => {
    const visible = {
      schemaVersion: 1,
      atTimeMs: 100,
      actorEntityId: "actor",
      visibility: samplePolicy.visibility,
      entities: [
        {
          entityId: "actor",
          team: "actor",
          kind: "champion",
          alive: true,
          health: { current: 1200, maximum: 1200, shield: 0 },
          resources: [{ resourceId: "mana", current: 500, maximum: 500 }],
          visibleAbilityIds: ["arc-of-judgment"],
          buffs: [{ buffId: "test-buff", stacks: 2, expiresAtMs: 3000 }],
          position: { x: 0, y: 0, z: 0 },
        },
        {
          entityId: "enemy",
          team: "enemy",
          kind: "champion",
          alive: true,
          health: { current: 2500, maximum: 2500, shield: 0 },
          resources: [],
          visibleAbilityIds: [],
          buffs: [],
          position: { x: 500, y: 0, z: 0 },
        },
      ],
      readiness: [
        { entityId: "actor", abilityId: "arc-of-judgment", ready: true, cooldownRemainingMs: 0 },
      ],
      visibleResourceIds: ["mana"],
    };
    const parsedVisible = parseContract(PolicyVisibleStateSchema, visible);
    expect(parsedVisible.actorEntityId).toBe("actor");
    expect(parsedVisible.entities[1]?.entityId).toBe("enemy");

    const leaked = clone(visible);
    Object.defineProperty(leaked.entities[0]!, "stats", {
      value: { attackDamage: 150 },
      enumerable: true,
    });
    expect(() => parseContract(PolicyVisibleStateSchema, leaked)).toThrow(/stats/);

    const hiddenReadiness = clone(visible);
    hiddenReadiness.readiness[0]!.abilityId = "hidden-ability";
    expect(() => parseContract(PolicyVisibleStateSchema, hiddenReadiness)).toThrow(
      /non-visible ability/,
    );
  });

  test("rejects hidden condition entities, duplicate readiness, and duplicate snapshot RNG streams", () => {
    const hiddenCondition = clone(sampleScenario);
    hiddenCondition.policy.visibility.visibleEntityIds = ["actor"];
    expect(() => parseContract(ScenarioSpecSchema, hiddenCondition)).toThrow(
      /condition references hidden entity/,
    );

    const duplicateReadiness = visiblePolicyStateFixture();
    duplicateReadiness.readiness.push({
      ...duplicateReadiness.readiness[0]!,
      ready: false,
      cooldownRemainingMs: 100,
    });
    expect(() => parseContract(PolicyVisibleStateSchema, duplicateReadiness)).toThrow(
      /readiness record IDs must be unique/,
    );

    const duplicateRng = clone(sampleSnapshot);
    duplicateRng.rngStreams.push({ ...duplicateRng.rngStreams[0]!, seed: "other" });
    expect(() => parseContract(EngineSnapshotSchema, duplicateRng)).toThrow(
      /RNG stream IDs must be unique/,
    );
  });

  test("rejects ambiguous trace IDs, inventory slots, and missing item upgrade metadata", () => {
    const duplicateTraceId = clone(sampleTrace);
    duplicateTraceId.events.push({
      ...duplicateTraceId.events[1]!,
      sequence: 3,
      timeMs: 200,
    });
    expect(() => parseContract(TraceSchema, duplicateTraceId)).toThrow(
      /trace event IDs must be globally unique/,
    );

    const duplicateSlot = clone(transformedCopiedAbility);
    duplicateSlot.inventory.push({
      ...clone(duplicateSlot.inventory[0]!),
      instanceId: "item-instance-duplicate-slot",
    });
    expect(() => parseContract(EntityStateSchema, duplicateSlot)).toThrow(
      /equipped inventory slot IDs must be unique/,
    );

    const negativeSlot = clone(transformedCopiedAbility);
    negativeSlot.inventory[0]!.slot = -1;
    expect(() => parseContract(EntityStateSchema, negativeSlot)).toThrow(
      /equipped items require a real inventory slot/,
    );

    const missingUpgrade = { ...clone(parsedItemInstance), effectiveItemId: 2002, upgrade: null };
    expect(() => parseContract(ItemInstanceSchema, missingUpgrade)).toThrow(
      /requires upgrade metadata/,
    );
  });

  test("requires own stat provenance and normalized cohort mass", () => {
    const inheritedName = clone(transformedCopiedAbility);
    inheritedName.stats = { constructor: 100 };
    inheritedName.statProvenance = {};
    expect(() => parseContract(EntityStateSchema, inheritedName)).toThrow(
      /every effective stat requires provenance/,
    );

    const invalidWeights = clone(sampleScenario);
    invalidWeights.cohort.members.push({
      ...clone(invalidWeights.cohort.members[0]!),
      memberId: "member-002",
    });
    expect(() => parseContract(ScenarioSpecSchema, invalidWeights)).toThrow(
      /normalized cohort weights must sum to one/,
    );
  });

  test("requires objective-complete metrics including death and elimination time", () => {
    for (const [objective, metric] of [
      ["fixed-window-damage", "damage"],
      ["sustained-dps", "dps"],
      ["ttk", "ttk"],
      ["first-death", "timeToFirstDeath"],
      ["final-elimination", "timeToElimination"],
    ] as const) {
      const result = clone(censoredResult);
      result.objective = objective;
      result.metrics[metric] = { status: "undefined", reason: "missing" };
      expect(() => parseContract(CombatResultSchema, result), objective).toThrow(
        /objective-valid primary metric/,
      );
    }
  });

  test("carries non-success terminal results and policy progress through snapshots", () => {
    const snapshot = clone(sampleSnapshot);
    snapshot.status = "incomplete";
    snapshot.resumability = "non-resumable";
    snapshot.interruption = { state: "budget-exhausted", reason: "hard event limit" };
    snapshot.queue.entries = [];
    snapshot.pendingActions = [];
    snapshot.result = clone(censoredResult);
    snapshot.result.status = "incomplete";
    snapshot.result.censoring = "invalid";
    snapshot.result.metrics.ttk = { status: "undefined", reason: "hard event limit" };

    const step = parseContract(EngineStepResultSchema, {
      schemaVersion: 1,
      status: "incomplete",
      snapshot,
      emittedEvents: [],
      result: snapshot.result,
      reason: "hard event limit",
    });
    expect(step.result?.status).toBe("incomplete");
    expect(step.snapshot.policyProgress.nextStepId).toBe("basic-attack");
    expect(step.snapshot.policyProgress.steps[1]?.consumedRepeats).toBe(2);

    const invalidProgress = clone(sampleSnapshot);
    invalidProgress.policyProgress.nextStepId = "missing-step";
    expect(() => parseContract(EngineSnapshotSchema, invalidProgress)).toThrow(
      /next policy step must exist/,
    );
  });

  test("mock timers use chronological order and traces remain isolated by run", () => {
    const ports = createMockPorts();
    const later = clone(sampleSnapshot.queue.entries[0]!);
    const earlier = { ...later, eventId: "event-earlier", timeMs: 500, sequence: 4 };
    ports.timers.schedule({ event: later, replacesEventId: null }, mockPortContext);
    ports.timers.schedule({ event: earlier, replacesEventId: null }, mockPortContext);
    expect(ports.timers.peek(mockPortContext)?.eventId).toBe("event-earlier");

    ports.trace.record(sampleTrace.events[0]!, mockPortContext);
    ports.trace.record(sampleTrace.events[1]!, { ...mockPortContext, runId: "run-002" });
    expect(
      ports.trace.snapshot(mockPortContext.runId).events.map((event) => event.eventId),
    ).toEqual(["event-001"]);
    expect(ports.trace.snapshot("run-002").events.map((event) => event.eventId)).toEqual([
      "event-002",
    ]);
  });

  test("binds unique policy steps and resumable progress to the scenario policy", () => {
    const duplicateStep = clone(samplePolicy);
    duplicateStep.steps[1]!.stepId = duplicateStep.steps[0]!.stepId;
    expect(() => parseContract(ActionPolicySchema, duplicateStep)).toThrow(
      /action step IDs must be unique/,
    );

    for (const mutate of [
      (snapshot: typeof sampleSnapshot) => {
        snapshot.policyProgress.policyId = "foreign-policy";
      },
      (snapshot: typeof sampleSnapshot) => {
        snapshot.policyProgress.revision += 1;
      },
      (snapshot: typeof sampleSnapshot) => {
        snapshot.policyProgress.nextStepId = "cast-w";
        snapshot.policyProgress.steps.pop();
      },
    ]) {
      const snapshot = clone(sampleSnapshot);
      mutate(snapshot);
      expect(() =>
        assertResumeCompatible(
          { scenario: sampleResolvedScenario, run: sampleRunningRun, ports: createMockPorts() },
          snapshot,
        ),
      ).toThrow();
    }

    const impossibleRepeatProgress = clone(sampleSnapshot);
    impossibleRepeatProgress.policyProgress.steps[0]!.consumedRepeats = 2;
    expect(() =>
      assertResumeCompatible(
        { scenario: sampleResolvedScenario, run: sampleRunningRun, ports: createMockPorts() },
        impossibleRepeatProgress,
      ),
    ).toThrow(/one-shot count/);
  });

  test("requires unique resumable action, trigger, and numerical branch identities", () => {
    for (const [collection, duplicate] of [
      ["pendingActions", { ...sampleSnapshot.pendingActions[0] }],
      ["triggerState", { ...sampleSnapshot.triggerState[0] }],
      ["numericalBranches", { ...sampleSnapshot.numericalBranches[0] }],
    ] as const) {
      const snapshot = clone(sampleSnapshot);
      snapshot[collection].push(duplicate as never);
      expect(() => parseContract(EngineSnapshotSchema, snapshot), collection).toThrow(/unique/);
    }
  });

  test("requires one consistent snapshot buff representation", () => {
    const conflicting = clone(sampleSnapshot);
    conflicting.buffs[0]!.stacks += 1;
    expect(() => parseContract(EngineSnapshotSchema, conflicting)).toThrow(
      /top-level buffs must exactly match entity buff state/,
    );

    const expired = clone(sampleSnapshot);
    expired.buffs[0]!.expiresAtMs = 99;
    expired.entities[0]!.buffs[0]!.expiresAtMs = 99;
    expect(() => parseContract(EngineSnapshotSchema, expired)).toThrow(
      /snapshot buffs cannot already be expired/,
    );
  });

  test("rejects invalid metric values and mismatched censored time horizons", () => {
    const negative = clone(censoredResult);
    negative.metrics.damage = { status: "value", value: -1 };
    expect(() => parseContract(CombatResultSchema, negative)).toThrow(/expected number to be >=0/);

    const transfer = clone(sampleTransfer);
    transfer.run.objective.kind = "first-death";
    transfer.run.objective.primaryMetric = "time-to-first-death";
    transfer.resolvedScenario.effective.objective = clone(transfer.run.objective);
    transfer.result.objective = "first-death";
    transfer.result.metrics.timeToFirstDeath = { status: "censored", horizonMs: 4000 };
    expect(() => parseContract(ExactComparisonTransferSchema, transfer)).toThrow(
      /censored metric must match the transferred objective horizon/,
    );
  });

  test("validates coverage-first result metadata and sustained DPS windows", () => {
    const covered = clone(censoredResult);
    covered.coverage = {
      killedCount: 1,
      totalCount: 4,
      killedWeight: 0.9,
      totalWeight: 1,
      fraction: 0.9,
    };
    expect(parseContract(CombatResultSchema, covered).coverage).toEqual(covered.coverage);

    const contradictory = clone(covered);
    contradictory.coverage!.fraction = 0.5;
    expect(() => parseContract(CombatResultSchema, contradictory)).toThrow(
      /fraction must match its weights/,
    );

    const transfer = clone(sampleTransfer);
    transfer.run.objective.aggregation = "coverage-then-ttk";
    transfer.resolvedScenario.effective.objective = clone(transfer.run.objective);
    expect(() => parseContract(ExactComparisonTransferSchema, transfer)).toThrow(
      /machine-readable kill coverage/,
    );

    const noMeasurementWindow = clone(sampleScenario);
    noMeasurementWindow.objective.kind = "sustained-dps";
    noMeasurementWindow.objective.primaryMetric = "dps";
    noMeasurementWindow.objective.warmupMs = noMeasurementWindow.objective.horizonMs;
    expect(() => parseContract(ScenarioSpecSchema, noMeasurementWindow)).toThrow(
      /strictly less than the horizon/,
    );
  });

  test("validates stats snapshots and entity ownership at runtime boundaries", () => {
    expect(
      assertStatsSnapshot(
        {
          entity: transformedCopiedAbility,
          read: { kind: "snapshot", entityId: "actor", atTimeMs: 0, stateRevision: 1 },
        },
        mockPortContext,
        { entityId: "actor", revision: 1, values: { attackDamage: 150 } },
      ),
    ).toMatchObject({ entityId: "actor", revision: 1 });
    expect(() =>
      assertStatsSnapshot(
        {
          entity: transformedCopiedAbility,
          read: { kind: "snapshot", entityId: "actor", atTimeMs: 0, stateRevision: 1 },
        },
        mockPortContext,
        { entityId: "actor", revision: 1, values: { attackDamage: Infinity } },
      ),
    ).toThrow(/non-finite/);

    const unknownOwner = clone(sampleScenario);
    unknownOwner.entities[1]!.ownerEntityId = "missing-owner";
    expect(() => parseContract(ScenarioSpecSchema, unknownOwner)).toThrow(/unknown entity/);

    const owned = clone(sampleScenario);
    owned.entities[1]!.ownerEntityId = "actor";
    expect(parseContract(ScenarioSpecSchema, owned).entities[1]!.ownerEntityId).toBe("actor");
  });

  test("requires retained trace causes to precede their effects", () => {
    for (const causeEventId of ["missing-event", "event-002"] as const) {
      const invalid = clone(sampleTrace);
      invalid.events[0]!.causeEventIds = [causeEventId];
      expect(() => parseContract(TraceSchema, invalid)).toThrow(
        /causes must reference an earlier retained event|complete trace causes must reference a retained event/,
      );
    }

    const truncatedMissing = clone(sampleTrace);
    truncatedMissing.truncated = true;
    truncatedMissing.truncationReason = "retention limit";
    truncatedMissing.events[0]!.causeEventIds = ["omitted-event"];
    expect(() => parseContract(TraceSchema, truncatedMissing)).not.toThrow();

    const truncatedForward = clone(truncatedMissing);
    truncatedForward.events[0]!.causeEventIds = ["event-002"];
    expect(() => parseContract(TraceSchema, truncatedForward)).toThrow(/earlier retained event/);
  });

  test("makes tie tolerance, selector actors, and seeded algorithms unambiguous", () => {
    const missingTolerance = clone(sampleScenario);
    missingTolerance.objective.tieTolerance = null;
    expect(() => parseContract(ScenarioSpecSchema, missingTolerance)).toThrow(
      /requires a numeric tolerance/,
    );

    const exactWithTolerance = clone(sampleScenario);
    exactWithTolerance.objective.tiePolicy = "exact";
    expect(() => parseContract(ScenarioSpecSchema, exactWithTolerance)).toThrow(
      /exact tie policy cannot carry a tolerance/,
    );

    expect(() =>
      parseContract(ActionCommandSchema, {
        kind: "basic-attack",
        actorId: "actor",
        target: { kind: "self", actorId: "enemy" },
      }),
    ).toThrow(/selector actor must match/);

    const invalidSeeded = clone(sampleScenario);
    invalidSeeded.evaluationMode = {
      kind: "seeded-trajectory",
      random: { kind: "seeded", algorithm: "none", seed: "seed", trialCount: 1 },
      approximation: null,
    };
    expect(() => parseContract(ScenarioSpecSchema, invalidSeeded)).toThrow(
      /requires a random algorithm/,
    );

    const enemyActor = clone(sampleScenario);
    enemyActor.actorEntityId = "enemy";
    expect(() => parseContract(ScenarioSpecSchema, enemyActor)).toThrow(/actor team/);
  });

  test("rejects retroactive commands, reversed run timestamps, and contradictory empty inventory", () => {
    expect(() =>
      parseContract(EngineCommandSchema, {
        schemaVersion: 1,
        kind: "schedule-event",
        commandId: "retroactive",
        issuedAtMs: 1000,
        causeEventIds: [],
        event: {
          eventId: "past-event",
          timeMs: 500,
          sequence: 1,
          phase: "impact",
          kind: "damage",
          payload: {},
          causeEventIds: [],
        },
      }),
    ).toThrow(/cannot precede command issue time/);

    const reversed = clone(sampleRun);
    reversed.completedAt = "2026-09-18T23:59:59Z";
    expect(() => parseContract(RunManifestSchema, reversed)).toThrow(/cannot precede createdAt/);

    const contradictory = clone(transformedCopiedAbility);
    contradictory.inventoryOrigin = "empty";
    expect(() => parseContract(EntityStateSchema, contradictory)).toThrow(
      /empty inventory origin requires an empty inventory/,
    );
  });

  test("reconciles damage totals and death state", () => {
    expect(() =>
      parseContract(DamageResolutionSchema, {
        attempted: 10,
        absorbed: 0,
        prevented: 0,
        applied: 10,
        overkill: 20,
        targetHealthAfter: 0,
        killed: true,
      }),
    ).toThrow(/totals must reconcile/);
    expect(() =>
      parseContract(DamageResolutionSchema, {
        attempted: 10,
        absorbed: 0,
        prevented: 0,
        applied: 10,
        overkill: 0,
        targetHealthAfter: 10,
        killed: true,
      }),
    ).toThrow(/death state must match/);
  });

  test("mock ports isolate and accumulate mutable state deterministically", () => {
    const ports = createMockPorts();
    const otherRun = { ...mockPortContext, runId: "run-002" };
    const event = clone(sampleSnapshot.queue.entries[0]!);
    const replacement = { ...event, eventId: "replacement", timeMs: 500, sequence: 4 };
    ports.timers.schedule({ event, replacesEventId: null }, mockPortContext);
    ports.timers.schedule({ event: replacement, replacesEventId: event.eventId }, mockPortContext);
    ports.timers.schedule({ event, replacesEventId: null }, otherRun);
    expect(ports.timers.peek(mockPortContext)?.eventId).toBe("replacement");
    expect(ports.timers.peek(otherRun)?.eventId).toBe(event.eventId);
    expect(ports.timers.cancel(event.eventId, mockPortContext)).toBe(false);

    expect(ports.rng.draw({ streamId: "combat", draws: 3 }, mockPortContext).nextDrawCount).toBe(3);
    expect(ports.rng.draw({ streamId: "combat", draws: 2 }, mockPortContext).nextDrawCount).toBe(5);
    expect(ports.rng.draw({ streamId: "combat", draws: 1 }, otherRun).nextDrawCount).toBe(1);
    ports.rng.restore(
      { streamId: "combat", algorithm: "xorshift32", seed: "seed", drawCount: 7, state: [1] },
      mockPortContext,
    );
    expect(ports.rng.draw({ streamId: "combat", draws: 2 }, mockPortContext).nextDrawCount).toBe(9);

    const mutation = { entityId: "actor", resourceId: "mana", delta: -60, reason: "cast" };
    expect(ports.resources.apply(mutation, mockPortContext)).toMatchObject({
      previous: 100,
      current: 40,
    });
    expect(ports.resources.apply(mutation, mockPortContext)).toMatchObject({
      previous: 40,
      current: 0,
    });
    expect(ports.resources.apply(mutation, otherRun)).toMatchObject({
      previous: 100,
      current: 40,
    });
    ports.resources.restore(transformedCopiedAbility, otherRun);
    expect(ports.resources.apply(mutation, otherRun)).toMatchObject({
      previous: 500,
      current: 440,
    });
  });

  test("mock lowest-health targeting returns one deterministic enemy", () => {
    const ports = createMockPorts();
    const visibleState = visiblePolicyStateFixture();
    visibleState.entities.push({
      ...clone(visibleState.entities[1]!),
      entityId: "enemy-low",
      health: { current: 100, maximum: 1000, shield: 0 },
    });
    visibleState.visibility.visibleEntityIds.push("enemy-low");
    visibleState.entities[1]!.alive = false;
    visibleState.entities[1]!.health.current = 0;
    const result = ports.targeting.select(
      {
        actor: transformedCopiedAbility,
        selector: { kind: "lowest-health-visible-enemy", actorId: "actor" },
        visibleState: parseContract(PolicyVisibleStateSchema, visibleState),
      },
      mockPortContext,
    );
    expect(result.targetEntityIds).toEqual(["enemy-low"]);

    const allEnemies = ports.targeting.select(
      {
        actor: transformedCopiedAbility,
        selector: { kind: "all-visible-enemies", actorId: "actor" },
        visibleState: parseContract(PolicyVisibleStateSchema, visibleState),
      },
      mockPortContext,
    );
    expect(allEnemies.targetEntityIds).toEqual(["enemy-low"]);
  });

  test("mock damage consumes shields before health", () => {
    const ports = createMockPorts();
    const shielded = clone(observedTarget);
    shielded.health.current = 80;
    shielded.health.maximum = 80;
    shielded.health.shield = 30;
    const resolution = ports.damage.resolve(
      {
        packet: {
          sourceEntityId: "actor",
          targetEntityId: "enemy",
          damageType: "physical",
          rawAmount: 100,
          tags: [],
          canOverkill: true,
        },
        attacker: transformedCopiedAbility,
        target: shielded,
        attackerStats: { entityId: "actor", revision: 1, values: transformedCopiedAbility.stats },
        targetStats: { entityId: "enemy", revision: 1, values: shielded.stats },
        read: { kind: "impact", entityId: "enemy", atTimeMs: 100, stateRevision: 1 },
      },
      mockPortContext,
    );
    expect(resolution).toMatchObject({
      attempted: 100,
      absorbed: 30,
      applied: 70,
      overkill: 0,
      targetHealthAfter: 10,
      killed: false,
    });
  });

  test("hardens remaining replay and adapter boundaries", () => {
    const impossibleDate = clone(sampleRun);
    impossibleDate.createdAt = "2026-02-30T00:00:00Z";
    expect(() => parseContract(RunManifestSchema, impossibleDate)).toThrow(/real calendar/);

    const hiddenTarget = clone(sampleScenario);
    hiddenTarget.policy.visibility.visibleEntityIds = ["actor"];
    expect(() => parseContract(ScenarioSpecSchema, hiddenTarget)).toThrow(/targets hidden entity/);

    const futureBuff = clone(sampleScenario);
    futureBuff.policy.steps[0]!.condition = {
      kind: "buff-stacks-at-least",
      entityId: "actor",
      buffId: "future-proc",
      stacks: 1,
    };
    expect(() => parseContract(ScenarioSpecSchema, futureBuff)).not.toThrow();

    const completedCursor = clone(sampleSnapshot);
    completedCursor.policyProgress.nextStepId = "cast-w";
    expect(() => parseContract(EngineSnapshotSchema, completedCursor)).toThrow(
      /executable progress/,
    );

    const causalQueue = clone(sampleSnapshot);
    causalQueue.queue.entries.push({
      ...causalQueue.queue.entries[0]!,
      eventId: "event-later",
      sequence: 4,
      timeMs: 2000,
    });
    causalQueue.queue.entries[0]!.causeEventIds = ["event-later"];
    causalQueue.queue.nextSequence = 5;
    expect(() => parseContract(EngineSnapshotSchema, causalQueue)).toThrow(/earlier retained/);

    const deadAlive = clone(transformedCopiedAbility);
    deadAlive.health.current = 0;
    expect(() => parseContract(EntityStateSchema, deadAlive)).toThrow(/alive state/);

    const expiredVisible = visiblePolicyStateFixture();
    expiredVisible.atTimeMs = 4000;
    expect(() => parseContract(PolicyVisibleStateSchema, expiredVisible)).toThrow(
      /visible buffs cannot already be expired/,
    );

    const negativeZero = clone(transformedCopiedAbility);
    negativeZero.position.x = -0;
    expect(Object.is(parseContract(EntityStateSchema, negativeZero).position.x, -0)).toBe(false);
  });

  test("validates request-correlated port results and terminal runs", () => {
    expect(() =>
      assertRngResult({ streamId: "combat", draws: 2 }, 7, {
        streamId: "combat",
        values: [0.1, Number.NaN],
        nextDrawCount: 9,
      }),
    ).toThrow(/non-finite/);

    const request = {
      packet: {
        sourceEntityId: "actor",
        targetEntityId: "enemy",
        damageType: "physical" as const,
        rawAmount: 10,
        tags: [] as string[],
        canOverkill: false,
      },
      attacker: transformedCopiedAbility,
      target: observedTarget,
      attackerStats: { entityId: "actor", revision: 1, values: transformedCopiedAbility.stats },
      targetStats: { entityId: "enemy", revision: 1, values: observedTarget.stats },
      read: { kind: "impact" as const, entityId: "enemy", atTimeMs: 0, stateRevision: 1 },
    };
    expect(() =>
      assertDamageResolution(request, {
        attempted: 10,
        absorbed: 0,
        prevented: 0,
        applied: 10,
        overkill: 0,
        targetHealthAfter: 0,
        killed: true,
      }),
    ).toThrow(/requested packet and target/);

    expect(() =>
      assertEngineRun(
        { scenario: sampleResolvedScenario, run: sampleRunningRun, ports: createMockPorts() },
        {
          status: "complete",
          result: { ...censoredResult, status: "invalid" },
          trace: sampleTrace,
        },
      ),
    ).toThrow(/must match/);

    expect(() =>
      assertStatsSnapshot(
        {
          entity: transformedCopiedAbility,
          read: { kind: "snapshot", entityId: "actor", atTimeMs: 0, stateRevision: 2 },
        },
        mockPortContext,
        { entityId: "enemy", revision: 1, values: { armor: 10 } },
      ),
    ).toThrow(/requested entity and state revision/);
  });

  test("validates worker event batches, horizons, uncertainty, and resume modes", () => {
    const step = {
      schemaVersion: 1 as const,
      status: "progress" as const,
      snapshot: sampleSnapshot,
      emittedEvents: [
        {
          schemaVersion: 1 as const,
          eventId: "later",
          timeMs: 200,
          sequence: 2,
          phase: "impact" as const,
          kind: "damage",
          actorEntityId: "actor",
          targetEntityIds: ["enemy"],
          causeEventIds: [],
          payload: {},
        },
        {
          schemaVersion: 1 as const,
          eventId: "earlier",
          timeMs: 100,
          sequence: 1,
          phase: "input" as const,
          kind: "action",
          actorEntityId: "actor",
          targetEntityIds: ["enemy"],
          causeEventIds: [],
          payload: {},
        },
      ],
      result: null,
      reason: sampleSnapshot.interruption.reason,
    };
    expect(() => parseContract(EngineStepResultSchema, step)).toThrow(/ordered by time/);

    const pastHorizon = clone(sampleTransfer);
    pastHorizon.result.killed = true;
    pastHorizon.result.censoring = "not-censored";
    pastHorizon.result.metrics.ttk = { status: "value", value: 6000 };
    expect(() => parseContract(ExactComparisonTransferSchema, pastHorizon)).toThrow(
      /cannot exceed.*horizon/,
    );

    const sampled = clone(sampleTransfer);
    sampled.run.evaluationMode = {
      kind: "sampled-estimate",
      random: { kind: "seeded", algorithm: "xorshift32", seed: "seed", trialCount: 10 },
      approximation: null,
      confidenceLevel: 0.95,
    };
    sampled.run.random = clone(sampled.run.evaluationMode.random);
    sampled.resolvedScenario.effective.evaluationMode = clone(sampled.run.evaluationMode);
    sampled.result.uncertainty = null;
    expect(() => parseContract(ExactComparisonTransferSchema, sampled)).toThrow(
      /machine-readable uncertainty/,
    );

    const wrongMode = clone(sampleSnapshot);
    wrongMode.numericalBranches[0]!.mode = "sampled-estimate";
    expect(() =>
      assertResumeCompatible(
        { scenario: sampleResolvedScenario, run: sampleRunningRun, ports: createMockPorts() },
        wrongMode,
      ),
    ).toThrow(/numerical branch/);
  });

  test("enforces latest-head request, snapshot, trace, and time invariants", () => {
    expect(() =>
      assertResourceResolution(
        { entityId: "actor", resourceId: "mana", delta: -10, reason: "cast" },
        transformedCopiedAbility.resources[0]!,
        {
          accepted: "yes",
          entityId: "actor",
          resourceId: "mana",
          previous: 100,
          current: 90,
          reason: null,
        },
      ),
    ).toThrow();

    expect(() =>
      assertTargetingResolution(
        {
          actor: transformedCopiedAbility,
          selector: { kind: "self", actorId: "actor" },
          visibleState: parseContract(PolicyVisibleStateSchema, visiblePolicyStateFixture()),
        },
        { ...mockPortContext, timeMs: 100 },
        { targetEntityIds: ["enemy"], rejected: false, reason: null },
      ),
    ).toThrow(/selector semantics/);

    expect(() =>
      assertStatsSnapshot(
        {
          entity: transformedCopiedAbility,
          read: { kind: "snapshot", entityId: "enemy", atTimeMs: 0, stateRevision: 1 },
        },
        mockPortContext,
        { entityId: "actor", revision: 1, values: { attackDamage: 150 } },
      ),
    ).toThrow(/stats read entity/);

    const traceMismatch = clone(censoredResult);
    traceMismatch.traceId = "different-trace";
    expect(() =>
      assertEngineRun(
        { scenario: sampleResolvedScenario, run: sampleRunningRun, ports: createMockPorts() },
        { status: "complete", result: traceMismatch, trace: sampleTrace },
      ),
    ).toThrow(/trace identity/);

    const ownershipCycle = clone(sampleSnapshot);
    ownershipCycle.entities[0]!.ownerEntityId = "enemy";
    ownershipCycle.entities[1]!.ownerEntityId = "actor";
    expect(() => parseContract(EngineSnapshotSchema, ownershipCycle)).toThrow(/ownership.*cycles/);

    const pastHorizon = clone(sampleSnapshot);
    pastHorizon.currentTimeMs = 5001;
    pastHorizon.queue.entries[0]!.timeMs = 6000;
    pastHorizon.buffs[0]!.expiresAtMs = null;
    pastHorizon.entities[0]!.buffs[0]!.expiresAtMs = null;
    expect(() =>
      assertResumeCompatible(
        { scenario: sampleResolvedScenario, run: sampleRunningRun, ports: createMockPorts() },
        pastHorizon,
      ),
    ).toThrow(/objective horizon/);

    const emptyCompleted = clone(sampleSnapshot);
    emptyCompleted.policyProgress.steps[0]!.consumedRepeats = 0;
    expect(() =>
      assertResumeCompatible(
        { scenario: sampleResolvedScenario, run: sampleRunningRun, ports: createMockPorts() },
        emptyCompleted,
      ),
    ).toThrow(/exactly one execution/);

    const subMillisecond = clone(sampleRun);
    subMillisecond.createdAt = "2026-09-19T00:00:00.0009Z";
    expect(() => parseContract(RunManifestSchema, subMillisecond)).toThrow(/explicit timezone/);
  });

  test("enforces selector, port identity, RNG, and lifecycle boundaries", () => {
    const visibleState = visiblePolicyStateFixture();
    visibleState.entities.push({
      ...clone(visibleState.entities[1]!),
      entityId: "enemy-low",
      health: { current: 1, maximum: 100, shield: 0 },
    });
    visibleState.visibility.visibleEntityIds.push("enemy-low");
    const parsedVisible = parseContract(PolicyVisibleStateSchema, visibleState);
    expect(() =>
      assertTargetingResolution(
        {
          actor: transformedCopiedAbility,
          selector: { kind: "lowest-health-visible-enemy", actorId: "actor" },
          visibleState: parsedVisible,
        },
        { ...mockPortContext, timeMs: 100 },
        { targetEntityIds: ["enemy"], rejected: false, reason: null },
      ),
    ).toThrow(/dynamic selector/);
    expect(() =>
      assertTargetingResolution(
        {
          actor: transformedCopiedAbility,
          selector: { kind: "all-visible-enemies", actorId: "actor" },
          visibleState: parsedVisible,
        },
        { ...mockPortContext, timeMs: 100 },
        { targetEntityIds: ["actor"], rejected: false, reason: null },
      ),
    ).toThrow(/dynamic selector|visible entities/);

    const ports = createMockPorts();
    const command = {
      packet: {
        sourceEntityId: "enemy",
        targetEntityId: "enemy",
        damageType: "physical" as const,
        rawAmount: 10,
        tags: [] as string[],
        canOverkill: false,
      },
      attacker: transformedCopiedAbility,
      target: observedTarget,
      attackerStats: { entityId: "actor", revision: 1, values: transformedCopiedAbility.stats },
      targetStats: { entityId: "enemy", revision: 1, values: observedTarget.stats },
      read: { kind: "impact" as const, entityId: "enemy", atTimeMs: 0, stateRevision: 1 },
    };
    expect(() =>
      assertDamageResolution(command, {
        attempted: 10,
        absorbed: 0,
        prevented: 0,
        applied: 10,
        overkill: 0,
        targetHealthAfter: observedTarget.health.current - 10,
        killed: false,
      }),
    ).toThrow(/identities/);

    expect(() =>
      assertLifecycleResolution(
        { entityId: "enemy", transition: "death", replacement: null },
        sampleSnapshot.entities,
        ports.lifecycle.apply(
          { entityId: "actor", transition: "death", replacement: null },
          mockPortContext,
        ),
      ),
    ).toThrow(/requested identity/);

    const executableRng = {
      streamId: "combat",
      values: [0.5],
      nextDrawCount: 1,
      extra: () => 1,
    };
    expect(() => assertRngResult({ streamId: "combat", draws: 1 }, 0, executableRng)).toThrow();

    const seededScenario = clone(sampleResolvedScenario);
    seededScenario.effective.evaluationMode = {
      kind: "seeded-trajectory",
      random: { kind: "seeded", algorithm: "xorshift32", seed: "expected", trialCount: 1 },
      approximation: null,
    };
    const seededRun = clone(sampleRunningRun);
    seededRun.evaluationMode = clone(seededScenario.effective.evaluationMode);
    seededRun.random = clone(seededRun.evaluationMode.random);
    const seededSnapshot = clone(sampleSnapshot);
    seededSnapshot.numericalBranches[0]!.mode = "seeded-trajectory";
    seededSnapshot.rngStreams[0]!.algorithm = "xorshift32";
    seededSnapshot.rngStreams[0]!.seed = "wrong";
    expect(() =>
      assertResumeCompatible(
        { scenario: seededScenario, run: seededRun, ports: createMockPorts() },
        seededSnapshot,
      ),
    ).toThrow(/evaluation seed/);
  });

  test("enforces cohort modes, proxy rejection order, and effective policy hashes", async () => {
    const uniform = clone(sampleScenario);
    uniform.cohort.weighting = "uniform-member";
    uniform.cohort.members.push({
      ...clone(uniform.cohort.members[0]!),
      memberId: "member-002",
      weight: 0.25,
    });
    uniform.cohort.members[0]!.weight = 0.75;
    expect(() => parseContract(ScenarioSpecSchema, uniform)).toThrow(/equal member weights/);

    const matchBalanced = clone(sampleScenario);
    matchBalanced.cohort.weighting = "match-balanced";
    matchBalanced.cohort.members[0]!.weight = 1 / 3;
    matchBalanced.cohort.members.push(
      {
        ...clone(matchBalanced.cohort.members[0]!),
        memberId: "member-002",
        matchKey: "match-001",
      },
      {
        ...clone(matchBalanced.cohort.members[0]!),
        memberId: "member-003",
        matchKey: "match-002",
      },
    );
    expect(() => parseContract(ScenarioSpecSchema, matchBalanced)).toThrow(
      /equal aggregate weight per match/,
    );

    let traversed = false;
    const hostileProxy = new Proxy(
      { value: 1 },
      {
        ownKeys() {
          traversed = true;
          return ["value"];
        },
      },
    );
    expect(() => canonicalJson(hostileProxy)).toThrow(/structured-clone-safe/);
    expect(traversed).toBe(true);

    const policyBound = clone(sampleResolvedScenario);
    policyBound.policyHash = await hashCanonical(policyBound.effective.policy);
    policyBound.resolvedScenarioHash = await hashCanonical(policyBound.effective);
    await expect(assertResolvedScenarioPolicyHash(policyBound)).resolves.toBeDefined();
    policyBound.effective.policy.steps[0]!.priority += 100;
    await expect(assertResolvedScenarioPolicyHash(policyBound)).rejects.toThrow(
      /resolved scenario hashes/,
    );
  });

  test("closes paginated findings for worker, adapter, and aggregate boundaries", async () => {
    const noOpUpgrade = {
      ...clone(parsedItemInstance),
      effectiveItemId: parsedItemInstance.baseItemId,
      upgrade: {
        upgradeId: "noop",
        fromItemId: parsedItemInstance.baseItemId,
        toItemId: parsedItemInstance.baseItemId,
      },
    };
    expect(() => parseContract(ItemInstanceSchema, noOpUpgrade)).toThrow(
      /unchanged item identity|real identity change/,
    );

    expect(() =>
      parseContract(WorkerMessageSchema, {
        schemaVersion: 1,
        direction: "event",
        payload: {
          schemaVersion: 1,
          eventId: "event-worker",
          timeMs: 0,
          sequence: 1,
          phase: "input",
          kind: "action",
          actorEntityId: "actor",
          targetEntityIds: [],
          causeEventIds: [],
          payload: {},
        },
      }),
    ).toThrow(/expected string/);

    const activeOneShot = clone(sampleSnapshot);
    activeOneShot.policyProgress.steps[0]!.state = "active";
    expect(() =>
      assertResumeCompatible(
        { scenario: sampleResolvedScenario, run: sampleRunningRun, ports: createMockPorts() },
        activeOneShot,
      ),
    ).toThrow(/repeat limit/);

    expect(() =>
      assertMovementResolution(
        {
          entity: transformedCopiedAbility,
          destination: { x: 1, y: 2, z: 3 },
          read: { kind: "snapshot", entityId: "enemy", atTimeMs: 0, stateRevision: 1 },
        },
        { entityId: "actor", accepted: true, position: { x: 1, y: 2, z: 3 }, reason: null },
      ),
    ).toThrow(/requested entity/);

    expect(() =>
      assertTriggerDispatchResult(
        {
          triggerId: "trigger",
          ownerEntityId: "actor",
          event: {
            schemaVersion: 1,
            eventId: "cause",
            timeMs: 0,
            sequence: 1,
            phase: "input",
            kind: "action",
            actorEntityId: "actor",
            targetEntityIds: [],
            causeEventIds: [],
            payload: {},
          },
        },
        mockPortContext,
        { accepted: false, emittedCommands: [{ schemaVersion: 1 }], reason: "rejected" },
      ),
    ).toThrow(/commands must correlate/);

    const impossibleCoverage = clone(censoredResult);
    impossibleCoverage.coverage = {
      killedCount: 0,
      totalCount: 1,
      killedWeight: 1,
      totalWeight: 1,
      fraction: 1,
    };
    expect(() => parseContract(CombatResultSchema, impossibleCoverage)).toThrow(
      /kill count and weight/,
    );

    const contradictoryReadiness = visiblePolicyStateFixture();
    contradictoryReadiness.readiness[0]!.cooldownRemainingMs = 1;
    expect(() => parseContract(PolicyVisibleStateSchema, contradictoryReadiness)).toThrow(
      /zero remaining cooldown/,
    );

    const infiniteAggregate = clone(sampleScenario);
    infiniteAggregate.cohort.normalized = false;
    infiniteAggregate.cohort.weighting = "declared-mass";
    infiniteAggregate.cohort.members[0]!.weight = 1e308;
    infiniteAggregate.cohort.members.push({
      ...clone(infiniteAggregate.cohort.members[0]!),
      memberId: "member-large",
    });
    expect(() => parseContract(ScenarioSpecSchema, infiniteAggregate)).toThrow(
      /aggregate cohort weight must be finite/,
    );

    let getterRan = false;
    const accessor = {};
    Object.defineProperty(accessor, "value", {
      enumerable: true,
      get: () => {
        getterRan = true;
        return 1;
      },
    });
    expect(() => canonicalJson(accessor)).toThrow(/accessor/);
    expect(getterRan).toBe(false);

    const scenarioHash = clone(sampleResolvedScenario);
    scenarioHash.policyHash = await hashCanonical(scenarioHash.effective.policy);
    scenarioHash.resolvedScenarioHash = await hashCanonical(scenarioHash.effective);
    scenarioHash.effective.objective.horizonMs += 1;
    await expect(assertResolvedScenarioPolicyHash(scenarioHash)).rejects.toThrow(
      /resolved scenario hashes/,
    );
  });

  test("closes Prometheus exact-head runtime and cross-field findings", () => {
    const shielded = clone(observedTarget);
    shielded.health.shield = 80;
    const damageRequest = {
      packet: {
        sourceEntityId: "actor",
        targetEntityId: "enemy",
        damageType: "physical" as const,
        rawAmount: 100,
        tags: [] as string[],
        canOverkill: false,
      },
      attacker: transformedCopiedAbility,
      target: shielded,
      attackerStats: { entityId: "actor", revision: 1, values: transformedCopiedAbility.stats },
      targetStats: { entityId: "enemy", revision: 1, values: shielded.stats },
      read: { kind: "impact" as const, entityId: "enemy", atTimeMs: 0, stateRevision: 1 },
    };
    expect(() =>
      assertDamageResolution(damageRequest, {
        attempted: 100,
        prevented: 50,
        absorbed: 50,
        applied: 0,
        overkill: 0,
        targetHealthAfter: shielded.health.current,
        killed: false,
      }),
    ).not.toThrow();

    expect(() =>
      assertTargetingResolution(
        {
          actor: transformedCopiedAbility,
          selector: { kind: "self", actorId: "enemy" },
          visibleState: parseContract(PolicyVisibleStateSchema, visiblePolicyStateFixture()),
        },
        { ...mockPortContext, timeMs: 100 },
        { targetEntityIds: ["enemy"], rejected: false, reason: null },
      ),
    ).toThrow(/actor, selector/);
    expect(() =>
      assertResourceResolution(
        { entityId: "actor", resourceId: "mana", delta: 0, reason: "blocked" },
        transformedCopiedAbility.resources[0]!,
        {
          accepted: false,
          entityId: "actor",
          resourceId: "mana",
          previous: -1,
          current: -1,
          reason: "blocked",
        },
      ),
    ).toThrow();
    expect(() => assertTimerCancelResult("yes")).toThrow(/boolean/);
    expect(() =>
      assertTimerPeekResult(mockPortContext, {
        ...sampleSnapshot.queue.entries[0]!,
        timeMs: -1,
      }),
    ).toThrow();

    const wrongReplacement = clone(transformedCopiedAbility);
    wrongReplacement.entityId = "other";
    expect(() =>
      assertLifecycleResolution(
        { entityId: "actor", transition: "transform", replacement: wrongReplacement },
        sampleSnapshot.entities,
        {
          accepted: true,
          entityId: "actor",
          transition: "transform",
          state: wrongReplacement,
          reason: null,
        },
      ),
    ).toThrow(/replacement identity/);

    const seededTrials = clone(sampleScenario);
    seededTrials.evaluationMode = {
      kind: "seeded-trajectory",
      random: { kind: "seeded", algorithm: "xorshift32", seed: "seed", trialCount: 2 },
      approximation: null,
    };
    expect(() => parseContract(ScenarioSpecSchema, seededTrials)).toThrow(/exactly one trial/);

    const oneShotLimit = clone(samplePolicy);
    oneShotLimit.steps[0]!.maxRepeats = 2;
    expect(() => parseContract(ActionPolicySchema, oneShotLimit)).toThrow(/null repeat limit/);

    const futureResult = completeSnapshotForTest();
    futureResult.currentTimeMs = 100;
    futureResult.result = clone(censoredResult);
    futureResult.result.killed = true;
    futureResult.result.censoring = "not-censored";
    futureResult.result.metrics.ttk = { status: "value", value: 500 };
    expect(() => parseContract(EngineSnapshotSchema, futureResult)).toThrow(
      /cannot exceed currentTimeMs/,
    );

    const reversedDeaths = clone(censoredResult);
    reversedDeaths.metrics.timeToFirstDeath = { status: "value", value: 200 };
    reversedDeaths.metrics.timeToElimination = { status: "value", value: 100 };
    expect(() => parseContract(CombatResultSchema, reversedDeaths)).toThrow(
      /first death cannot follow/,
    );

    const futureArtifact = clone(sampleRuleset);
    futureArtifact.generatedAt = "2026-09-18T00:00:00Z";
    expect(() => parseContract(ContractSchemas.RulesetManifest, futureArtifact)).toThrow(
      /artifact retrieval cannot follow/,
    );
  });

  test("closes latest exact-head execution boundary findings", () => {
    const lowHealthTarget = clone(observedTarget);
    lowHealthTarget.health.current = 5;
    const overkillRequest = {
      packet: {
        sourceEntityId: "actor",
        targetEntityId: "enemy",
        damageType: "true" as const,
        rawAmount: 10,
        tags: [] as string[],
        canOverkill: true,
      },
      attacker: transformedCopiedAbility,
      target: lowHealthTarget,
      attackerStats: { entityId: "actor", revision: 1, values: transformedCopiedAbility.stats },
      targetStats: { entityId: "enemy", revision: 1, values: lowHealthTarget.stats },
      read: { kind: "impact" as const, entityId: "enemy", atTimeMs: 0, stateRevision: 1 },
    };
    expect(() =>
      assertDamageResolution(overkillRequest, {
        attempted: 10,
        prevented: 0,
        absorbed: 0,
        applied: 4,
        overkill: 6,
        targetHealthAfter: 1,
        killed: false,
      }),
    ).toThrow(/requested packet and target state/);

    expect(() =>
      assertResourceResolution(
        { entityId: "actor", resourceId: "mana", delta: 100, reason: "restore" },
        transformedCopiedAbility.resources[0]!,
        {
          accepted: true,
          entityId: "actor",
          resourceId: "mana",
          previous: transformedCopiedAbility.resources[0]!.current,
          current: transformedCopiedAbility.resources[0]!.maximum + 1,
          reason: null,
        },
      ),
    ).toThrow(/requested mutation/);

    expect(() =>
      assertTimerPeekResult(
        { ...mockPortContext, timeMs: 101 },
        { ...sampleSnapshot.queue.entries[0]!, timeMs: 100 },
      ),
    ).toThrow(/precede port time/);

    expect(() =>
      assertMovementResolution(
        {
          entity: transformedCopiedAbility,
          destination: { x: 1, y: 2, z: 3 },
          read: { kind: "snapshot", entityId: "actor", atTimeMs: 0, stateRevision: 1 },
        },
        { entityId: "actor", accepted: false, position: { x: 1, y: 2, z: 3 }, reason: "blocked" },
      ),
    ).toThrow(/destination.*acceptance/);

    expect(() =>
      assertTriggerDispatchResult(
        {
          triggerId: "trigger",
          ownerEntityId: "actor",
          event: {
            schemaVersion: 1,
            eventId: "cause",
            timeMs: 0,
            sequence: 1,
            phase: "input",
            kind: "action",
            actorEntityId: "actor",
            targetEntityIds: [],
            causeEventIds: [],
            payload: {},
          },
        },
        mockPortContext,
        {
          accepted: true,
          emittedCommands: [
            {
              schemaVersion: 1,
              kind: "cancel-event",
              commandId: "late-command",
              issuedAtMs: 101,
              causeEventIds: ["cause"],
              eventId: "scheduled",
            },
          ],
          reason: null,
        },
      ),
    ).toThrow(/dispatch timing/);

    expect(() =>
      parseContract(WorkerMessageSchema, {
        schemaVersion: 1,
        direction: "command",
        payload: {
          schemaVersion: 1,
          kind: "cancel-event",
          commandId: "command",
          issuedAtMs: 0,
          causeEventIds: [],
          eventId: "event",
        },
      }),
    ).toThrow(/expected string/);

    expect(() =>
      parseContract(EngineCommandSchema, {
        schemaVersion: 1,
        kind: "schedule-event",
        commandId: "command",
        issuedAtMs: 0,
        causeEventIds: ["cause"],
        event: {
          ...sampleSnapshot.queue.entries[0]!,
          causeEventIds: [],
        },
      }),
    ).toThrow(/preserve every command cause/);

    const nonKillElimination = clone(censoredResult);
    nonKillElimination.metrics.timeToElimination = { status: "value", value: 100 };
    expect(() => parseContract(CombatResultSchema, nonKillElimination)).toThrow(
      /non-kill.*finite time to elimination/,
    );

    const orphanedPending = clone(sampleSnapshot);
    orphanedPending.pendingActions[0]!.continuationEventId = "missing-event";
    expect(() => parseContract(EngineSnapshotSchema, orphanedPending)).toThrow(
      /queued continuation/,
    );

    const deadRevive = clone(transformedCopiedAbility);
    deadRevive.alive = false;
    deadRevive.health.current = 0;
    expect(() =>
      assertLifecycleResolution(
        { entityId: "actor", transition: "revive", replacement: deadRevive },
        sampleSnapshot.entities,
        {
          accepted: true,
          entityId: "actor",
          transition: "revive",
          state: deadRevive,
          reason: null,
        },
      ),
    ).toThrow(/alive with positive health/);

    const planned = { ...sampleRunningRun, status: "planned" as const };
    expect(() =>
      assertEngineInputCompatible({
        scenario: sampleResolvedScenario,
        run: planned,
        ports: createMockPorts(),
      }),
    ).not.toThrow();
    expect(() =>
      assertEngineInputCompatible({
        scenario: sampleResolvedScenario,
        run: sampleRunningRun,
        ports: createMockPorts(),
      }),
    ).toThrow(/planned for fresh execution/);

    const scriptedScenario = clone(sampleResolvedScenario);
    scriptedScenario.effective.policy.mode = "scripted";
    const skippedCursor = clone(sampleSnapshot);
    skippedCursor.policyProgress.nextStepId = "basic-attack";
    skippedCursor.policyProgress.steps[0] = {
      stepId: "cast-w",
      consumedRepeats: 0,
      state: "not-started",
    };
    expect(() =>
      assertResumeCompatible(
        { scenario: scriptedScenario, run: sampleRunningRun, ports: createMockPorts() },
        skippedCursor,
      ),
    ).toThrow(/first executable step/);
  });

  test("closes latest transfer, targeting, and resume findings", async () => {
    const staleTransfer = clone(sampleTransfer);
    staleTransfer.resolvedScenario.effective.policy.steps[0]!.priority += 100;
    await expect(assertExactComparisonTransfer(staleTransfer)).rejects.toThrow(
      /resolved scenario hashes/,
    );

    const missingReadiness = visiblePolicyStateFixture();
    missingReadiness.readiness = [];
    expect(() => parseContract(PolicyVisibleStateSchema, missingReadiness)).toThrow(
      /every visible ability requires exactly one readiness record/,
    );

    const visible = parseContract(PolicyVisibleStateSchema, visiblePolicyStateFixture());
    const targetingRequest = {
      actor: transformedCopiedAbility,
      selector: { kind: "self" as const, actorId: "actor" },
      visibleState: visible,
    };
    expect(() =>
      assertTargetingResolution(
        targetingRequest,
        { ...mockPortContext, timeMs: 100 },
        {
          targetEntityIds: ["actor"],
          rejected: true,
          reason: "blocked",
        },
      ),
    ).toThrow(/return no targets/);
    expect(() =>
      assertTargetingResolution(
        targetingRequest,
        { ...mockPortContext, timeMs: 99 },
        {
          targetEntityIds: ["actor"],
          rejected: false,
          reason: null,
        },
      ),
    ).toThrow(/context time/);

    const selfOwned = clone(transformedCopiedAbility);
    selfOwned.ownerEntityId = selfOwned.entityId;
    expect(() => parseContract(EntityStateSchema, selfOwned)).toThrow(/cannot own itself/);

    const seededScenario = clone(sampleResolvedScenario);
    seededScenario.effective.evaluationMode = {
      kind: "seeded-trajectory",
      random: { kind: "seeded", algorithm: "xorshift32", seed: "expected", trialCount: 1 },
      approximation: null,
    };
    const seededRun = clone(sampleRunningRun);
    seededRun.evaluationMode = clone(seededScenario.effective.evaluationMode);
    seededRun.random = clone(seededRun.evaluationMode.random);
    const missingRng = clone(sampleSnapshot);
    missingRng.numericalBranches[0]!.mode = "seeded-trajectory";
    missingRng.rngStreams = [];
    expect(() =>
      assertResumeCompatible(
        { scenario: seededScenario, run: seededRun, ports: createMockPorts() },
        missingRng,
      ),
    ).toThrow(/retained RNG stream state/);
  });

  test("closes latest continuation, numeric, and execution-boundary findings", async () => {
    const terminalContinuation = clone(sampleSnapshot);
    terminalContinuation.pendingActions[0]!.state = "complete";
    expect(() => parseContract(EngineSnapshotSchema, terminalContinuation)).toThrow(
      /terminal pending actions cannot retain continuations/,
    );

    const sampledScenario = clone(sampleResolvedScenario);
    sampledScenario.effective.evaluationMode = {
      kind: "sampled-estimate",
      random: { kind: "seeded", algorithm: "xorshift32", seed: "seed", trialCount: 10 },
      approximation: null,
      confidenceLevel: 0.95,
    };
    const sampledRun = clone(sampleRunningRun);
    sampledRun.evaluationMode = clone(sampledScenario.effective.evaluationMode);
    sampledRun.random = clone(sampledRun.evaluationMode.random);
    const missingBranch = clone(sampleSnapshot);
    missingBranch.rngStreams[0]!.algorithm = "xorshift32";
    missingBranch.rngStreams[0]!.seed = "seed";
    missingBranch.numericalBranches = [];
    expect(() =>
      assertResumeCompatible(
        { scenario: sampledScenario, run: sampledRun, ports: createMockPorts() },
        missingBranch,
      ),
    ).toThrow(/retained numerical branch state/);

    const fractionalTarget = clone(observedTarget);
    fractionalTarget.health.current = 1;
    fractionalTarget.health.maximum = 1;
    fractionalTarget.health.shield = 0.2;
    expect(() =>
      assertDamageResolution(
        {
          packet: {
            sourceEntityId: "actor",
            targetEntityId: "enemy",
            damageType: "magic",
            rawAmount: 0.3,
            tags: [],
            canOverkill: false,
          },
          attacker: transformedCopiedAbility,
          target: fractionalTarget,
          attackerStats: { entityId: "actor", revision: 1, values: {} },
          targetStats: { entityId: "enemy", revision: 1, values: {} },
          read: { kind: "impact", entityId: "enemy", atTimeMs: 0, stateRevision: 1 },
        },
        {
          attempted: 0.3,
          prevented: 0.1,
          absorbed: 0.2,
          applied: 0,
          overkill: 0,
          targetHealthAfter: 1,
          killed: false,
        },
      ),
    ).not.toThrow();

    expect(() =>
      assertResourceResolution(
        { entityId: "actor", resourceId: "mana", delta: 0.2, reason: "regen" },
        { resourceId: "mana", current: 0.1, maximum: 1, regenerationPerSecond: 0 },
        {
          accepted: true,
          entityId: "actor",
          resourceId: "mana",
          previous: 0.1,
          current: 0.3,
          reason: null,
        },
      ),
    ).not.toThrow();

    const verified = await assertResolvedScenarioPolicyHash({
      ...clone(sampleResolvedScenario),
      policyHash: await hashCanonical(sampleResolvedScenario.effective.policy),
      resolvedScenarioHash: await hashCanonical(sampleResolvedScenario.effective),
    });
    expect(() => {
      verified.effective.entities[0]!.stats.attackDamage = 999;
    }).toThrow();

    const foreignResult = clone(censoredResult);
    foreignResult.runId = "run-foreign";
    const foreignTrace = clone(sampleTrace);
    foreignTrace.runId = "run-foreign";
    expect(() =>
      assertEngineRun(
        { scenario: sampleResolvedScenario, run: sampleRunningRun, ports: createMockPorts() },
        { status: "complete", result: foreignResult, trace: foreignTrace },
      ),
    ).toThrow(/requested run identities/);

    const deadTarget = clone(observedTarget);
    deadTarget.alive = false;
    deadTarget.health.current = 0;
    expect(() =>
      assertDamageResolution(
        {
          packet: {
            sourceEntityId: "actor",
            targetEntityId: "enemy",
            damageType: "true",
            rawAmount: 0,
            tags: [],
            canOverkill: false,
          },
          attacker: transformedCopiedAbility,
          target: deadTarget,
          attackerStats: { entityId: "actor", revision: 1, values: {} },
          targetStats: { entityId: "enemy", revision: 1, values: {} },
          read: { kind: "impact", entityId: "enemy", atTimeMs: 0, stateRevision: 1 },
        },
        {
          attempted: 0,
          prevented: 0,
          absorbed: 0,
          applied: 0,
          overkill: 0,
          targetHealthAfter: 0,
          killed: true,
        },
      ),
    ).toThrow(/living target/);

    expect(() =>
      assertStatsSnapshot(
        {
          entity: transformedCopiedAbility,
          read: { kind: "snapshot", entityId: "actor", atTimeMs: 101, stateRevision: 1 },
        },
        { ...mockPortContext, timeMs: 100 },
        { entityId: "actor", revision: 1, values: {} },
      ),
    ).toThrow(/requested entity/);

    const triggerEvent = {
      schemaVersion: 1 as const,
      eventId: "cause",
      timeMs: 100,
      sequence: 1,
      phase: "input" as const,
      kind: "action",
      actorEntityId: "actor",
      targetEntityIds: [] as string[],
      causeEventIds: [] as string[],
      payload: {},
    };
    const duplicateCommand = {
      schemaVersion: 1 as const,
      kind: "cancel-event" as const,
      commandId: "duplicate",
      issuedAtMs: 100,
      causeEventIds: ["cause"],
      eventId: "queued",
    };
    expect(() =>
      assertTriggerDispatchResult(
        { triggerId: "trigger", ownerEntityId: "actor", event: triggerEvent },
        { ...mockPortContext, timeMs: 100 },
        {
          accepted: true,
          emittedCommands: [duplicateCommand, duplicateCommand],
          reason: null,
        },
      ),
    ).toThrow(/command IDs must be unique/);

    const enemyActor = clone(sampleScenario);
    enemyActor.policy.steps[1]!.action.actorId = "enemy";
    expect(() => parseContract(ScenarioSpecSchema, enemyActor)).toThrow(
      /designated scenario actor/,
    );

    const noLivingEnemy = visiblePolicyStateFixture();
    noLivingEnemy.entities[1]!.alive = false;
    noLivingEnemy.entities[1]!.health.current = 0;
    expect(() =>
      assertTargetingResolution(
        {
          actor: transformedCopiedAbility,
          selector: { kind: "lowest-health-visible-enemy", actorId: "actor" },
          visibleState: parseContract(PolicyVisibleStateSchema, noLivingEnemy),
        },
        { ...mockPortContext, timeMs: 100 },
        { targetEntityIds: [], rejected: false, reason: null },
      ),
    ).toThrow(/must reject when no living enemy/);

    expect(() =>
      parseContract(EngineCommandSchema, {
        schemaVersion: 1,
        kind: "trace",
        commandId: "trace-command",
        issuedAtMs: 100,
        causeEventIds: [],
        event: { ...sampleTrace.events[0]!, timeMs: 101 },
      }),
    ).toThrow(/trace event time must match/);
  });

  test("closes latest frontier, correlation, and immutable-transfer findings", async () => {
    const verifiedTransfer = clone(sampleTransfer);
    verifiedTransfer.resolvedScenario.policyHash = await hashCanonical(
      verifiedTransfer.resolvedScenario.effective.policy,
    );
    verifiedTransfer.resolvedScenario.resolvedScenarioHash = await hashCanonical(
      verifiedTransfer.resolvedScenario.effective,
    );
    verifiedTransfer.run.policyHash = verifiedTransfer.resolvedScenario.policyHash;
    verifiedTransfer.run.resolvedScenarioHash =
      verifiedTransfer.resolvedScenario.resolvedScenarioHash;
    verifiedTransfer.result.resolvedScenarioHash =
      verifiedTransfer.resolvedScenario.resolvedScenarioHash;
    const frozenTransfer = await assertExactComparisonTransfer(verifiedTransfer);
    expect(() => {
      frozenTransfer.result.warnings.push("mutated");
    }).toThrow();

    const reusedSequence = clone(sampleSnapshot);
    reusedSequence.queue.entries = [];
    reusedSequence.queue.lastProcessedSequence = 3;
    reusedSequence.queue.nextSequence = 3;
    expect(() => parseContract(EngineSnapshotSchema, reusedSequence)).toThrow(
      /greater than every allocated event sequence/,
    );

    const triggerEvent = {
      schemaVersion: 1 as const,
      eventId: "future-cause",
      timeMs: 100,
      sequence: 2,
      phase: "input" as const,
      kind: "action",
      actorEntityId: "actor",
      targetEntityIds: [] as string[],
      causeEventIds: [] as string[],
      payload: {},
    };
    expect(() =>
      assertTriggerDispatchResult(
        { triggerId: "trigger", ownerEntityId: "actor", event: triggerEvent },
        mockPortContext,
        { accepted: true, emittedCommands: [], reason: null },
      ),
    ).toThrow(/event time and sequence/);

    const scriptedScenario = clone(sampleResolvedScenario);
    scriptedScenario.effective.policy.mode = "scripted";
    const outOfOrder = clone(sampleSnapshot);
    outOfOrder.policyProgress.nextStepId = "cast-w";
    outOfOrder.policyProgress.steps[0] = {
      stepId: "cast-w",
      consumedRepeats: 0,
      state: "not-started",
    };
    outOfOrder.policyProgress.steps[1] = {
      stepId: "basic-attack",
      consumedRepeats: 1,
      state: "completed",
    };
    expect(() =>
      assertResumeCompatible(
        { scenario: scriptedScenario, run: sampleRunningRun, ports: createMockPorts() },
        outOfOrder,
      ),
    ).toThrow(/beyond the cursor/);

    const wrongObjective = clone(censoredResult);
    wrongObjective.objective = "ttk";
    expect(() =>
      assertEngineRun(
        { scenario: sampleResolvedScenario, run: sampleRunningRun, ports: createMockPorts() },
        { status: "complete", result: wrongObjective, trace: sampleTrace },
      ),
    ).toThrow(/requested objective/);

    const prematureCensoring = completeSnapshotForTest();
    prematureCensoring.currentTimeMs = 100;
    expect(() => parseContract(EngineSnapshotSchema, prematureCensoring)).toThrow(
      /censoring horizons cannot exceed currentTimeMs/,
    );

    const missingActor = clone(sampleSnapshot);
    missingActor.entities = [clone(observedTarget)];
    missingActor.buffs = [];
    missingActor.pendingActions = [];
    missingActor.triggerState = [];
    expect(() =>
      assertResumeCompatible(
        { scenario: sampleResolvedScenario, run: sampleRunningRun, ports: createMockPorts() },
        missingActor,
      ),
    ).toThrow(/retain the designated scenario actor/);

    expect(() =>
      parseContract(CombatResultSchema, {
        ...clone(censoredResult),
        coverage: {
          killedCount: 1,
          totalCount: 1,
          killedWeight: 0.30000000000000004,
          totalWeight: 0.3,
          fraction: 1,
        },
      }),
    ).not.toThrow();

    const missingOwner = clone(transformedCopiedAbility);
    missingOwner.ownerEntityId = "missing";
    expect(() =>
      assertLifecycleResolution(
        { entityId: "actor", transition: "transform", replacement: missingOwner },
        sampleSnapshot.entities,
        {
          accepted: true,
          entityId: "actor",
          transition: "transform",
          state: missingOwner,
          reason: null,
        },
      ),
    ).toThrow(/references must resolve/);

    const lowHealth = clone(observedTarget);
    lowHealth.health.current = 5;
    expect(() =>
      assertDamageResolution(
        {
          packet: {
            sourceEntityId: "actor",
            targetEntityId: "enemy",
            damageType: "true",
            rawAmount: 10,
            tags: [],
            canOverkill: false,
          },
          attacker: transformedCopiedAbility,
          target: lowHealth,
          attackerStats: { entityId: "actor", revision: 1, values: {} },
          targetStats: { entityId: "enemy", revision: 1, values: {} },
          read: { kind: "impact", entityId: "enemy", atTimeMs: 0, stateRevision: 1 },
        },
        {
          attempted: 10,
          prevented: 0,
          absorbed: 0,
          applied: 5,
          overkill: 5,
          targetHealthAfter: 0,
          killed: true,
        },
      ),
    ).toThrow(/requested packet and target state/);
  });
});
