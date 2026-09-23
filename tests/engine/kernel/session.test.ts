import { expect, test } from "bun:test";
import {
  assertResumeCompatible,
  PolicyVisibleStateSchema,
  type EngineCommand,
  type PolicyVisibleState,
} from "../../../src/domain/contracts";
import { createMockPorts } from "../../contracts/mock-ports";
import {
  HASH_A,
  sampleResolvedScenario,
  sampleRunningRun,
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
