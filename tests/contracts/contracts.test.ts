import { describe, expect, test } from "bun:test";
import {
  ActionPolicySchema,
  assertResumableSnapshot,
  assertResumeCompatible,
  CombatResultSchema,
  ContractValidationError,
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
    expect(parseContract(EngineSnapshotSchema, cancelled).status).toBe("cancelled");
    expect(() => assertResumableSnapshot(cancelled)).toThrow(SnapshotNotResumableError);
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

    expect(() => canonicalJson({ executable: () => 1 })).toThrow(/function/);
    expect(() => canonicalJson({ nonfinite: Number.NaN })).toThrow(/non-finite/);
    expect(() => canonicalJson(new Map([["key", 1]]))).toThrow(/plain objects/);

    const schemaBoundaryExecutable = clone(visiblePolicyStateFixture());
    Object.defineProperty(schemaBoundaryExecutable, "executable", {
      value: () => 1,
      enumerable: true,
    });
    expect(() => parseContract(PolicyVisibleStateSchema, schemaBoundaryExecutable)).toThrow(
      /function/,
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

  test("rejects a run that collapses search context and candidate input identity", () => {
    const invalid = { ...sampleRun, candidateInputHash: sampleRun.searchContextHash };
    expect(() => parseContract(RunManifestSchema, invalid)).toThrow(/must remain distinct/);
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
});
