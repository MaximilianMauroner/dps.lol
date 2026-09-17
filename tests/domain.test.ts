import { describe, expect, test } from "bun:test";
import { deriveBonusHealth } from "../src/domain/health";
import { deriveBonusHealthEstimate } from "../src/domain/health";
import { giantSlayerMultiplier, itemStats } from "../src/domain/items";
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
import {
  aggregateProgression,
  classifyInventory,
  dedupeLevelObservations,
  progressionRarity,
} from "../src/domain/progression";

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

  test("classifies completed legendaries separately from boots, components, and support wards", () => {
    const catalog = new Map<number, StaticItemShape>([
      [1001, { ...itemShape(1001, "Boots"), tags: ["Boots"], goldTotal: 300, fromIds: [] }],
      [3006, { ...itemShape(3006, "Berserker's Greaves"), tags: ["Boots"], fromIds: [1001] }],
      [3031, itemShape(3031, "Infinity Edge")],
      [1038, { ...itemShape(1038, "B. F. Sword"), goldTotal: 1300, fromIds: [] }],
      [2055, { ...itemShape(2055, "Control Ward"), tags: ["Consumable"] }],
      [3865, { ...itemShape(3865, "World Atlas"), tags: ["Support"] }],
    ]);
    const result = classifyInventory([3006, 3031, 1038, 2055, 3865], catalog);
    expect(result.completedLegendaryIds).toEqual([3031]);
    expect(result.bootsIds).toEqual([3006]);
    expect(result.bootTier).toBe("upgraded");
    expect(result.componentOrOtherIds).toEqual([1038, 2055, 3865]);
  });
});

function itemShape(id: number, name: string): StaticItemShape {
  return {
    id,
    name,
    tags: ["Damage"],
    goldTotal: 3000,
    purchasable: true,
    fromIds: [1001],
    intoIds: [],
    maps: { "11": true },
  };
}

describe("Yunara inventory progression", () => {
  const catalog = new Map<number, StaticItemShape>([
    [3006, { ...itemShape(3006, "Berserker's Greaves"), tags: ["Boots"], fromIds: [1001] }],
    [3031, itemShape(3031, "Infinity Edge")],
    [3032, itemShape(3032, "Yun Tal Wildarrows")],
    [3036, itemShape(3036, "Lord Dominik's Regards")],
    [3085, itemShape(3085, "Runaan's Hurricane")],
  ]);

  test("deduplicates repeated frames to one latest state per match/participant/level", () => {
    const rows = dedupeLevelObservations([
      { matchKey: "m1", participantKey: "1", level: 10, timestampMs: 100, itemIds: [3006] },
      { matchKey: "m1", participantKey: "1", level: 10, timestampMs: 200, itemIds: [3006, 3031] },
      { matchKey: "m1", participantKey: "1", level: 10, timestampMs: 150, itemIds: [3006] },
      { matchKey: "m2", participantKey: "1", level: 10, timestampMs: 100, itemIds: [3006] },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.matchKey === "m1")?.itemIds).toEqual([3006, 3031]);
  });

  test("uses mode, median tie-break, and exposes exact/tail/midrank rarity", () => {
    const rows = [0, 0, 1, 1].map((count, index) => ({
      matchKey: `m${index}`,
      participantKey: "1",
      level: 10,
      timestampMs: index,
      itemIds: [
        3006,
        ...Array.from({ length: count }, (_, itemIndex) => (itemIndex ? 3036 : 3031)),
      ],
    }));
    const result = aggregateProgression(rows, catalog, 10, {
      sampleThreshold: 2,
      supportedItemIds: [3031, 3036],
    });
    expect(result.selection.modeCompletedLegendary).toBe(0);
    const rarity = progressionRarity(result.selection, 1);
    expect(rarity.progressionPercentile).toBe(75);
    expect(rarity.tailPercent).toBe(50);
    expect(rarity.exactPercent).toBe(50);
  });

  test("does not count boots/components and flags a three-item low-level state as unusual", () => {
    const rows = [
      {
        matchKey: "m1",
        participantKey: "1",
        level: 10,
        timestampMs: 1,
        itemIds: [3006, 3031, 3036, 3085],
      },
      { matchKey: "m2", participantKey: "1", level: 10, timestampMs: 1, itemIds: [3006, 3031] },
      { matchKey: "m3", participantKey: "1", level: 10, timestampMs: 1, itemIds: [3006] },
    ];
    const result = aggregateProgression(rows, catalog, 10, {
      sampleThreshold: 20,
      supportedItemIds: [3031, 3036, 3085],
    });
    expect(
      result.levels.find((level) => level.level === 10)?.distribution.find((row) => row.count === 3)
        ?.observations,
    ).toBe(1);
    expect(result.selection.lowSample).toBe(true);
    expect(result.selection.recommendedObservedItemIds).toEqual([3031]);
    expect(progressionRarity(result.selection, 3).tailPercent).toBeCloseTo(33.33);
    expect(result.selection.commonBootTier).toBe("upgraded");
    const core = result.selection.supportedCoreFrequencies.find(
      (row) => row.itemIds.join(",") === "3031,3036",
    );
    expect(core?.observations).toBe(1);
  });

  test("keeps the observed Yun Tal modal core fully supported", () => {
    const result = aggregateProgression(
      [
        {
          matchKey: "m1",
          participantKey: "1",
          level: 13,
          timestampMs: 1,
          itemIds: [3031, 3032, 3085],
        },
        {
          matchKey: "m2",
          participantKey: "1",
          level: 13,
          timestampMs: 1,
          itemIds: [3031, 3032, 3085],
        },
      ],
      catalog,
      13,
      { sampleThreshold: 1, supportedItemIds: [3031, 3032, 3085] },
    );
    expect(result.selection.recommendedObservedItemIds).toEqual([3031, 3032, 3085]);
    expect(result.selection.recommendedSupportedItemIds).toEqual([3031, 3032, 3085]);
    expect(result.selection.recommendedExcludedItemIds).toEqual([]);
    expect(result.selection.recommendedExcludedItemNames).toEqual([]);
    expect(result.selection.modeCompletedLegendary).toBe(3);
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
  test("models pinned Yun Tal stats, stack crit growth, and cap", () => {
    expect(itemStats([3032])).toMatchObject({ attackDamage: 50, attackSpeed: 0.45, critChance: 0 });
    const run = (stacks: number) =>
      simulateYunara({
        level: 13,
        ranks: { q: 5, w: 3, e: 1, r: 2 },
        durationSeconds: 0.1,
        actions: ["AA"],
        continueAutos: false,
        yunTalStacks: stacks,
        build: { name: "Yun Tal", itemIds: [3032] },
        target: { ...target, health: 100000, armor: 0, magicResist: 0 },
      });
    expect(run(0).stats.yunTalCritChanceStart).toBe(0);
    expect(run(60).stats.yunTalCritChanceStart).toBeCloseTo(0.12);
    expect(run(125).stats.yunTalCritChanceStart).toBeCloseTo(0.25);
    expect(run(999).stats.yunTalStacksStart).toBe(125);
  });

  test("activates Flurry on the first attack for six seconds", () => {
    const result = simulateYunara({
      level: 13,
      ranks: { q: 5, w: 3, e: 1, r: 2 },
      durationSeconds: 10,
      actions: ["AA"],
      continueAutos: true,
      yunTalStacks: 0,
      build: { name: "Yun Tal", itemIds: [3032] },
      target: { ...target, health: 100000, armor: 0, magicResist: 0 },
    });
    expect(result.stats.flurryActivations).toBe(1);
    expect(result.events.some((event) => event.notes.includes("Flurry +30% bonus AS active"))).toBe(
      true,
    );
    expect(result.events.filter((event) => event.source === "Basic attack").length).toBeGreaterThan(
      3,
    );
  });

  test("level-13 three-item modal core is fully simulated", () => {
    const build = { name: "Observed core", itemIds: [3031, 3032, 3085] };
    const result = simulateYunara({
      ...base,
      build,
      target: { ...target, health: 100000 },
      yunTalStacks: 0,
    });
    expect(build.itemIds.filter((id) => ![3006, 3008].includes(id))).toHaveLength(3);
    expect(
      result.warnings.some(
        (warning) => warning.includes("Yun Tal") && warning.includes("not modeled"),
      ),
    ).toBe(false);
    expect(result.stats.attackDamage).toBeGreaterThan(200);
  });

  test("Yun Tal summary and detailed trace totals reconcile", () => {
    const input = {
      ...base,
      yunTalStacks: 40,
      build: { name: "Observed core", itemIds: [3031, 3032, 3085] },
      target: { ...target, health: 10000 },
    };
    const full = simulateYunara(input);
    const summed = full.events.reduce((sum, event) => sum + event.final, 0);
    expect(Math.abs(full.totalDamage - summed)).toBeLessThan(0.1);
    expect(full.split.physical + full.split.magic + full.split.true).toBeCloseTo(
      full.totalDamage,
      2,
    );
  });

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
