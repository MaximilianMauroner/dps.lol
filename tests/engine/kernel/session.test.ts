import { expect, test } from "bun:test";
import {
  assertResumeCompatible,
  EngineSnapshotSchema,
  PolicyVisibleStateSchema,
  RunManifestSchema,
  type EngineCommand,
  type PolicyVisibleState,
  type ScheduledEvent,
} from "../../../src/domain/contracts";
import { createMockPorts } from "../../contracts/mock-ports";
import {
  HASH_A,
  sampleResolvedScenario,
  sampleRunningRun,
  sampleRun,
  sampleSnapshot,
} from "../../contracts/fixtures";
import { IncrementalKernelSession } from "../../../src/domain/engine/kernel/session";

function resume(snapshot = sampleSnapshot) {
  return assertResumeCompatible(
    { scenario: sampleResolvedScenario, run: sampleRunningRun, ports: createMockPorts() },
    snapshot,
    HASH_A,
  );
}

const view = (snapshot: typeof sampleSnapshot): PolicyVisibleState =>
  PolicyVisibleStateSchema.parse({
    schemaVersion: 1,
    atTimeMs: snapshot.currentTimeMs,
    actorEntityId: "actor",
    visibility: sampleResolvedScenario.effective.policy.visibility,
    entities: snapshot.entities.map((entity) => ({
      entityId: entity.entityId,
      team: entity.team,
      kind: entity.kind,
      alive: entity.alive,
      health: entity.health,
      resources: entity.resources.map((resource) => ({
        resourceId: resource.resourceId,
        current: resource.current,
        maximum: resource.maximum,
      })),
      visibleAbilityIds: entity.abilities.map((ability) => ability.abilityId),
      buffs: entity.buffs.map((buff) => ({
        buffId: buff.buffId,
        stacks: buff.stacks,
        expiresAtMs: buff.expiresAtMs,
      })),
      position: entity.position,
    })),
    readiness: snapshot.entities.flatMap((entity) =>
      entity.abilities.map((ability) => ({
        entityId: entity.entityId,
        abilityId: ability.abilityId,
        ready: true,
        cooldownRemainingMs: 0,
      })),
    ),
    visibleResourceIds: [
      ...new Set(
        snapshot.entities.flatMap((entity) =>
          entity.resources.map((resource) => resource.resourceId),
        ),
      ),
    ],
  });

function traceCommand(event: (typeof sampleSnapshot.queue.entries)[number]): EngineCommand {
  return {
    schemaVersion: 1,
    kind: "trace",
    commandId: `trace-${event.eventId}`,
    issuedAtMs: event.timeMs,
    causeEventIds: event.causeEventIds,
    event: {
      eventId: event.eventId,
      sequence: event.sequence,
      timeMs: event.timeMs,
      phase: event.phase,
      kind: "checkpoint",
      actorEntityId: "actor",
      targetEntityIds: ["enemy"],
      causeEventIds: event.causeEventIds,
      effects: [],
      stateDigest: null,
    },
  };
}

function lifecycleTrace(
  event: ScheduledEvent,
  entityId: string,
  transition: "death" | "revive" | "transform",
): EngineCommand {
  const base = traceCommand(event);
  if (base.kind !== "trace") throw new Error("fixture must produce a trace");
  return {
    ...base,
    event: {
      ...base.event,
      kind: "lifecycle",
      targetEntityIds: [entityId],
      effects: [{ kind: "lifecycle", entityId, transition }],
    },
  };
}

function deathCheckpoint() {
  const enemy = sampleSnapshot.entities.find((entity) => entity.entityId === "enemy")!;
  const deadEnemy = {
    ...enemy,
    alive: false,
    health: { ...enemy.health, current: 0, shield: 0 },
  };
  return EngineSnapshotSchema.parse({
    ...sampleSnapshot,
    queue: {
      ...sampleSnapshot.queue,
      entries: [
        {
          ...sampleSnapshot.queue.entries[0]!,
          phase: "lifecycle",
          kind: "lifecycle-transition",
          payload: { entityId: "enemy", transition: "death", replacement: deadEnemy },
        },
      ],
    },
  });
}

test("P01 session processes a future tick only at its timestamp and retains a resumable checkpoint", () => {
  const session = new IncrementalKernelSession(resume(), (event) => [traceCommand(event)], view);
  expect(session.snapshot().currentTimeMs).toBe(100);
  expect(session.policyView().atTimeMs).toBe(100);
  const before = session.step({ maxEvents: 1, untilTimeMs: 999 });
  expect(before.emittedEvents).toHaveLength(0);
  expect(before.snapshot.currentTimeMs).toBe(100);
  const after = session.step({ maxEvents: 1, untilTimeMs: 1000 });
  expect(after.emittedEvents.map((event) => event.eventId)).toEqual(["event-003"]);
  expect(after.snapshot.currentTimeMs).toBe(1000);
  expect(after.snapshot.pendingActions[0]?.state).toBe("complete");
  const restored = new IncrementalKernelSession(
    resume(after.snapshot),
    (event) => [traceCommand(event)],
    view,
  );
  expect(restored.snapshot()).toEqual(after.snapshot);
});

test("failed command dispatch leaves queue and snapshot unchanged", () => {
  const session = new IncrementalKernelSession(
    resume(),
    () => [
      {
        schemaVersion: 1,
        kind: "apply-damage",
        commandId: "unsupported",
        issuedAtMs: 1000,
        causeEventIds: ["event-002"],
        packet: {
          sourceEntityId: "actor",
          targetEntityId: "enemy",
          damageType: "physical",
          rawAmount: 10,
          tags: [],
          canOverkill: false,
        },
      },
    ],
    view,
  );
  const before = session.snapshot();
  expect(() => session.step({ maxEvents: 1, untilTimeMs: null })).toThrow("one trace command");
  expect(session.snapshot()).toEqual(before);
  expect(() => session.step({ maxEvents: 0, untilTimeMs: null })).toThrow();
});

test("service dispatch rejects missing, unrelated, and stripped causal provenance atomically", () => {
  const invalidCauses = [[], ["event-003", "unrelated"]];
  for (const causeEventIds of invalidCauses) {
    const session = new IncrementalKernelSession(
      resume(),
      (event) => [
        traceCommand(event),
        {
          schemaVersion: 1,
          kind: "cancel-event",
          commandId: "cancel-future",
          issuedAtMs: event.timeMs,
          causeEventIds,
          eventId: "future-event",
        },
      ],
      view,
    );
    const before = session.snapshot();
    expect(() => session.step({ maxEvents: 1, untilTimeMs: null })).toThrow(
      "service commands must cite only the processed event and its causes",
    );
    expect(session.snapshot()).toEqual(before);
  }

  const session = new IncrementalKernelSession(
    resume(),
    (event) => [{ ...traceCommand(event), causeEventIds: [] }],
    view,
  );
  const before = session.snapshot();
  expect(() => session.step({ maxEvents: 1, untilTimeMs: null })).toThrow(
    "trace command causes must match the processed event",
  );
  expect(session.snapshot()).toEqual(before);
  const restored = new IncrementalKernelSession(
    resume(before),
    (event) => [traceCommand(event)],
    view,
  );
  expect(restored.step({ maxEvents: 1, untilTimeMs: null }).emittedEvents[0]?.eventId).toBe(
    "event-003",
  );
});

test("session dispatch schedules a causal future event and replays it after resume", () => {
  const dispatch = (event: (typeof sampleSnapshot.queue.entries)[number]): EngineCommand[] =>
    event.eventId === "event-003"
      ? [
          traceCommand(event),
          {
            schemaVersion: 1,
            kind: "schedule-event",
            commandId: "schedule-004",
            issuedAtMs: 1000,
            causeEventIds: ["event-003"],
            event: {
              eventId: "event-004",
              sequence: 4,
              timeMs: 1500,
              phase: "periodic",
              kind: "future-tick",
              payload: null,
              causeEventIds: ["event-003"],
            },
          },
        ]
      : [traceCommand(event)];
  const session = new IncrementalKernelSession(resume(), dispatch, view);
  const first = session.step({ maxEvents: 1, untilTimeMs: null });
  expect(first.snapshot.queue.entries.map((event) => event.eventId)).toEqual(["event-004"]);
  expect(first.snapshot.allocatedEventIds).toContain("event-004");
  const restored = new IncrementalKernelSession(resume(first.snapshot), dispatch, view);
  const second = restored.step({ maxEvents: 1, untilTimeMs: null });
  expect(second.emittedEvents.map((event) => event.eventId)).toEqual(["event-004"]);
  expect(second.snapshot.trace.events.at(-1)?.causeEventIds).toEqual(["event-003"]);
});

test("session work limit fails before the next event and retains the checkpoint", () => {
  const session = new IncrementalKernelSession(resume(), (event) => [traceCommand(event)], view, 2);
  const before = session.snapshot();
  expect(() => session.step({ maxEvents: 1, untilTimeMs: null })).toThrow("no combat score");
  expect(session.snapshot()).toEqual(before);
});

test("session keeps entity revision counters from a validated checkpoint", () => {
  const checkpoint = EngineSnapshotSchema.parse({
    ...sampleSnapshot,
    stateRevisions: { actor: 7, enemy: 3 },
  });
  const session = new IncrementalKernelSession(
    resume(checkpoint),
    (event) => [traceCommand(event)],
    view,
  );
  expect(session.snapshot().stateRevisions).toEqual({ actor: 7, enemy: 3 });
  expect(session.step({ maxEvents: 1, untilTimeMs: null }).snapshot.stateRevisions).toEqual({
    actor: 7,
    enemy: 3,
  });
});

test("bounded batch matches checkpointed steps and rolls back when a later dispatch fails", () => {
  const dispatch = (event: (typeof sampleSnapshot.queue.entries)[number]): EngineCommand[] =>
    event.eventId === "event-003"
      ? [
          traceCommand(event),
          {
            schemaVersion: 1,
            kind: "schedule-event",
            commandId: "schedule-004",
            issuedAtMs: event.timeMs,
            causeEventIds: [event.eventId],
            event: {
              eventId: "event-004",
              sequence: 4,
              timeMs: 1500,
              phase: "periodic",
              kind: "future-tick",
              payload: null,
              causeEventIds: [event.eventId],
            },
          },
        ]
      : [traceCommand(event)];
  const batched = new IncrementalKernelSession(resume(), dispatch, view);
  const batch = batched.step({ maxEvents: 2, untilTimeMs: null });
  expect(batch.emittedEvents.map((event) => event.eventId)).toEqual(["event-003", "event-004"]);

  const first = new IncrementalKernelSession(resume(), dispatch, view).step({
    maxEvents: 1,
    untilTimeMs: null,
  });
  const resumed = new IncrementalKernelSession(resume(first.snapshot), dispatch, view);
  const second = resumed.step({ maxEvents: 1, untilTimeMs: null });
  expect(batch.snapshot).toEqual(second.snapshot);

  const failing = new IncrementalKernelSession(
    resume(),
    (event) => (event.eventId === "event-004" ? [] : dispatch(event)),
    view,
  );
  const before = failing.snapshot();
  expect(() => failing.step({ maxEvents: 2, untilTimeMs: null })).toThrow("one trace command");
  expect(failing.snapshot()).toEqual(before);
});

test("fresh session validates run identity, seeds a chronological queue, and resumes", () => {
  const plannedRun = RunManifestSchema.parse({
    ...sampleRun,
    status: "planned",
    completedAt: null,
  });
  const start = {
    input: {
      scenario: sampleResolvedScenario,
      run: plannedRun,
      ports: createMockPorts(),
    },
    expectedEngineHash: HASH_A,
  };
  const dispatch = (event: (typeof sampleSnapshot.queue.entries)[number]): EngineCommand[] =>
    event.eventId === plannedRun.runId
      ? [
          traceCommand(event),
          {
            schemaVersion: 1,
            kind: "schedule-event",
            commandId: "schedule-first-attack",
            issuedAtMs: 0,
            causeEventIds: [event.eventId],
            event: {
              eventId: "first-attack",
              sequence: 2,
              timeMs: 100,
              phase: "impact",
              kind: "attack",
              payload: null,
              causeEventIds: [event.eventId],
            },
          },
        ]
      : [traceCommand(event)];
  const session = new IncrementalKernelSession(start, dispatch, view);
  const initial = session.snapshot();
  expect(new IncrementalKernelSession(start, dispatch, view).snapshot()).toEqual(initial);
  expect(initial.currentTimeMs).toBe(0);
  expect(initial.entities).toEqual(sampleResolvedScenario.effective.entities);
  expect(initial.policyProgress.steps.every((step) => step.state === "not-started")).toBe(true);
  expect(initial.queue.entries.map((event) => event.eventId)).toEqual([plannedRun.runId]);
  const first = session.step({ maxEvents: 1, untilTimeMs: 0 });
  expect(first.emittedEvents.map((event) => event.eventId)).toEqual([plannedRun.runId]);
  expect(first.snapshot.queue.entries.map((event) => event.eventId)).toEqual(["first-attack"]);
  const resumed = new IncrementalKernelSession(
    assertResumeCompatible(
      { ...start.input, run: { ...plannedRun, status: "running" } },
      first.snapshot,
      HASH_A,
    ),
    dispatch,
    view,
  );
  expect(resumed.step({ maxEvents: 1, untilTimeMs: null }).emittedEvents[0]?.eventId).toBe(
    "first-attack",
  );
  expect(
    () =>
      new IncrementalKernelSession({ ...start, expectedEngineHash: "sha256:dead" }, () => [], view),
  ).toThrow();
});

test("dispatch cannot place a future effect beyond the objective horizon", () => {
  const session = new IncrementalKernelSession(
    resume(),
    (event) => [
      traceCommand(event),
      {
        schemaVersion: 1,
        kind: "schedule-event",
        commandId: "too-late",
        issuedAtMs: event.timeMs,
        causeEventIds: [event.eventId],
        event: {
          eventId: "outside-window",
          sequence: 4,
          timeMs: 5001,
          phase: "periodic",
          kind: "late-tick",
          payload: null,
          causeEventIds: [event.eventId],
        },
      },
    ],
    view,
  );
  const before = session.snapshot();
  expect(() => session.step({ maxEvents: 1, untilTimeMs: null })).toThrow("objective horizon");
  expect(session.snapshot()).toEqual(before);
});

test("expired buffs stop time advancement before dispatch without changing the checkpoint", () => {
  const dispatched: string[] = [];
  const session = new IncrementalKernelSession(
    resume(),
    (event) => {
      dispatched.push(event.eventId);
      return event.eventId === "event-003"
        ? [
            traceCommand(event),
            {
              schemaVersion: 1,
              kind: "schedule-event",
              commandId: "schedule-after-expiry",
              issuedAtMs: event.timeMs,
              causeEventIds: [event.eventId],
              event: {
                eventId: "event-004",
                sequence: 4,
                timeMs: 3001,
                phase: "checkpoint",
                kind: "later-checkpoint",
                payload: null,
                causeEventIds: [event.eventId],
              },
            },
          ]
        : [traceCommand(event)];
    },
    view,
  );
  const first = session.step({ maxEvents: 1, untilTimeMs: null });
  expect(first.snapshot.currentTimeMs).toBe(1000);
  const checkpoint = session.snapshot();
  expect(() => session.step({ maxEvents: 1, untilTimeMs: null })).toThrow(
    "expiry service must resolve it first",
  );
  expect(dispatched).toEqual(["event-003"]);
  expect(session.snapshot()).toEqual(checkpoint);
  const restored = new IncrementalKernelSession(
    resume(checkpoint),
    () => {
      throw new Error("expired event must never dispatch after resume");
    },
    view,
  );
  expect(() => restored.step({ maxEvents: 1, untilTimeMs: null })).toThrow(
    "expiry service must resolve it first",
  );
});

test("a buff remains valid at its exact expiry timestamp under P01 snapshot rules", () => {
  const session = new IncrementalKernelSession(
    resume(),
    (event) =>
      event.eventId === "event-003"
        ? [
            traceCommand(event),
            {
              schemaVersion: 1,
              kind: "schedule-event",
              commandId: "schedule-expiry-boundary",
              issuedAtMs: event.timeMs,
              causeEventIds: [event.eventId],
              event: {
                eventId: "event-004",
                sequence: 4,
                timeMs: 3000,
                phase: "expiry",
                kind: "expiry-boundary",
                payload: null,
                causeEventIds: [event.eventId],
              },
            },
          ]
        : [traceCommand(event)],
    view,
  );
  const step = session.step({ maxEvents: 2, untilTimeMs: null });
  expect(step.snapshot.currentTimeMs).toBe(3000);
  expect(step.emittedEvents.map((event) => event.eventId)).toEqual(["event-003", "event-004"]);
  expect(step.snapshot.buffs[0]?.expiresAtMs).toBe(3000);
});

test("a trace cannot claim damage before the damage service changes entity state", () => {
  const session = new IncrementalKernelSession(
    resume(),
    (event) => {
      const command = traceCommand(event);
      if (command.kind !== "trace") throw new Error("fixture must emit a trace");
      return [
        {
          ...command,
          event: {
            ...command.event,
            effects: [
              {
                kind: "damage",
                sourceEntityId: "actor",
                targetEntityId: "enemy",
                damageType: "physical",
                amount: 50,
                overkill: 0,
              },
            ],
          },
        },
      ];
    },
    view,
  );
  const before = session.snapshot();
  expect(() => session.step({ maxEvents: 1, untilTimeMs: null })).toThrow(
    "corresponding mechanic service",
  );
  expect(session.snapshot()).toEqual(before);
});

test("timer commands allocate canonical same-time descendants regardless of command order", () => {
  const descendants: Extract<EngineCommand, { kind: "schedule-event" }>[] = [
    {
      schemaVersion: 1,
      kind: "schedule-event",
      commandId: "schedule-expiry",
      issuedAtMs: 1000,
      causeEventIds: ["event-003"],
      event: {
        eventId: "expiry-child",
        sequence: 5,
        timeMs: 1500,
        phase: "expiry",
        kind: "buff-expiry",
        payload: null,
        causeEventIds: ["event-003"],
      },
    },
    {
      schemaVersion: 1,
      kind: "schedule-event",
      commandId: "schedule-impact",
      issuedAtMs: 1000,
      causeEventIds: ["event-003"],
      event: {
        eventId: "impact-child",
        sequence: 4,
        timeMs: 1500,
        phase: "impact",
        kind: "projectile-impact",
        payload: null,
        causeEventIds: ["event-003"],
      },
    },
  ];
  const dispatch = (event: (typeof sampleSnapshot.queue.entries)[number]): EngineCommand[] =>
    event.eventId === "event-003" ? [traceCommand(event), ...descendants] : [traceCommand(event)];
  const session = new IncrementalKernelSession(resume(), dispatch, view);
  const first = session.step({ maxEvents: 1, untilTimeMs: null });
  expect(first.snapshot.queue.entries.map((event) => event.eventId)).toEqual([
    "impact-child",
    "expiry-child",
  ]);
  const restored = new IncrementalKernelSession(resume(first.snapshot), dispatch, view);
  expect(
    restored.step({ maxEvents: 2, untilTimeMs: null }).emittedEvents.map((event) => event.eventId),
  ).toEqual(["impact-child", "expiry-child"]);

  const reversed = new IncrementalKernelSession(
    resume(),
    (event) => [traceCommand(event), ...[...descendants].reverse()],
    view,
  );
  expect(reversed.step({ maxEvents: 1, untilTimeMs: null }).snapshot).toEqual(first.snapshot);

  const invalid = new IncrementalKernelSession(
    resume(),
    (event) => [
      traceCommand(event),
      { ...descendants[0]!, event: { ...descendants[0]!.event, sequence: 4 } },
      descendants[1]!,
    ],
    view,
  );
  const before = invalid.snapshot();
  expect(() => invalid.step({ maxEvents: 1, untilTimeMs: null })).toThrow(
    "canonical allocation order",
  );
  expect(invalid.snapshot()).toEqual(before);
});

test("scheduled death waits for its timestamp and revival survives checkpoint resume", () => {
  const checkpoint = deathCheckpoint();
  const dispatch = (event: ScheduledEvent): EngineCommand[] => {
    if (event.kind !== "lifecycle-transition") return [traceCommand(event)];
    const transition = (event.payload as { transition: "death" | "revive" }).transition;
    const trace = lifecycleTrace(event, "enemy", transition);
    if (transition === "revive") return [trace];
    const enemy = checkpoint.entities.find((entity) => entity.entityId === "enemy")!;
    return [
      trace,
      {
        schemaVersion: 1,
        kind: "schedule-event",
        commandId: "schedule-revive",
        issuedAtMs: event.timeMs,
        causeEventIds: [event.eventId],
        event: {
          eventId: "event-004",
          sequence: 4,
          timeMs: 1500,
          phase: "lifecycle",
          kind: "lifecycle-transition",
          payload: {
            entityId: "enemy",
            transition: "revive",
            replacement: { ...enemy, health: { ...enemy.health, current: 100 } },
          },
          causeEventIds: [event.eventId],
        },
      },
    ];
  };
  const session = new IncrementalKernelSession(resume(checkpoint), dispatch, view);
  const before = session.step({ maxEvents: 1, untilTimeMs: 999 });
  expect(before.snapshot.entities.find((entity) => entity.entityId === "enemy")?.alive).toBe(true);
  const death = session.step({ maxEvents: 1, untilTimeMs: 1000 });
  expect(death.snapshot.entities.find((entity) => entity.entityId === "enemy")?.alive).toBe(false);
  expect(death.snapshot.stateRevisions.enemy).toBe(2);
  expect(death.snapshot.queue.entries[0]?.eventId).toBe("event-004");
  const restored = new IncrementalKernelSession(resume(death.snapshot), dispatch, view);
  expect(restored.policyView().entities.find((entity) => entity.entityId === "enemy")?.alive).toBe(
    false,
  );
  const revival = restored.step({ maxEvents: 1, untilTimeMs: 1500 });
  expect(
    revival.snapshot.entities.find((entity) => entity.entityId === "enemy")?.health.current,
  ).toBe(100);
  expect(revival.snapshot.stateRevisions.enemy).toBe(3);
  expect(revival.snapshot.trace.events.at(-1)?.effects).toEqual([
    { kind: "lifecycle", entityId: "enemy", transition: "revive" },
  ]);
});

test("invalid lifecycle trace or replacement rolls back the whole session step", () => {
  const checkpoint = deathCheckpoint();
  const wrongTrace = new IncrementalKernelSession(
    resume(checkpoint),
    (event) => [traceCommand(event)],
    view,
  );
  const initial = wrongTrace.snapshot();
  expect(() => wrongTrace.step({ maxEvents: 1, untilTimeMs: null })).toThrow("lifecycle trace");
  expect(wrongTrace.snapshot()).toEqual(initial);

  const bad = EngineSnapshotSchema.parse({
    ...checkpoint,
    queue: {
      ...checkpoint.queue,
      entries: checkpoint.queue.entries.map((event) => ({
        ...event,
        payload: {
          entityId: "enemy",
          transition: "death",
          replacement: checkpoint.entities.find((entity) => entity.entityId === "enemy"),
        },
      })),
    },
  });
  const invalid = new IncrementalKernelSession(
    resume(bad),
    (event) => [lifecycleTrace(event, "enemy", "death")],
    view,
  );
  const before = invalid.snapshot();
  expect(() => invalid.step({ maxEvents: 1, untilTimeMs: null })).toThrow("dead entity");
  expect(invalid.snapshot()).toEqual(before);

  const wrongPhase = EngineSnapshotSchema.parse({
    ...checkpoint,
    queue: {
      ...checkpoint.queue,
      entries: checkpoint.queue.entries.map((event) => ({ ...event, phase: "impact" })),
    },
  });
  const phaseSession = new IncrementalKernelSession(
    resume(wrongPhase),
    (event) => [lifecycleTrace(event, "enemy", "death")],
    view,
  );
  const phaseBefore = phaseSession.snapshot();
  expect(() => phaseSession.step({ maxEvents: 1, untilTimeMs: null })).toThrow("lifecycle phase");
  expect(phaseSession.snapshot()).toEqual(phaseBefore);
});

test("same-time lifecycle descendant failure rolls back an earlier death in the batch", () => {
  const checkpoint = deathCheckpoint();
  const enemy = checkpoint.entities.find((entity) => entity.entityId === "enemy")!;
  const dispatch = (event: ScheduledEvent): EngineCommand[] => {
    if (event.eventId === "event-004") return [traceCommand(event)];
    return [
      lifecycleTrace(event, "enemy", "death"),
      {
        schemaVersion: 1,
        kind: "schedule-event",
        commandId: "same-time-revive",
        issuedAtMs: event.timeMs,
        causeEventIds: [event.eventId],
        event: {
          eventId: "event-004",
          sequence: 4,
          timeMs: event.timeMs,
          phase: "lifecycle",
          kind: "lifecycle-transition",
          payload: { entityId: "enemy", transition: "revive", replacement: enemy },
          causeEventIds: [event.eventId],
        },
      },
    ];
  };
  const session = new IncrementalKernelSession(resume(checkpoint), dispatch, view);
  const before = session.snapshot();
  expect(() => session.step({ maxEvents: 2, untilTimeMs: null })).toThrow("lifecycle trace");
  expect(session.snapshot()).toEqual(before);
  const first = session.step({ maxEvents: 1, untilTimeMs: null });
  expect(first.snapshot.entities.find((entity) => entity.entityId === "enemy")?.alive).toBe(false);
  expect(first.snapshot.queue.entries[0]?.timeMs).toBe(1000);
  expect(first.snapshot.queue.entries[0]?.sequence).toBe(4);
});
