export function resistanceMultiplier(resistance: number): number {
  return resistance >= 0 ? 100 / (100 + resistance) : 2 - 100 / (100 - resistance);
}

export function mitigate(rawDamage: number, resistance: number): number {
  return rawDamage * resistanceMultiplier(resistance);
}

export function applyPercentArmorPenetration(armor: number, percent: number): number {
  return armor * (1 - Math.max(0, Math.min(1, percent)));
}

// Riot champion growth curve, used for stats stored as "per level".
export function growthAtLevel(perLevel: number, level: number): number {
  const levels = Math.max(0, Math.min(17, level - 1));
  return perLevel * levels * (0.7025 + 0.0175 * levels);
}

export function quantile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const low = Math.floor(index);
  const fraction = index - low;
  return sorted[low]! + (sorted[low + 1] ?? sorted[low]!) * fraction - sorted[low]! * fraction;
}

export function round(value: number, digits = 1): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
