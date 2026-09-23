import {
  EngineCommandSchema,
  EngineSnapshotSchema,
  EngineStepResultSchema,
  PolicyVisibleStateSchema,
  StepBudgetSchema,
  type EngineCommand,
  type EngineEvent,
  type EngineSession,
  type EngineSnapshot,
  type EngineStepResult,
  type PolicyVisibleState,
  type PortContext,
  type ScheduledEvent,
  type StepBudget,
  type TraceEvent,
  type ValidatedResume,
} from "../../contracts";
import { EventQueue, type QueueCommand } from "./event-queue";
import { EntityRegistry } from "./entities";

export class KernelWorkLimitError extends Error {
  constructor() {
    super("kernel event allocation limit reached; no combat score is available");
  }
}

export type KernelDispatcher = (
  event: Readonly<ScheduledEvent>,
  context: PortContext,
) => readonly EngineCommand[];
export type PolicyViewAdapter = (snapshot: Readonly<EngineSnapshot>) => PolicyVisibleState;

/** Resume-only P01 session slice. Policy and mechanic handlers are injected shared services. */
export class IncrementalKernelSession implements EngineSession {
  private state: EngineSnapshot;
  private queue: EventQueue;
  private entities: EntityRegistry;

  constructor(
    resume: ValidatedResume,
    private readonly dispatch: KernelDispatcher,
    private readonly view: PolicyViewAdapter,
    private readonly eventLimit = 100_000,
  ) {
    this.state = structuredClone(EngineSnapshotSchema.parse(resume.snapshot));
    this.queue = new EventQueue(
      this.state.currentTimeMs,
      eventLimit,
      this.state.queue,
      this.state.allocatedEventIds,
    );
    this.entities = new EntityRegistry(this.state.entities);
  }

  snapshot(): EngineSnapshot {
    return structuredClone(EngineSnapshotSchema.parse(this.state));
  }

  policyView(): PolicyVisibleState {
    const value = PolicyVisibleStateSchema.parse(this.view(this.snapshot()));
    if (value.atTimeMs !== this.state.currentTimeMs)
      throw new TypeError("policy view must match the session clock");
    return value;
  }

  step(rawBudget: StepBudget): EngineStepResult {
    const budget = StepBudgetSchema.parse(rawBudget);
    const traceEvents: TraceEvent[] = [];
    const emittedEvents: EngineEvent[] = [];
    const cancelledIds = new Set<string>();
    const workingQueue = new EventQueue(
      this.state.currentTimeMs,
      this.eventLimit,
      this.queue.snapshot(),
      this.queue.allocatedEventIds(),
    );
    const step = workingQueue.step(budget.maxEvents, budget.untilTimeMs, (event) => {
      const context: PortContext = {
        runId: this.state.runId,
        timeMs: event.timeMs,
        sequence: event.sequence,
        causeEventIds: event.causeEventIds,
        nextEventSequence: workingQueue.nextEventSequence,
        allocatedEventIds: workingQueue.allocatedEventIds(),
      };
      const commands = this.dispatch(event, context).map((command) =>
        EngineCommandSchema.parse(command),
      );
      if (commands.some((command) => command.issuedAtMs !== event.timeMs))
        throw new TypeError("commands must be issued at the processed event time");
      const traces = commands.filter((command) => command.kind === "trace");
      if (traces.length !== 1)
        throw new TypeError("each processed event requires one trace command");
      const trace = traces[0]!.event;
      if (
        trace.eventId !== event.eventId ||
        trace.sequence !== event.sequence ||
        trace.timeMs !== event.timeMs ||
        trace.phase !== event.phase ||
        JSON.stringify(trace.causeEventIds) !== JSON.stringify(event.causeEventIds)
      )
        throw new TypeError("trace command must preserve the processed event identity");
      const scheduled = commands.filter((command) => command.kind === "schedule-event");
      if (scheduled.length > 1)
        throw new TypeError("multiple scheduled descendants require a future batch adapter");
      if (scheduled[0] && scheduled[0].event.sequence !== workingQueue.nextEventSequence)
        throw new TypeError("scheduled command sequence must match the allocation frontier");
      const queueCommands: QueueCommand[] = [];
      for (const command of commands) {
        if (command.kind === "apply-damage")
          throw new TypeError("damage command requires the P05 damage service");
        if (command.kind === "cancel-event") {
          queueCommands.push({ kind: "cancel", eventId: command.eventId });
          cancelledIds.add(command.eventId);
        }
        if (command.kind === "schedule-event") {
          if (!command.event.causeEventIds.includes(event.eventId))
            throw new TypeError("scheduled event must cite the processed event");
          const nested = command.event;
          queueCommands.push({
            kind: "schedule",
            event: {
              eventId: nested.eventId,
              timeMs: nested.timeMs,
              phase: nested.phase,
              kind: nested.kind,
              payload: nested.payload,
              causeEventIds: nested.causeEventIds,
            },
          });
        }
      }
      traceEvents.push(structuredClone(trace));
      emittedEvents.push({
        schemaVersion: 1,
        eventId: event.eventId,
        timeMs: event.timeMs,
        sequence: event.sequence,
        phase: event.phase,
        kind: trace.kind,
        actorEntityId: trace.actorEntityId,
        targetEntityIds: trace.targetEntityIds,
        causeEventIds: event.causeEventIds,
        payload: event.payload,
      });
      return queueCommands;
    });
    // A batch is atomic at the session boundary. The queue and trace are only
    // committed after the entire bounded step has passed contract validation.
    if (step.status === "event-limit") throw new KernelWorkLimitError();
    const nextState = EngineSnapshotSchema.parse({
      ...this.state,
      currentTimeMs: workingQueue.currentTimeMs,
      queue: workingQueue.snapshot(),
      entities: this.entities.active(),
      allocatedEventIds: workingQueue.allocatedEventIds(),
      trace: { ...this.state.trace, events: [...this.state.trace.events, ...traceEvents] },
      pendingActions: this.state.pendingActions.map((pending) =>
        pending.continuationEventId !== null &&
        (emittedEvents.some((entry) => entry.eventId === pending.continuationEventId) ||
          cancelledIds.has(pending.continuationEventId))
          ? {
              ...pending,
              continuationEventId: null,
              state: cancelledIds.has(pending.continuationEventId) ? "interrupted" : "complete",
            }
          : pending,
      ),
      status: "running",
      resumability: "resumable",
      result: null,
      interruption: {
        state: "budget-exhausted",
        reason:
          step.status === "empty"
            ? "kernel awaits objective evaluation"
            : "step event budget exhausted",
      },
    });
    const result = EngineStepResultSchema.parse({
      schemaVersion: 1,
      status: "progress",
      snapshot: nextState,
      emittedEvents,
      result: null,
      reason: nextState.interruption.reason,
    });
    this.queue = workingQueue;
    this.state = nextState;
    return result;
  }
}
