import type {
  CombatKernelPorts,
  LifecycleTransition,
  PortContext,
  TargetingRequest,
  TraceEvent,
} from "../../src/domain/contracts";

/** A deterministic, side-effect-free port set for contract consumers. */
export function createMockPorts(): CombatKernelPorts {
  const eventsByRunId = new Map<string, TraceEvent[]>();
  const scheduledByRunId = new Map<
    string,
    Map<string, import("../../src/domain/contracts").ScheduledEvent>
  >();
  const resourceValues = new Map<string, number>();
  const rngDrawCounts = new Map<string, number>();
  const timersFor = (runId: string) => {
    const existing = scheduledByRunId.get(runId);
    if (existing) return existing;
    const created = new Map<string, import("../../src/domain/contracts").ScheduledEvent>();
    scheduledByRunId.set(runId, created);
    return created;
  };

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
      apply: (mutation, context) => {
        const key = `${context.runId}\u0000${mutation.entityId}\u0000${mutation.resourceId}`;
        const previous = resourceValues.get(key) ?? 100;
        const current = Math.max(0, previous + mutation.delta);
        resourceValues.set(key, current);
        return {
          accepted: true,
          entityId: mutation.entityId,
          resourceId: mutation.resourceId,
          previous,
          current,
          reason: null,
        };
      },
    },
    timers: {
      schedule: ({ event, replacesEventId }, context) => {
        const scheduled = timersFor(context.runId);
        if (replacesEventId !== null) scheduled.delete(replacesEventId);
        scheduled.set(event.eventId, event);
      },
      cancel: (eventId, context) => timersFor(context.runId).delete(eventId),
      peek: (context) =>
        [...timersFor(context.runId).values()].sort(
          (left, right) => left.timeMs - right.timeMs || left.sequence - right.sequence,
        )[0] ?? null,
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
      select: (request: TargetingRequest) => {
        const enemies = request.visibleState.entities.filter((entity) => entity.team === "enemy");
        const targetEntityIds =
          request.selector.kind === "entity"
            ? [request.selector.entityId]
            : request.selector.kind === "self"
              ? [request.selector.actorId]
              : request.selector.kind === "lowest-health-visible-enemy"
                ? enemies
                    .sort(
                      (left, right) =>
                        left.health.current / left.health.maximum -
                          right.health.current / right.health.maximum ||
                        left.entityId.localeCompare(right.entityId),
                    )
                    .slice(0, 1)
                    .map((entity) => entity.entityId)
                : enemies.map((entity) => entity.entityId);
        return { targetEntityIds, rejected: false, reason: null };
      },
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
      draw: ({ streamId, draws }, context) => {
        const key = `${context.runId}\u0000${streamId}`;
        const nextDrawCount = (rngDrawCounts.get(key) ?? 0) + draws;
        rngDrawCounts.set(key, nextDrawCount);
        return {
          streamId,
          values: Array.from({ length: draws }, () => 0.5),
          nextDrawCount,
        };
      },
    },
    trace: {
      record: (event, context) => {
        const events = eventsByRunId.get(context.runId) ?? [];
        events.push(event);
        eventsByRunId.set(context.runId, events);
      },
      snapshot: (runId) => ({
        schemaVersion: 1,
        traceId: `trace-${runId}`,
        runId,
        events: [...(eventsByRunId.get(runId) ?? [])],
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
