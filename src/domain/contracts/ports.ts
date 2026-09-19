import {
  assertResumableSnapshot,
  canonicalJson,
  parseContract,
  ResolvedScenarioSchema,
  RunManifestSchema,
  type CombatResult,
  type DamagePacket,
  type DamageResolution,
  type EngineCommand,
  type EngineEvent,
  type EngineStepResult,
  type EngineSnapshot,
  type EntityState,
  type ExactComparisonTransfer,
  type ItemInstance,
  type PolicyVisibleState,
  type ResolvedScenario,
  type RunManifest,
  type ScheduledEvent,
  type StepBudget,
  type TargetSelector,
  type Trace,
  type TraceEvent,
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

export class ResumeCompatibilityError extends Error {
  readonly mismatches: readonly string[];

  constructor(mismatches: readonly string[]) {
    super(`resume compatibility failed: ${mismatches.join("; ")}`);
    this.name = "ResumeCompatibilityError";
    this.mismatches = mismatches;
  }
}

/**
 * Validates the snapshot and all replay-affecting identities before a kernel
 * is allowed to resume it. Concrete engines must call this guard at their
 * resumeSession boundary.
 */
export function assertResumeCompatible(input: EngineInput, value: unknown): EngineSnapshot {
  const scenario = parseContract(ResolvedScenarioSchema, input.scenario);
  const run = parseContract(RunManifestSchema, input.run);
  const snapshot = assertResumableSnapshot(value);
  const mismatches: string[] = [];

  if (run.status !== "running") mismatches.push("run must be running to resume");
  if (run.resolvedScenarioHash !== scenario.resolvedScenarioHash) {
    mismatches.push("run and scenario resolvedScenarioHash differ");
  }
  if (run.rulesetHash !== scenario.effective.rulesetManifestHash) {
    mismatches.push("run and scenario rulesetHash differ");
  }
  if (run.cohortHash !== scenario.effective.cohort.contentHash) {
    mismatches.push("run and scenario cohortHash differ");
  }
  if (run.policyHash !== scenario.policyHash) mismatches.push("run and scenario policyHash differ");
  if (run.candidateInputHash !== scenario.candidateInputHash) {
    mismatches.push("run and scenario candidateInputHash differ");
  }
  if (canonicalJson(run.objective) !== canonicalJson(scenario.effective.objective)) {
    mismatches.push("run and scenario objective configuration differ");
  }
  if (canonicalJson(run.evaluationMode) !== canonicalJson(scenario.effective.evaluationMode)) {
    mismatches.push("run and scenario evaluation configuration differ");
  }

  const identities: ReadonlyArray<[string, string, string]> = [
    ["runId", snapshot.runId, run.runId],
    ["engineHash", snapshot.engineHash, run.engineHash],
    ["rulesetHash", snapshot.rulesetHash, run.rulesetHash],
    ["cohortHash", snapshot.cohortHash, run.cohortHash],
    ["policyHash", snapshot.policyHash, run.policyHash],
    ["resolvedScenarioHash", snapshot.resolvedScenarioHash, run.resolvedScenarioHash],
    ["candidateInputHash", snapshot.candidateInputHash, run.candidateInputHash],
  ];
  for (const [name, actual, expected] of identities) {
    if (actual !== expected) mismatches.push(`snapshot ${name} differs from run`);
  }
  if (mismatches.length > 0) throw new ResumeCompatibilityError(mismatches);
  return snapshot;
}

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
  /** Must call assertResumeCompatible and reject non-resumable snapshots. */
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
