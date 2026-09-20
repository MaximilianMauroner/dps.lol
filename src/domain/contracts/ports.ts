import {
  assertResumableSnapshot,
  canonicalJson,
  DamageResolutionSchema,
  EngineRunSchema,
  parseContract,
  ResolvedScenarioSchema,
  RunManifestSchema,
  StatsSnapshotSchema,
  type CombatResult,
  type DamagePacket,
  type DamageResolution,
  type EngineCommand,
  type EngineEvent,
  type EngineStepResult,
  type EngineSnapshot,
  type EngineRun,
  type EntityState,
  type ExactComparisonTransfer,
  type ItemInstance,
  type PolicyVisibleState,
  type ResolvedScenario,
  type RunManifest,
  type RngStreamSnapshot,
  type ScheduledEvent,
  type StepBudget,
  type StatsSnapshot,
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

export type StatsRequest = Readonly<{
  entity: EntityState;
  read: StateRead;
}>;

export function assertStatsSnapshot(request: StatsRequest, value: unknown): StatsSnapshot {
  const snapshot = parseContract(StatsSnapshotSchema, value);
  if (
    snapshot.entityId !== request.entity.entityId ||
    snapshot.revision !== request.read.stateRevision
  ) {
    throw new TypeError("stats snapshot must match the requested entity and state revision");
  }
  return snapshot;
}

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

export function assertDamageResolution(request: DamageRequest, value: unknown): DamageResolution {
  const resolution = parseContract(DamageResolutionSchema, value);
  const expectedHealth = Math.max(0, request.target.health.current - resolution.applied);
  if (
    resolution.attempted !== request.packet.rawAmount ||
    resolution.absorbed > request.target.health.shield ||
    resolution.applied > request.target.health.current ||
    resolution.targetHealthAfter !== expectedHealth
  ) {
    throw new TypeError("damage resolution must match the requested packet and target state");
  }
  return resolution;
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
  restore(entity: EntityState, context: PortContext): void;
  apply(mutation: ResourceMutation, context: PortContext): ResourceResolution;
}

export function assertResourceResolution(
  mutation: ResourceMutation,
  value: unknown,
): ResourceResolution {
  if (typeof value !== "object" || value === null)
    throw new TypeError("resource resolution must be an object");
  const result = value as Partial<ResourceResolution>;
  const expected = Math.max(0, Number(result.previous) + mutation.delta);
  if (
    result.entityId !== mutation.entityId ||
    result.resourceId !== mutation.resourceId ||
    typeof result.previous !== "number" ||
    !Number.isFinite(result.previous) ||
    typeof result.current !== "number" ||
    !Number.isFinite(result.current) ||
    result.current !== expected
  )
    throw new TypeError("resource resolution must be finite and match the requested mutation");
  return result as ResourceResolution;
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

export function assertRngResult(
  request: RngRequest,
  previousDrawCount: number,
  value: unknown,
): RngResult {
  if (typeof value !== "object" || value === null)
    throw new TypeError("RNG result must be an object");
  const result = value as Partial<RngResult>;
  if (
    result.streamId !== request.streamId ||
    !Array.isArray(result.values) ||
    result.values.length !== request.draws ||
    result.values.some((draw) => !Number.isFinite(draw) || draw < 0 || draw >= 1) ||
    result.nextDrawCount !== previousDrawCount + request.draws
  ) {
    throw new TypeError(
      "RNG result must match the requested stream, draw count, and cumulative counter",
    );
  }
  return result as RngResult;
}

export interface RngPort {
  restore(snapshot: RngStreamSnapshot, context: PortContext): void;
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
  if (snapshot.policyProgress.policyId !== scenario.effective.policy.policyId) {
    mismatches.push("snapshot policy progress policyId differs from scenario policy");
  }
  if (snapshot.policyProgress.revision !== scenario.effective.policy.revision) {
    mismatches.push("snapshot policy progress revision differs from scenario policy");
  }
  const progressStepIds = snapshot.policyProgress.steps.map((step) => step.stepId);
  const policyStepIds = scenario.effective.policy.steps.map((step) => step.stepId);
  if (canonicalJson(progressStepIds) !== canonicalJson(policyStepIds)) {
    mismatches.push("snapshot policy progress step IDs differ from scenario policy");
  }
  for (const [index, progress] of snapshot.policyProgress.steps.entries()) {
    const step = scenario.effective.policy.steps[index];
    if (!step || step.stepId !== progress.stepId) continue;
    if (!step.repeat && progress.consumedRepeats > 1) {
      mismatches.push(`snapshot policy step ${step.stepId} exceeds its one-shot count`);
    }
    if (step.maxRepeats !== null && progress.consumedRepeats > step.maxRepeats) {
      mismatches.push(`snapshot policy step ${step.stepId} exceeds maxRepeats`);
    }
    if (progress.state === "not-started" && progress.consumedRepeats !== 0) {
      mismatches.push(`snapshot policy step ${step.stepId} has progress before starting`);
    }
    if (
      progress.state === "active" &&
      step.maxRepeats !== null &&
      progress.consumedRepeats >= step.maxRepeats
    ) {
      mismatches.push(`snapshot policy step ${step.stepId} is active at its repeat limit`);
    }
  }
  for (const branch of snapshot.numericalBranches) {
    if (branch.mode !== scenario.effective.evaluationMode.kind) {
      mismatches.push(`snapshot numerical branch ${branch.branchId} differs from evaluation mode`);
    }
  }
  for (const stream of snapshot.rngStreams) {
    if (stream.algorithm !== scenario.effective.evaluationMode.random.algorithm) {
      mismatches.push(`snapshot RNG stream ${stream.streamId} differs from evaluation algorithm`);
    }
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

export function assertEngineRun(value: unknown): EngineRun {
  return parseContract(EngineRunSchema, value);
}

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
  | StatsSnapshot
  | DamageResolution
  | EngineCommand
  | EngineEvent
  | EngineSnapshot
  | EngineStepResult
  | ExactComparisonTransfer;

export type { WorkerMessage } from "./schemas";
