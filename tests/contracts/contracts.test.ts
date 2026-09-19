import { describe, expect, test } from "bun:test";
import {
  ActionPolicySchema,
  CombatResultSchema,
  ContractValidationError,
  EngineCommandSchema,
  EngineEventSchema,
  EngineSnapshotSchema,
  EntityStateSchema,
  ExactComparisonTransferSchema,
  ItemInstanceSchema,
  ResolvedScenarioSchema,
  RunManifestSchema,
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

  test("uses tagged censored metrics instead of JSON Infinity or NaN", () => {
    const json = JSON.stringify(censoredResult);
    expect(json).not.toContain("Infinity");
    expect(json).not.toContain("NaN");
    expect(parseContract(CombatResultSchema, JSON.parse(json))).toEqual(censoredResult);
    expect(censoredResult.metrics.ttk).toEqual({ status: "censored", horizonMs: 5000 });
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
        status: "progress",
        snapshot: sampleSnapshot,
        emittedEvents: [],
        result: null,
        reason: null,
      },
    });
    expect(message.schemaVersion).toBe(1);
    if (message.direction !== "step") throw new Error("fixture message should be a step");
    expect(message.payload.snapshot.runId).toBe(sampleRun.runId);
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
});
