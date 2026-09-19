import type {
  CombatResult,
  DamagePacket,
  DamageResolution,
  EngineCommand,
  EngineEvent,
  EngineStepResult,
  EngineSnapshot,
  EntityState,
  ExactComparisonTransfer,
  ItemInstance,
  PolicyVisibleState,
  ResolvedScenario,
  RunManifest,
  ScheduledEvent,
  StepBudget,
  TargetSelector,
  Trace,
  TraceEvent,
} from "./schemas";

/**
 * Port calls are synchronous and deterministic from the engine's point of
 * view. Implementations may be backed by a worker or a database adapter, but
 * wall-clock reads and network calls stay outside combat decisions.
 */
export type PortContext = Readonly<{
  runId: string;
  timeMs: number;
  sequence: number;
  causeEventIds: readonly string[];
}>;

export type StateRead = Readonly<{
  kind: "snapshot" | "impact";
  entityId: string;
  atTimeMs: number;
  stateRevision: number;
}>;

export type StatsSnapshot = Readonly<{
  entityId: string;
  revision: number;
  values: Readonly<Record<string, number>>;
}>;

export type StatsRequest = Readonly<{
  entity: EntityState;
  read: StateRead;
}>;

export interface StatsPort {
  resolve(request: StatsRequest, context: PortContext): StatsSnapshot;
}

export type DamageRequest = Readonly<{
  packet: DamagePacket;
  attacker: EntityState;
  target: EntityState;
  attackerStats: StatsSnapshot;
  targetStats: StatsSnapshot;
  read: StateRead;
}>;

export interface DamagePort {
  resolve(request: DamageRequest, context: PortContext): DamageResolution;
}

export type ResourceMutation = Readonly<{
  entityId: string;
  resourceId: string;
  delta: number;
  reason: string;
}>;

export type ResourceResolution = Readonly<{
  accepted: boolean;
  entityId: string;
  resourceId: string;
  previous: number;
  current: number;
  reason: string | null;
}>;

export interface ResourcePort {
  apply(mutation: ResourceMutation, context: PortContext): ResourceResolution;
}

export type TimerSchedule = Readonly<{
  event: ScheduledEvent;
  replacesEventId: string | null;
}>;

export interface TimerPort {
  schedule(request: TimerSchedule, context: PortContext): void;
  cancel(eventId: string, context: PortContext): boolean;
  peek(context: PortContext): ScheduledEvent | null;
}

export type MovementRequest = Readonly<{
  entity: EntityState;
  destination: Readonly<{ x: number; y: number; z: number }>;
  read: StateRead;
}>;

export type MovementResolution = Readonly<{
  entityId: string;
  accepted: boolean;
  position: Readonly<{ x: number; y: number; z: number }>;
  reason: string | null;
}>;

export interface MovementPort {
  move(request: MovementRequest, context: PortContext): MovementResolution;
}

export type TargetingRequest = Readonly<{
  actor: EntityState;
  selector: TargetSelector;
  visibleState: PolicyVisibleState;
}>;

export type TargetingResolution = Readonly<{
  targetEntityIds: readonly string[];
  rejected: boolean;
  reason: string | null;
}>;

export interface TargetingPort {
  select(request: TargetingRequest, context: PortContext): TargetingResolution;
}

export type LifecycleTransition = Readonly<{
  entityId: string;
  transition: "spawn" | "despawn" | "death" | "revive" | "transform";
  replacement: EntityState | null;
}>;

export type LifecycleResolution = Readonly<{
  accepted: boolean;
  entityId: string;
  transition: LifecycleTransition["transition"];
  state: EntityState | null;
  reason: string | null;
}>;

export interface LifecyclePort {
  apply(transition: LifecycleTransition, context: PortContext): LifecycleResolution;
}

export type TriggerDispatch = Readonly<{
  triggerId: string;
  ownerEntityId: string;
  event: EngineEvent;
}>;

export type TriggerDispatchResult = Readonly<{
  accepted: boolean;
  emittedCommands: readonly EngineCommand[];
  reason: string | null;
}>;

export interface TriggerPort {
  dispatch(request: TriggerDispatch, context: PortContext): TriggerDispatchResult;
}

export type RngRequest = Readonly<{
  streamId: string;
  draws: number;
}>;

export type RngResult = Readonly<{
  streamId: string;
  values: readonly number[];
  nextDrawCount: number;
}>;

export interface RngPort {
  draw(request: RngRequest, context: PortContext): RngResult;
}

export interface TracePort {
  record(event: TraceEvent, context: PortContext): void;
  snapshot(runId: string): Trace;
}

export type CombatKernelPorts = Readonly<{
  stats: StatsPort;
  damage: DamagePort;
  resources: ResourcePort;
  timers: TimerPort;
  movement: MovementPort;
  targeting: TargetingPort;
  lifecycle: LifecyclePort;
  triggers: TriggerPort;
  rng: RngPort;
  trace: TracePort;
}>;

export type EngineInput = Readonly<{
  scenario: ResolvedScenario;
  run: RunManifest;
  ports: CombatKernelPorts;
}>;

export interface EngineSession {
  /** Advances a bounded number of events without consulting wall-clock time. */
  step(budget: StepBudget): EngineStepResult;
  snapshot(): EngineSnapshot;
  /** Only this filtered view is exposed to action policies. */
  policyView(): PolicyVisibleState;
}

export type EngineRun = Readonly<{
  status: "complete" | "cancelled" | "invalid";
  result: CombatResult;
  trace: Trace;
}>;

export interface CombatEngine {
  createSession(input: EngineInput): EngineSession;
  resumeSession(input: EngineInput, snapshot: EngineSnapshot): EngineSession;
  /** Synchronous convenience entry point over the same session semantics. */
  run(input: EngineInput): EngineRun;
}

export interface LegacySimulationAdapter<LegacyInput, LegacyOutput> {
  readonly adapterId: string;
  readonly revision: number;
  toScenario(input: LegacyInput): import("./schemas").ScenarioSpec;
  fromResult(result: CombatResult): LegacyOutput;
}

export type SerializablePortValue =
  | EntityState
  | ItemInstance
  | DamageResolution
  | EngineCommand
  | EngineEvent
  | EngineSnapshot
  | EngineStepResult
  | ExactComparisonTransfer;

export type { WorkerMessage } from "./schemas";
