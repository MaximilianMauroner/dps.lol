import { describe, expect, test } from "bun:test";
import { deriveBonusHealth } from "../src/domain/health";
import { giantSlayerMultiplier } from "../src/domain/items";
import {
  applyPercentArmorPenetration,
  growthAtLevel,
  mitigate,
  resistanceMultiplier,
} from "../src/domain/math";
import { compareAcrossSamples, simulateYunara } from "../src/domain/simulator";
import { applyInventoryEvent } from "../src/ingestion/inventory";

describe("combat math", () => {
  test("mitigates positive and negative resistance", () => {
    expect(resistanceMultiplier(100)).toBeCloseTo(0.5);
    expect(resistanceMultiplier(-50)).toBeCloseTo(1.333333, 5);
    expect(mitigate(100, -50)).toBeCloseTo(133.3333, 3);
  });

  test("applies percentage armor penetration", () => {
    expect(applyPercentArmorPenetration(200, 0.35)).toBeCloseTo(130);
    expect(applyPercentArmorPenetration(200, 1.5)).toBeCloseTo(0);
  });

  test("uses Riot's nonlinear champion growth curve", () => {
    expect(growthAtLevel(100, 1)).toBe(0);
    expect(growthAtLevel(100, 18)).toBeCloseTo(1700);
  });

  test("derives bonus health and clamps temporary-noise negatives", () => {
    expect(deriveBonusHealth(2000, 10, 600, 100)).toBeGreaterThan(0);
    expect(deriveBonusHealth(1, 18, 600, 100)).toBe(0);
  });
});

describe("items and inventory", () => {
  test("LDR Giant Slayer reaches 0/5/10/15% at expected bands", () => {
    expect(giantSlayerMultiplier(0)).toBe(1);
    expect(giantSlayerMultiplier(500)).toBe(1.05);
    expect(giantSlayerMultiplier(1000)).toBe(1.1);
    expect(giantSlayerMultiplier(1500)).toBe(1.15);
    expect(giantSlayerMultiplier(2500)).toBe(1.15);
  });

  test("reconstructs purchase, sell, and undo", () => {
    let inventory: number[] = [];
    inventory = applyInventoryEvent(inventory, {
      type: "ITEM_PURCHASED",
      timestamp: 1,
      itemId: 3031,
      participantId: 1,
    });
    inventory = applyInventoryEvent(inventory, {
      type: "ITEM_PURCHASED",
      timestamp: 2,
      itemId: 1038,
      participantId: 1,
    });
    expect(inventory).toEqual([3031, 1038]);
    inventory = applyInventoryEvent(inventory, {
      type: "ITEM_SOLD",
      timestamp: 3,
      itemId: 1038,
      participantId: 1,
    });
    expect(inventory).toEqual([3031]);
    // Riot ITEM_UNDO represents the current item as beforeId and the restored item as afterId.
    inventory = applyInventoryEvent(inventory, {
      type: "ITEM_UNDO",
      timestamp: 4,
      beforeId: 3031,
      afterId: 1031,
      participantId: 1,
    });
    expect(inventory).toEqual([1031]);
  });
});

const target = {
  id: "fixture",
  champion: "Ornn",
  role: "TOP",
  health: 3000,
  armor: 160,
  magicResist: 80,
  bonusHealth: 1300,
  level: 15,
  provenance: "fixture" as const,
};
const base = {
  level: 13,
  ranks: { q: 5, w: 3, e: 1, r: 2 },
  durationSeconds: 5,
  actions: ["R", "Q", "W", "AA", "AA"] as const,
  continueAutos: true,
};

describe("Yunara fixture and comparisons", () => {
  test("averages crits and adds Infinity Edge's 30-point crit modifier", () => {
    const result = simulateYunara({
      level: 1,
      ranks: { q: 1, w: 1, e: 1, r: 1 },
      durationSeconds: 1,
      actions: ["AA"],
      continueAutos: false,
      build: { name: "IE", itemIds: [3031] },
      target: { ...target, armor: 0, magicResist: 0, health: 10000 },
    });
    const basic = result.events.find((event) => event.source === "Basic attack");
    expect(basic?.raw).toBeCloseTo(164.125, 2); // 130 AD × (1 + .25 × (2.05 − 1))
    expect(result.stats.critDamage).toBeCloseTo(2.05);
  });

  test("produces an inspectable sequence with source breakdown", () => {
    const result = simulateYunara({
      ...base,
      build: { name: "IE", itemIds: [6672, 3085, 3006, 3031] },
      target,
    });
    expect(result.totalDamage).toBeGreaterThan(0);
    expect(result.events.length).toBeGreaterThan(3);
    expect(result.sources["Basic attack"]).toBeGreaterThan(0);
    expect(result.warnings.some((warning) => warning.includes("Runaan"))).toBe(true);
  });

  test("aggregates A/B outcomes across realistic samples", () => {
    const samples = [
      target,
      { ...target, id: "low-armor", armor: 50, bonusHealth: 0 },
      { ...target, id: "tank", armor: 240, bonusHealth: 2000 },
    ];
    const result = compareAcrossSamples(
      base,
      { name: "IE", itemIds: [6672, 3085, 3006, 3031] },
      { name: "LDR", itemIds: [6672, 3085, 3006, 3036] },
      samples,
    );
    expect(result.count).toBe(3);
    expect(result.rows).toHaveLength(3);
    expect(result.p25RelativeDelta).toBeDefined();
  });
});
