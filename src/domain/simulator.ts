import { quantile, round } from "./math";
import type { Build, SampleComparison, SimulationInput, Target } from "./types";
import { yunara } from "./champions/yunara";

export function simulateYunara(input: SimulationInput) {
  return yunara.simulate(input);
}

export function compareAcrossSamples(
  base: Omit<SimulationInput, "build" | "target">,
  buildA: Build,
  buildB: Build,
  targets: Target[],
): SampleComparison {
  const rows = targets.map((target) => {
    const a = simulateYunara({ ...base, build: buildA, target });
    const b = simulateYunara({ ...base, build: buildB, target });
    return {
      target,
      a,
      b,
      relativeDelta: b.totalDamage === 0 ? 0 : (a.totalDamage - b.totalDamage) / b.totalDamage,
    };
  });
  const deltas = rows.map((row) => row.relativeDelta);
  const roles = [...new Set(rows.map((row) => row.target.role ?? "UNKNOWN"))];
  const champions = [...new Set(rows.map((row) => row.target.champion))];
  return {
    count: rows.length,
    buildAWinRate: rows.length
      ? rows.filter((row) => row.a.totalDamage > row.b.totalDamage).length / rows.length
      : 0,
    medianRelativeDelta: round(quantile(deltas, 0.5) * 100, 2),
    p25RelativeDelta: round(quantile(deltas, 0.25) * 100, 2),
    p75RelativeDelta: round(quantile(deltas, 0.75) * 100, 2),
    byRole: roles
      .map((role) => {
        const group = rows.filter((row) => (row.target.role ?? "UNKNOWN") === role);
        return {
          role,
          count: group.length,
          buildAWinRate:
            group.filter((row) => row.a.totalDamage > row.b.totalDamage).length / group.length,
        };
      })
      .filter((group) => group.count >= 2),
    byChampion: champions
      .map((champion) => {
        const group = rows.filter((row) => row.target.champion === champion);
        return {
          champion,
          count: group.length,
          buildAWinRate:
            group.filter((row) => row.a.totalDamage > row.b.totalDamage).length / group.length,
        };
      })
      .filter((group) => group.count >= 2),
    rows,
  };
}
