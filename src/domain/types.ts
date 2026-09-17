export type DamageType = "physical" | "magic" | "true";
export type ActionKind = "AA" | "Q" | "W" | "R";

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
  health: number;
  armor: number;
  magicResist: number;
  bonusHealth: number;
  level: number;
  minute?: number;
  itemIds?: number[];
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
}

export interface DamageEvent {
  time: number;
  source: string;
  type: DamageType;
  raw: number;
  resistance: number;
  multiplier: number;
  final: number;
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
  warnings: string[];
  stats: {
    attackDamage: number;
    attackSpeed: number;
    critChance: number;
    critDamage: number;
    armorPenPercent: number;
  };
}

export interface SampleComparison {
  count: number;
  buildAWinRate: number;
  medianRelativeDelta: number;
  p25RelativeDelta: number;
  p75RelativeDelta: number;
  byRole: Array<{ role: string; count: number; buildAWinRate: number }>;
  byChampion: Array<{ champion: string; count: number; buildAWinRate: number }>;
  rows: Array<{
    target: Target;
    a: SimulationResult;
    b: SimulationResult;
    relativeDelta: number;
  }>;
}
