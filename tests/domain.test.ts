import { describe, expect, test } from "bun:test";
import { deriveBonusHealth } from "../src/domain/health";
import { deriveBonusHealthEstimate } from "../src/domain/health";
import { giantSlayerMultiplier } from "../src/domain/items";
import {
  applyPercentArmorPenetration,
  growthAtLevel,
  mitigate,
  resistanceMultiplier,
} from "../src/domain/math";
import {
  compareAcrossSamples,
  simulateYunara,
  weightedHeadlineWinner,
} from "../src/domain/simulator";
import { applyInventoryEvent } from "../src/ingestion/inventory";
import {
  findThirdItemAnchor,
  isCompletedLegendary,
  nearestFrameWithin,
  type StaticItemShape,
} from "../src/ingestion/completed-items";
import { buildMatchArchive, compressArchive } from "../src/storage/archive";

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

  test("does not invent bonus health when static champion HP is missing", () => {
    expect(deriveBonusHealthEstimate(2000, 10, undefined, undefined)).toEqual({
      value: null,
      status: "missing-static",
    });
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
    expect(basic?.raw).toBeCloseTo(172.25, 2); // 130 AD × (1 + .25 × (2.30 − 1))
    expect(result.stats.critDamage).toBeCloseTo(2.3);
  });

  test("caps mortal damage, records overkill, and stops dead-target events", () => {
    const result = simulateYunara({
      level: 13,
      ranks: { q: 5, w: 3, e: 1, r: 2 },
      durationSeconds: 10,
      actions: ["AA", "AA", "AA"],
      continueAutos: true,
      build: { name: "IE", itemIds: [3031] },
      target: { ...target, health: 100, armor: 0, magicResist: 0, bonusHealth: 50 },
    });
    expect(result.killed).toBe(true);
    expect(result.totalDamage).toBeCloseTo(100, 1);
    expect(result.overkill).toBeGreaterThan(0);
    expect(result.events.at(-1)?.targetHealthAfter).toBe(0);
    expect(result.events.length).toBeLessThan(8);
  });

  test("uses attack readiness for scripted autos", () => {
    const result = simulateYunara({
      level: 1,
      ranks: { q: 1, w: 1, e: 1, r: 1 },
      durationSeconds: 2,
      actions: ["AA", "AA"],
      continueAutos: false,
      build: { name: "empty", itemIds: [] },
      target: { ...target, health: 100000, armor: 0, magicResist: 0 },
    });
    const times = result.events
      .filter((event) => event.source === "Basic attack")
      .map((event) => event.time);
    expect(times[0]).toBe(0);
    expect(times[1]).toBeGreaterThan(1.4);
  });

  test("Q expires at five seconds while R keeps its fifteen-second window", () => {
    const qResult = simulateYunara({
      level: 18,
      ranks: { q: 5, w: 1, e: 1, r: 1 },
      durationSeconds: 8,
      actions: ["Q"],
      continueAutos: true,
      build: { name: "empty", itemIds: [] },
      target: { ...target, health: 100000, armor: 0, magicResist: 0 },
    });
    const activeTimes = qResult.events
      .filter((event) => event.source.includes("active"))
      .map((event) => event.time);
    expect(activeTimes.length).toBeGreaterThan(0);
    expect(Math.max(...activeTimes)).toBeLessThanOrEqual(5.25);
    expect(
      qResult.events.some((event) => event.time > 5.25 && event.source.includes("active")),
    ).toBe(false);

    const rResult = simulateYunara({
      level: 18,
      ranks: { q: 5, w: 1, e: 1, r: 1 },
      durationSeconds: 16,
      actions: ["R", "W"],
      continueAutos: false,
      build: { name: "empty", itemIds: [] },
      target: { ...target, health: 100000, armor: 0, magicResist: 0 },
    });
    expect(rResult.events.some((event) => event.source === "Arc of Ruin")).toBe(true);
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
    expect(result.aWins + result.bWins + result.ties + result.censored).toBe(3);
  });

  test("reports same-build ties and explicit censoring for TTK", () => {
    const same = compareAcrossSamples(
      { ...base, targetMode: "mortal", durationSeconds: 10 },
      { name: "same", itemIds: [3031] },
      { name: "same", itemIds: [3031] },
      [{ ...target, health: 500, armor: 0, magicResist: 0, bonusHealth: 100 }],
      { metric: "ttk", includeEvents: false },
    );
    expect(same.ties).toBe(1);
    expect(same.rows[0]?.outcome).toBe("tie");
    const censored = compareAcrossSamples(
      { ...base, targetMode: "mortal" },
      { name: "same", itemIds: [3031] },
      { name: "same", itemIds: [3031] },
      [target],
      { metric: "ttk", includeEvents: false },
    );
    expect(censored.censored).toBe(1);
    expect(censored.rows[0]?.outcome).toBe("censored");
  });

  test("ranks a valid finite target by first-crossing TTK", () => {
    const result = compareAcrossSamples(
      { ...base, durationSeconds: 10, targetMode: "mortal" },
      { name: "IE", itemIds: [6672, 3085, 3006, 3031] },
      { name: "LDR", itemIds: [6672, 3085, 3006, 3036] },
      [{ ...target, health: 2500, armor: 160, magicResist: 80, bonusHealth: 1000 }],
      { metric: "ttk", includeEvents: false },
    );
    expect(result.rows[0]?.a.killed).toBe(true);
    expect(result.rows[0]?.b.killed).toBe(true);
    expect(result.rows[0]?.outcome).toBe("b");
    expect(result.rows[0]?.b.ttk).toBeLessThan(result.rows[0]?.a.ttk ?? Infinity);
  });

  test("summary-only comparison preserves trace totals", () => {
    const targets = [{ ...target, health: 10000 }];
    const full = compareAcrossSamples(
      base,
      { name: "IE", itemIds: [3031] },
      { name: "LDR", itemIds: [3036] },
      targets,
    );
    const summary = compareAcrossSamples(
      base,
      { name: "IE", itemIds: [3031] },
      { name: "LDR", itemIds: [3036] },
      targets,
      { includeEvents: false },
    );
    expect(summary.rows[0]?.a.events).toHaveLength(0);
    expect(summary.rows[0]?.a.totalDamage).toBe(full.rows[0]?.a.totalDamage);
    expect(summary.rows[0]?.b.totalDamage).toBe(full.rows[0]?.b.totalDamage);
  });

  test("weighted headline follows outcome mass rather than raw row count", () => {
    const samples = [0, 50, 500].map((armor, index) => ({
      ...target,
      id: `weighted-${index}`,
      health: 3000,
      armor,
      bonusHealth: 0,
      sampleWeight: index < 2 ? 0.1 : 0.8,
    }));
    const comparison = compareAcrossSamples(
      {
        ...base,
        durationSeconds: 20,
        targetMode: "mortal",
      },
      { name: "IE", itemIds: [6672, 3085, 3006, 3031] },
      { name: "LDR", itemIds: [6672, 3085, 3006, 3036] },
      samples,
      { metric: "ttk", includeEvents: false },
    );
    expect(comparison.aWins).toBe(2);
    expect(comparison.bWins).toBe(1);
    expect(comparison.weightedOutcomes.a).toBeCloseTo(0.2);
    expect(comparison.weightedOutcomes.b).toBeCloseTo(0.8);
    expect(weightedHeadlineWinner(comparison)).toBe("b");
  });
});

describe("snapshot anchors and archive source", () => {
  const item = (id: number, name: string): StaticItemShape => ({
    id,
    name,
    tags: ["Damage"],
    goldTotal: 3000,
    purchasable: true,
    fromIds: [1001],
    intoIds: [],
    maps: { "11": true },
  });

  test("retains event time separately from selected frame and enforces minute tolerance", () => {
    const items = new Map([3031, 3036, 6672].map((id) => [id, item(id, String(id))]));
    const events = [
      { type: "ITEM_PURCHASED" as const, timestamp: 10, participantId: 1, itemId: 3031 },
      { type: "ITEM_PURCHASED" as const, timestamp: 20, participantId: 1, itemId: 3036 },
      { type: "ITEM_PURCHASED" as const, timestamp: 30, participantId: 1, itemId: 6672 },
    ];
    const anchor = findThirdItemAnchor(
      [{ timestamp: 60000, inventory: [3031, 3036, 6672] }],
      events,
      items,
    );
    expect(anchor).toEqual({ frameTimestamp: 60000, eventTimestamp: 30, frameDistanceMs: 59970 });
    expect(nearestFrameWithin([{ timestamp: 300000 }], 1500000, 120000)).toBeNull();
    expect(nearestFrameWithin([{ timestamp: 1500000 }], 1500000, 120000)?.timestamp).toBe(1500000);
  });

  test("archive envelope is deterministic and retains original responses", () => {
    const source = buildMatchArchive(
      { metadata: { matchId: "m" }, info: { participants: [] } },
      { metadata: { matchId: "m" }, info: { frames: [] } },
    );
    const compressed = compressArchive(source);
    expect(compressed.compressedBytes).toBeGreaterThan(0);
    expect(compressed.sha256).toHaveLength(64);
    expect(JSON.parse(new TextDecoder().decode(compressed.uncompressed))).toEqual(source);
    expect(isCompletedLegendary({ ...item(3031, "IE") })).toBe(true);
  });
});
