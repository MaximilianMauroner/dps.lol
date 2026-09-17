export interface StaticItemShape {
  id: number;
  name: string;
  tags: string[];
  goldTotal: number;
  purchasable: boolean;
  fromIds: number[];
  intoIds: number[];
  maps: Record<string, boolean>;
}

const EXCLUDED_IDS = new Set([2055, 2138, 2139, 2140, 3340, 3363, 3364]);

export function isCompletedLegendary(item: StaticItemShape): boolean {
  if (!item.purchasable || !item.maps["11"] || EXCLUDED_IDS.has(item.id)) return false;
  if (item.tags.some((tag) => ["Boots", "Consumable", "Trinket", "GoldPer"].includes(tag)))
    return false;
  // A purchasable Summoner's Rift item with recipe components, no upgrade target, and substantial
  // total cost is the most stable Data Dragon-only definition. Explicit exclusions handle utility items.
  return item.fromIds.length > 0 && item.intoIds.length === 0 && item.goldTotal >= 2000;
}

export function findThirdItemTimestamp(
  frames: Array<{ timestamp: number; inventory: number[] }>,
  items: Map<number, StaticItemShape>,
): number | null {
  for (const frame of frames) {
    const count = frame.inventory.filter((id) => {
      const item = items.get(id);
      return item ? isCompletedLegendary(item) : false;
    }).length;
    if (count >= 3) return frame.timestamp;
  }
  return null;
}
