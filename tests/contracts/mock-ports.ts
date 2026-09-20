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
      resolve: ({ entity, read }) => ({
        entityId: entity.entityId,
        revision: read.stateRevision,
        values: { ...entity.stats },
      }),
    },
    damage: {
      resolve: ({ packet, target }) => {
        const attempted = packet.rawAmount;
        const absorbed = Math.min(attempted, target.health.shield);
        const afterShield = attempted - absorbed;
        const applied = Math.min(afterShield, target.health.current);
        return {
          attempted,
          absorbed,
          prevented: 0,
          applied,
          overkill: afterShield - applied,
          targetHealthAfter: target.health.current - applied,
          killed: target.health.current - applied <= 0,
        };
      },
    },
    resources: {
      restore: (entity, context) => {
        for (const resource of entity.resources) {
          resourceValues.set(
            `${context.runId}\u0000${entity.entityId}\u0000${resource.resourceId}`,
            resource.current,
          );
        }
      },
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
        const enemies = request.visibleState.entities.filter(
          (entity) => entity.team === "enemy" && entity.alive,
        );
        const targetEntityIds =
          request.selector.kind === "entity"
            ? [request.selector.entityId]
            : request.selector.kind === "self"
              ? [request.selector.actorId]
              : request.selector.kind === "lowest-health-visible-enemy"
                ? enemies
                    .sort((left, right) => {
                      const healthDifference =
                        left.health.current / left.health.maximum -
                        right.health.current / right.health.maximum;
                      if (healthDifference !== 0) return healthDifference;
                      return left.entityId < right.entityId
                        ? -1
                        : left.entityId > right.entityId
                          ? 1
                          : 0;
                    })
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
      restore: (snapshot, context) => {
        rngDrawCounts.set(`${context.runId}\u0000${snapshot.streamId}`, snapshot.drawCount);
      },
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
