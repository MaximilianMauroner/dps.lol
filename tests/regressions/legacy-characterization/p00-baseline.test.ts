import { describe, expect, test } from "bun:test";
import { fixtureTargets } from "../../../src/data/fixtures";
import { defaultSkillRanks } from "../../../src/domain/skills";
import { compareAcrossSamples, simulateYunara } from "../../../src/domain/simulator";
import {
  evaluateOptimizerBuild,
  optimizerBaseForObjective,
  rankOptimizerBuilds,
} from "../../../src/domain/optimizer-engine";
import { validateBuild } from "../../../src/domain/optimizer";
import type { OptimizerEvaluationContext, Target } from "../../../src/domain/types";

const ranks = defaultSkillRanks(13);

const target: Target = {
  id: "p00-synthetic-target",
  champion: "Synthetic target",
  health: 3_000,
  armor: 0,
  magicResist: 0,
  bonusHealth: 0,
  level: 13,
  provenance: "fixture",
};

function simulate(overrides: Partial<Parameters<typeof simulateYunara>[0]> = {}) {
  return simulateYunara({
    level: 13,
    ranks,
    durationSeconds: 5,
    actions: ["AA"],
    continueAutos: false,
    build: { name: "P00 fixture build", itemIds: [] },
    target,
    ...overrides,
  });
}

describe("P00 legacy characterization", () => {
  /**
   * Intentional red test at the audited baseline.
   *
   * This asserts the future-event contract, not the current output. The
   * repair belongs to the shared event/action work in P04/P08/P16. Keeping
   * this assertion red prevents the existing defect from becoming a golden
   * result while still making the defect reproducible without credentials.
   */
  test("W future tick cannot mutate health before an earlier eligible attack", () => {
    const result = simulate({
      durationSeconds: 2,
      actions: ["W", "AA"],
      target: { ...target, id: "p00-w-chronology", health: 400 },
    });
    const attack = result.events.find((event) => event.source === "Basic attack");
    const linger = result.events.find((event) => event.source === "Arc of Judgment — linger");
    const attackIndex = result.events.findIndex((event) => event.source === "Basic attack");
    const lingerIndex = result.events.findIndex(
      (event) => event.source === "Arc of Judgment — linger",
    );

    expect(attack).toBeDefined();
    expect(linger).toBeDefined();
    expect(attackIndex).toBeLessThan(lingerIndex);
    expect(attack?.time).toBeLessThan(linger?.time ?? Infinity);
    expect(attack?.final).toBeGreaterThan(85);
    expect(result.ttk).toBe(1);
    expect(result.events.map((event) => event.time)).toEqual(
      [...result.events].map((event) => event.time).sort((left, right) => left - right),
    );
  });

  test("characterizes scripted cooldown waiting without treating readiness as an action", () => {
    const result = simulate({
      durationSeconds: 12,
      actions: ["W", "W"],
      target: { ...target, id: "p00-cooldown", health: 100_000 },
    });
    expect(
      result.events
        .filter((event) => event.source === "Arc of Judgment")
        .map((event) => event.time),
    ).toEqual([0, 10]);
  });

  test("characterizes expected crit state as an averaged attack, not a sampled roll", () => {
    const result = simulate({
      durationSeconds: 1,
      actions: ["AA"],
      build: { name: "Infinity Edge", itemIds: [3031] },
      target: { ...target, id: "p00-average-crit", health: 100_000 },
    });
    const attack = result.events.find((event) => event.source === "Basic attack");
    const expectedRaw =
      result.stats.attackDamage * (1 + result.stats.critChance * (result.stats.critDamage - 1));

    expect(result.stats.critChance).toBe(0.25);
    expect(result.stats.critDamage).toBeCloseTo(2.3, 6);
    expect(attack?.raw).toBeCloseTo(expectedRaw, 0);
    expect(attack?.notes.join(" ")).toContain("25% expected crit at 230%");
  });

  test("characterizes selected-result transfer through the existing comparison path", () => {
    const targets = fixtureTargets.slice(0, 2);
    const context: OptimizerEvaluationContext = {
      base: {
        level: 13,
        ranks,
        durationSeconds: 5,
        actions: ["AA"],
        continueAutos: false,
        targetMode: "mortal",
      },
      targets,
      objective: "fixed-window-damage",
      candidateOptions: {
        eligibleItemIds: [3006, 3031, 3032],
        constraints: { slotCount: 2, bootRule: "required" },
      },
    };
    const search = rankOptimizerBuilds(context, { topN: 1 });
    const selected = search.rankings[0]!.candidate;
    const evaluation = evaluateOptimizerBuild(context, selected);
    const comparison = compareAcrossSamples(
      optimizerBaseForObjective(context),
      { name: selected.name, itemIds: [...selected.itemIds] },
      { name: "comparison control", itemIds: [3006] },
      targets,
      { includeEvents: false },
    );

    expect(comparison.rows.map((row) => row.a.totalDamage)).toEqual(
      evaluation.rows.map((row) => row.result.totalDamage),
    );
    expect(comparison.rows.map((row) => row.a.dps)).toEqual(
      evaluation.rows.map((row) => row.result.dps),
    );
  });

  test("characterizes current complete-inventory validation boundaries", () => {
    const constraints = {
      slotCount: 3,
      bootRule: "required" as const,
      maxBoots: 1,
    };
    const legal = validateBuild([3006, 3031, 3032], {
      eligibleItemIds: [3006, 3031, 3032],
      constraints,
    });
    const illegal = validateBuild([3006, 3006, 3031], {
      eligibleItemIds: [3006, 3031, 3032],
      constraints,
    });

    expect(legal.legal).toBe(true);
    expect(legal.totalGold).toBe(7_600);
    expect(legal.bootCount).toBe(1);
    expect(illegal.legal).toBe(false);
    expect(illegal.reasons).toEqual(["duplicate-item", "too-many-boots"]);
  });
});
