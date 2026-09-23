import {
  EventQueueSnapshotSchema,
  ScheduledEventSchema,
  type ScheduledEvent,
} from "../../contracts";

export type EventDraft = Omit<ScheduledEvent, "sequence">;
export type QueueCommand =
  { kind: "schedule"; event: EventDraft } | { kind: "cancel"; eventId: string };
export type QueueStep = Readonly<{
  status: "progress" | "empty" | "event-limit";
  processed: readonly ScheduledEvent[];
  currentTimeMs: number;
}>;

/** P04 queue primitive. One integer time unit is one millisecond. */
export class EventQueue {
  private entries: ScheduledEvent[];
  private clockMs: number;
  private lastProcessedSequence: number;
  private currentTimeSequence: number;
  private nextSequence: number;
  private readonly allocatedIds: Set<string>;

  constructor(
    currentTimeMs = 0,
    private readonly eventLimit = 100_000,
    snapshot?: unknown,
  ) {
    if (!Number.isSafeInteger(currentTimeMs) || currentTimeMs < 0)
      throw new RangeError("current time must be a nonnegative integer millisecond");
    if (!Number.isSafeInteger(eventLimit) || eventLimit < 1)
      throw new RangeError("event limit must be a positive integer");
    const parsed = snapshot === undefined ? null : EventQueueSnapshotSchema.parse(snapshot);
    this.clockMs = currentTimeMs;
    this.entries = parsed ? structuredClone(parsed.entries) : [];
    this.lastProcessedSequence = parsed?.lastProcessedSequence ?? 0;
    this.currentTimeSequence = parsed?.currentTimeSequence ?? 0;
    this.nextSequence = parsed?.nextSequence ?? 1;
    this.allocatedIds = new Set(this.entries.map((entry) => entry.eventId));
    if (
      this.entries.some(
        (entry) =>
          entry.timeMs < currentTimeMs ||
          (entry.timeMs === currentTimeMs && entry.sequence <= this.currentTimeSequence),
      )
    )
      throw new RangeError("restored queue contains an event behind the current frontier");
  }

  get currentTimeMs(): number {
    return this.clockMs;
  }

  /** A batch receives canonical ties, independent of its caller's insertion order. */
  scheduleBatch(
    drafts: readonly EventDraft[],
    phaseOrder: readonly ScheduledEvent["phase"][],
  ): readonly ScheduledEvent[] {
    const rank = new Map(phaseOrder.map((phase, index) => [phase, index]));
    if (rank.size !== phaseOrder.length || rank.size !== 7)
      throw new TypeError("phase policy must rank all seven phases exactly once");
    const ordered = [...drafts].sort(
      (a, b) =>
        a.timeMs - b.timeMs ||
        rank.get(a.phase)! - rank.get(b.phase)! ||
        (a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0),
    );
    if (new Set(ordered.map((event) => event.eventId)).size !== ordered.length)
      throw new TypeError("batch event IDs must be unique");
    if (ordered.some((event) => this.allocatedIds.has(event.eventId)))
      throw new TypeError("event ID was already allocated");
    if (ordered.some((event) => event.timeMs < this.clockMs))
      throw new RangeError("cannot schedule into the past");
    if (!Number.isSafeInteger(this.nextSequence + ordered.length))
      throw new RangeError("event sequence exhausted");
    for (const [index, event] of ordered.entries())
      ScheduledEventSchema.parse({ ...event, sequence: this.nextSequence + index });
    return ordered.map((event) => this.schedule(event));
  }

  schedule(draft: EventDraft): ScheduledEvent {
    if (this.allocatedIds.has(draft.eventId)) throw new TypeError("event ID was already allocated");
    if (draft.timeMs < this.clockMs) throw new RangeError("cannot schedule into the past");
    if (!Number.isSafeInteger(this.nextSequence + 1))
      throw new RangeError("event sequence exhausted");
    const event = ScheduledEventSchema.parse({ ...draft, sequence: this.nextSequence });
    this.nextSequence += 1;
    this.allocatedIds.add(event.eventId);
    this.entries.push(event);
    this.entries.sort((a, b) => a.timeMs - b.timeMs || a.sequence - b.sequence);
    return structuredClone(event);
  }

  cancel(eventId: string): boolean {
    const index = this.entries.findIndex((event) => event.eventId === eventId);
    if (index < 0) return false;
    this.entries.splice(index, 1);
    return true;
  }

  peek(): ScheduledEvent | null {
    return this.entries[0] ? structuredClone(this.entries[0]) : null;
  }

  /** The callback receives a copy and may only affect the queue through returned commands. */
  step(
    maxEvents: number,
    untilTimeMs: number | null,
    dispatch: (event: Readonly<ScheduledEvent>) => readonly QueueCommand[],
  ): QueueStep {
    if (!Number.isSafeInteger(maxEvents) || maxEvents < 1)
      throw new RangeError("step budget must be positive");
    if (untilTimeMs !== null && (!Number.isSafeInteger(untilTimeMs) || untilTimeMs < this.clockMs))
      throw new RangeError("step time bound cannot precede the current time");
    const processed: ScheduledEvent[] = [];
    while (
      processed.length < maxEvents &&
      this.entries.length > 0 &&
      (untilTimeMs === null || this.entries[0]!.timeMs <= untilTimeMs)
    ) {
      // The persisted allocation frontier is a conservative, resume-stable work limit.
      // Cancelled allocations consume budget rather than permitting more work after resume.
      if (this.lastProcessedSequence >= this.eventLimit)
        return { status: "event-limit", processed, currentTimeMs: this.clockMs };
      const event = this.entries.shift()!;
      this.clockMs = event.timeMs;
      this.lastProcessedSequence = Math.max(this.lastProcessedSequence, event.sequence);
      this.currentTimeSequence = event.sequence;
      processed.push(structuredClone(event));
      for (const command of dispatch(structuredClone(event))) {
        if (command.kind === "cancel") this.cancel(command.eventId);
        else {
          if (!command.event.causeEventIds.includes(event.eventId))
            throw new TypeError("scheduled descendants must cite the dispatching event");
          this.schedule(command.event);
        }
      }
    }
    return {
      status: this.entries.length === 0 ? "empty" : "progress",
      processed,
      currentTimeMs: this.clockMs,
    };
  }

  snapshot() {
    return EventQueueSnapshotSchema.parse({
      lastProcessedSequence: this.lastProcessedSequence,
      currentTimeSequence: this.currentTimeSequence,
      nextSequence: this.nextSequence,
      entries: structuredClone(this.entries),
    });
  }
}
