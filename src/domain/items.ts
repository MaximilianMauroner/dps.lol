export interface ItemMechanic {
  id: number;
  name: string;
  attackDamage?: number;
  attackSpeed?: number;
  critChance?: number;
  critDamage?: number;
  armorPenPercent?: number;
  boots?: boolean;
}

export const ITEMS: Record<number, ItemMechanic> = {
  3006: { id: 3006, name: "Berserker's Greaves", attackSpeed: 0.3, boots: true },
  3031: { id: 3031, name: "Infinity Edge", attackDamage: 75, critChance: 0.25, critDamage: 0.3 },
  3036: {
    id: 3036,
    name: "Lord Dominik's Regards",
    attackDamage: 35,
    critChance: 0.25,
    armorPenPercent: 0.35,
  },
  3085: { id: 3085, name: "Runaan's Hurricane", attackSpeed: 0.4, critChance: 0.25 },
  6672: { id: 6672, name: "Kraken Slayer", attackDamage: 45, attackSpeed: 0.4 },
};

export function itemStats(itemIds: number[]) {
  return itemIds.reduce(
    (stats, id) => {
      const item = ITEMS[id];
      if (!item) return stats;
      stats.attackDamage += item.attackDamage ?? 0;
      stats.attackSpeed += item.attackSpeed ?? 0;
      stats.critChance += item.critChance ?? 0;
      stats.critDamage += item.critDamage ?? 0;
      stats.armorPenPercent = Math.max(stats.armorPenPercent, item.armorPenPercent ?? 0);
      return stats;
    },
    { attackDamage: 0, attackSpeed: 0, critChance: 0, critDamage: 0, armorPenPercent: 0 },
  );
}

export function giantSlayerMultiplier(bonusHealth: number): number {
  return 1 + Math.min(0.15, Math.max(0, bonusHealth) / 10_000);
}

export function krakenBaseDamage(level: number): number {
  // Ranged users deal 80%. 150 at levels 1–8, then +5 each level through 200 at 18.
  return 0.8 * (level <= 8 ? 150 : Math.min(200, 150 + (level - 8) * 5));
}
