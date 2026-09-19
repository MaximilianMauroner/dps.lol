import type {
  CombatKernelPorts,
  LifecycleTransition,
  PortContext,
  TargetingRequest,
  TraceEvent,
} from "../../src/domain/contracts";

/** A deterministic, side-effect-free port set for contract consumers. */
export function createMockPorts(): CombatKernelPorts {
  const events: TraceEvent[] = [];
  const scheduled = new Map<string, import("../../src/domain/contracts").ScheduledEvent>();

  return {
    stats: {
      resolve: ({ entity }) => ({
        entityId: entity.entityId,
        revision: 1,
        values: { ...entity.stats },
      }),
    },
    damage: {
      resolve: ({ packet, target }) => {
        const attempted = packet.rawAmount;
        const applied = Math.min(attempted, target.health.current);
        return {
          attempted,
          absorbed: 0,
          prevented: 0,
          applied,
          overkill: attempted - applied,
          targetHealthAfter: target.health.current - applied,
          killed: target.health.current - applied <= 0,
        };
      },
    },
    resources: {
      apply: (mutation) => ({
        accepted: true,
        entityId: mutation.entityId,
        resourceId: mutation.resourceId,
        previous: 100,
        current: Math.max(0, 100 + mutation.delta),
        reason: null,
      }),
    },
    timers: {
      schedule: ({ event }) => {
        scheduled.set(event.eventId, event);
      },
      cancel: (eventId) => scheduled.delete(eventId),
      peek: () =>
        [...scheduled.values()].sort((left, right) => left.sequence - right.sequence)[0] ?? null,
    },
    movement: {
      move: ({ entity, destination }) => ({
        entityId: entity.entityId,
        accepted: true,
        position: destination,
        reason: null,
      }),
    },
    targeting: {
      select: (request: TargetingRequest) => ({
        targetEntityIds:
          request.selector.kind === "entity"
            ? [request.selector.entityId]
            : request.selector.kind === "self"
              ? [request.selector.actorId]
              : request.visibleState.entities
                  .filter((entity) => entity.team === "enemy")
                  .map((entity) => entity.entityId),
        rejected: false,
        reason: null,
      }),
    },
    lifecycle: {
      apply: (transition: LifecycleTransition) => ({
        accepted: true,
        entityId: transition.entityId,
        transition: transition.transition,
        state: transition.replacement,
        reason: null,
      }),
    },
    triggers: {
      dispatch: () => ({ accepted: true, emittedCommands: [], reason: null }),
    },
    rng: {
      draw: ({ streamId, draws }) => ({
        streamId,
        values: Array.from({ length: draws }, () => 0.5),
        nextDrawCount: draws,
      }),
    },
    trace: {
      record: (event) => events.push(event),
      snapshot: (runId) => ({
        schemaVersion: 1,
        traceId: `trace-${runId}`,
        runId,
        events: [...events],
        truncated: false,
        truncationReason: null,
      }),
    },
  };
}

export const mockPortContext: PortContext = {
  runId: "run-001",
  timeMs: 0,
  sequence: 1,
  causeEventIds: [],
};
