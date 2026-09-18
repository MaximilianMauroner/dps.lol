export type DamageType = "physical" | "magic" | "true";
export type ActionKind = "AA" | "Q" | "W" | "R" | "E";

export interface AbilityRanks {
  q: number;
  w: number;
  e: number;
  r: number;
}

export interface Build {
  name: string;
  itemIds: number[];
}

export interface Target {
  id: string;
  champion: string;
  role?: string;
  rank?: string;
  health: number;
  armor: number;
  magicResist: number;
  bonusHealth: number;
  bonusHealthStatus?: "derived" | "missing-static" | "clamped" | "unknown";
  level: number;
  minute?: number;
  itemIds?: number[];
  sampleWeight?: number;
  /** Short opaque match key used only for match-balanced aggregation. */
  sourceMatchKey?: string;
  anchorEventTimestampMs?: number;
  anchorFrameDistanceMs?: number;
  provenance?: "fixture" | "riot";
}

export interface SimulationInput {
  level: number;
  ranks: AbilityRanks;
  build: Build;
  target: Target;
  durationSeconds: number;
  actions: readonly ActionKind[];
  continueAutos: boolean;
  /** Starting ranged Yun Tal Wildarrows stacks (0–125). Match-V5 does not expose this state. */
  yunTalStacks?: number;
  /** Mortal targets are the default. `uncapped` is an explicit training-dummy mode. */
  targetMode?: "mortal" | "uncapped";
}

export interface DamageEvent {
  time: number;
  source: string;
  type: DamageType;
  raw: number;
  resistance: number;
  multiplier: number;
  /** Damage attempted after mitigation and item modifiers, before target-health capping. */
  attemptedFinal: number;
  final: number;
  /** Overkill is reported separately and is never counted in totalDamage. */
  overkill: number;
  targetHealthAfter: number;
  notes: string[];
}

export interface SimulationResult {
  build: string;
  totalDamage: number;
  dps: number;
  ttk: number | null;
  split: Record<DamageType, number>;
  sources: Record<string, number>;
  events: DamageEvent[];
  killed: boolean;
  /** True when the target was not killed before the configured window (mortal mode). */
  censored: boolean;
  overkill: number;
  targetMode: "mortal" | "uncapped";
  warnings: string[];
  stats: {
    attackDamage: number;
    attackSpeed: number;
    critChance: number;
    critDamage: number;
    armorPenPercent: number;
    yunTalStacksStart: number;
    yunTalStacksEnd: number;
    yunTalCritChanceStart: number;
    yunTalCritChanceEnd: number;
    flurryActivations: number;
  };
}

export interface SampleComparison {
  metric: "damage" | "ttk";
  count: number;
  distinctMatchCount: number;
  totalWeight: number;
  /** Weighted outcome mass; ties and censored rows are neutral for winner selection. */
  weightedOutcomes: {
    a: number;
    b: number;
    tie: number;
    censored: number;
  };
  buildAWinRate: number;
  medianRelativeDelta: number;
  p25RelativeDelta: number;
  p75RelativeDelta: number;
  aWins: number;
  bWins: number;
  ties: number;
  censored: number;
  aNotKilled: number;
  bNotKilled: number;
  /** `decided` counts the rows that were not a tie or censored; a group with none has no winner. */
  byRole: Array<{ role: string; count: number; decided: number; buildAWinRate: number }>;
  byChampion: Array<{ champion: string; count: number; decided: number; buildAWinRate: number }>;
  rows: Array<{
    target: Target;
    a: SimulationResult;
    b: SimulationResult;
    relativeDelta: number;
    metricDelta: number | null;
    outcome: "a" | "b" | "tie" | "censored";
  }>;
}
