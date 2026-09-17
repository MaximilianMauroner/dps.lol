import { growthAtLevel } from "./math";

export function deriveBonusHealth(
  actualHealthMax: number,
  level: number,
  baseHealth: number,
  healthPerLevel: number,
): number {
  const estimatedBase = baseHealth + growthAtLevel(healthPerLevel, level);
  return Math.max(0, actualHealthMax - estimatedBase);
}
