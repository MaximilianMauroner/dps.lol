export interface ItemMechanic {
  id: number;
  name: string;
  goldTotal: number;
  attackDamage?: number;
  attackSpeed?: number;
  critChance?: number;
  critDamage?: number;
  armorPenPercent?: number;
  boots?: boolean;
  /** Important passive effects that are not represented by the MVP damage engine. */
  warning?: string;
}

export const ITEMS: Record<number, ItemMechanic> = {
  3006: { id: 3006, name: "Berserker's Greaves", goldTotal: 1100, attackSpeed: 0.3, boots: true },
  // Current 16.18.1 Gluttonous Greaves has no modeled damage stat. Its omnivamp/takedown
  // stacking is intentionally outside this damage-only prototype, but the observed boot must
  // remain selectable and costed rather than being silently dropped from the level default.
  3008: { id: 3008, name: "Gluttonous Greaves", goldTotal: 1000, boots: true },
  // Data Dragon / CommunityDragon 16.18.1: 50 AD, 45% AS, 0% crit.
  // Practice Makes Lethal and Flurry are modeled in the Yunara plugin because they
  // depend on attack timing and the explicit starting-stack assumption.
  3032: {
    id: 3032,
    name: "Yun Tal Wildarrows",
    goldTotal: 3000,
    attackDamage: 50,
    attackSpeed: 0.45,
  },
  2523: {
    id: 2523,
    name: "Hexoptics C44",
    goldTotal: 2800,
    attackDamage: 55,
    critChance: 0.25,
    warning: "Hexoptics Magnification's range-based attack damage amp is not modeled.",
  },
  3031: {
    id: 3031,
    name: "Infinity Edge",
    goldTotal: 3500,
    attackDamage: 75,
    critChance: 0.25,
    critDamage: 0.3,
  },
  3036: {
    id: 3036,
    name: "Lord Dominik's Regards",
    goldTotal: 3300,
    attackDamage: 35,
    critChance: 0.25,
    armorPenPercent: 0.35,
  },
  3085: {
    id: 3085,
    name: "Runaan's Hurricane",
    goldTotal: 2650,
    attackSpeed: 0.4,
    critChance: 0.25,
  },
  3046: {
    id: 3046,
    name: "Phantom Dancer",
    goldTotal: 2650,
    attackSpeed: 0.65,
    critChance: 0.25,
    warning: "Phantom Dancer's Spectral Waltz movement effect is not modeled.",
  },
  3072: {
    id: 3072,
    name: "Bloodthirster",
    goldTotal: 3400,
    attackDamage: 80,
    warning: "Bloodthirster lifesteal and Ichorshield are not modeled.",
  },
  3095: {
    id: 3095,
    name: "Stormrazor",
    goldTotal: 3200,
    attackDamage: 50,
    attackSpeed: 0.25,
    critChance: 0.25,
    warning: "Stormrazor's Energized Bolt proc is not modeled.",
  },
  3153: {
    id: 3153,
    name: "Blade of The Ruined King",
    goldTotal: 3200,
    attackDamage: 40,
    attackSpeed: 0.25,
    warning: "Blade of the Ruined King's current-health on-hit is not modeled.",
  },
  3302: {
    id: 3302,
    name: "Terminus",
    goldTotal: 3000,
    attackDamage: 30,
    attackSpeed: 0.35,
    warning: "Terminus on-hit damage and alternating penetration stacks are not modeled.",
  },
  3026: {
    id: 3026,
    name: "Guardian Angel",
    goldTotal: 3200,
    attackDamage: 55,
    warning: "Guardian Angel's Rebirth effect is defensive and not modeled.",
  },
  3139: {
    id: 3139,
    name: "Mercurial Scimitar",
    goldTotal: 3200,
    attackDamage: 50,
    warning: "Mercurial Scimitar's active and lifesteal are not modeled.",
  },
  3033: {
    id: 3033,
    name: "Mortal Reminder",
    goldTotal: 3000,
    attackDamage: 35,
    critChance: 0.25,
    armorPenPercent: 0.3,
    warning: "Mortal Reminder's Grievous Wounds is not modeled.",
  },
  2512: {
    id: 2512,
    name: "Fiendhunter Bolts",
    goldTotal: 2650,
    attackSpeed: 0.45,
    critChance: 0.25,
    warning: "Fiendhunter's post-ultimate guaranteed-crit/true-damage passive is not modeled.",
  },
  6672: { id: 6672, name: "Kraken Slayer", goldTotal: 3000, attackDamage: 45, attackSpeed: 0.4 },
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

export function buildGoldTotal(itemIds: number[]): number {
  return itemIds.reduce((total, id) => total + (ITEMS[id]?.goldTotal ?? 0), 0);
}

export function unsupportedItemIds(itemIds: number[]): number[] {
  return [...new Set(itemIds.filter((id) => !ITEMS[id]))];
}

export function itemWarnings(itemIds: number[]): string[] {
  return [
    ...new Set(
      itemIds
        .map((id) => ITEMS[id]?.warning)
        .filter((warning): warning is string => Boolean(warning)),
    ),
  ];
}

export function giantSlayerMultiplier(bonusHealth: number): number {
  return 1 + Math.min(0.15, Math.max(0, bonusHealth) / 10_000);
}

export function krakenBaseDamage(level: number): number {
  // Ranged users deal 80%. 150 at levels 1–8, then +5 each level through 200 at 18.
  return 0.8 * (level <= 8 ? 150 : Math.min(200, 150 + (level - 8) * 5));
}
