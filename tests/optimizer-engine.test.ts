import { describe, expect, test } from "bun:test";
import { fixtureTargets } from "../src/data/fixtures";
import { defaultSkillRanks } from "../src/domain/skills";
import { generateCandidateBuilds } from "../src/domain/optimizer";
import {
  compareOptimizerEvaluations,
  evaluateOptimizerBuild,
  optimizerBaseForObjective,
  optimizerContextHash,
  optimizerSimulationInput,
  rankOptimizerBuilds,
} from "../src/domain/optimizer-engine";
import { simulateYunara } from "../src/domain/simulator";
import type { OptimizerBuildEvaluation, OptimizerEvaluationContext } from "../src/domain/types";

const base = {
  level: 13,
  ranks: defaultSkillRanks(13),
  durationSeconds: 5,
  actions: ["R", "Q", "W", "AA"] as const,
  continueAutos: true,
  yunTalStacks: 0,
  targetMode: "mortal" as const,
};

const targets = fixtureTargets.slice(0, 3).map((target, index) => ({
  ...target,
  sampleWeight: index === 0 ? 2 : 1,
}));

function context(
  objective: OptimizerEvaluationContext["objective"],
  overrides: Partial<OptimizerEvaluationContext["base"]> = {},
): OptimizerEvaluationContext {
  return {
    base: { ...base, ...overrides },
    targets,
    objective,
    candidateOptions: {
      eligibleItemIds: [3006, 3031, 3032, 3085],
      constraints: { slotCount: 4, bootRule: "required" },
    },
  };
}

describe("optimizer evaluation semantics", () => {
  test("uses the existing simulator exactly for every target and preserves weights", () => {
    const evaluationContext = context("fixed-window-damage", { continueAutos: false });
    const candidate = generateCandidateBuilds(evaluationContext.candidateOptions)[0]!;
    const evaluation = evaluateOptimizerBuild(evaluationContext, candidate);
    const direct = targets.map((target) =>
      simulateYunara(optimizerSimulationInput(evaluationContext, candidate, target)),
    );
    expect(evaluation.rows.map((row) => row.result)).toEqual(direct);
    expect(evaluation.totalWeight).toBe(4);
    expect(evaluation.weightedDamage).toBeCloseTo(
      (direct[0]!.totalDamage * 2 + direct[1]!.totalDamage + direct[2]!.totalDamage) / 4,
      6,
    );
    expect(evaluation.score).toBe(evaluation.weightedDamage);
  });

  test("sustained and burst objectives make continuation semantics explicit", () => {
    const sustained = context("sustained-dps", { continueAutos: false });
    const burst = context("burst-damage", { continueAutos: true });
    const build = generateCandidateBuilds(sustained.candidateOptions)[0]!;
    expect(optimizerBaseForObjective(sustained).continueAutos).toBe(true);
    expect(optimizerBaseForObjective(burst).continueAutos).toBe(false);

    const sustainedRun = evaluateOptimizerBuild(sustained, build);
    const burstRun = evaluateOptimizerBuild(burst, build);
    expect(sustainedRun.score).toBe(sustainedRun.weightedDps);
    expect(burstRun.score).toBe(burstRun.weightedDamage);
    expect(sustainedRun.rows[0]!.result.totalDamage).toBeGreaterThanOrEqual(
      burstRun.rows[0]!.result.totalDamage,
    );
  });

  test("TTK reports kill coverage and excludes censored rows from mean TTK", () => {
    const ttkTargets = [
      { ...targets[0]!, id: "easy", health: 100, sampleWeight: 1 },
      { ...targets[0]!, id: "hard", health: 100_000, sampleWeight: 1 },
    ];
    const evaluationContext: OptimizerEvaluationContext = {
      base: { ...base, durationSeconds: 1, actions: ["AA"], continueAutos: false },
      targets: ttkTargets,
      objective: "ttk",
    };
    const build = { name: "test build", itemIds: [3006, 3031] };
    const evaluation = evaluateOptimizerBuild(evaluationContext, build);
    const killed = evaluation.rows.find((row) => row.target.id === "easy")!;
    const censored = evaluation.rows.find((row) => row.target.id === "hard")!;

    expect(killed.result.killed).toBe(true);
    expect(censored.result.killed).toBe(false);
    expect(censored.result.censored).toBe(true);
    expect(evaluation.killCoverage).toBe(0.5);
    expect(evaluation.censoredCoverage).toBe(0.5);
    expect(evaluation.meanTtk).toBe(killed.result.ttk);
    expect(evaluation.score).toBe(evaluation.meanTtk);
  });

  test("rejects TTK against uncapped targets instead of treating survival as a slow kill", () => {
    expect(() =>
      evaluateOptimizerBuild(context("ttk", { targetMode: "uncapped" }), {
        name: "test build",
        itemIds: [3006, 3031],
      }),
    ).toThrow("mortal target mode");
  });
});

describe("optimizer ranking", () => {
  test("evaluates every candidate and gives stable tie results independent of input order", () => {
    const evaluationContext: OptimizerEvaluationContext = {
      base: { ...base, actions: [], continueAutos: false },
      targets: [targets[0]!],
      objective: "fixed-window-damage",
    };
    const candidates = [
      { name: "Berserkers", itemIds: [3006] },
      { name: "Gluttonous", itemIds: [3008] },
    ];
    const first = rankOptimizerBuilds(evaluationContext, { candidates, topN: 2 });
    const second = rankOptimizerBuilds(evaluationContext, {
      candidates: [...candidates].reverse(),
      topN: 2,
    });

    expect(first.candidateCount).toBe(2);
    expect(first.evaluatedCount).toBe(2);
    expect(first.rankings.map((row) => row.candidate.identity)).toEqual(
      second.rankings.map((row) => row.candidate.identity),
    );
    expect(first.rankings[0]!.candidate.identity).toBe("3008");
    expect(
      compareOptimizerEvaluations(
        { ...first.rankings[0]!, rows: [] } as OptimizerBuildEvaluation,
        { ...first.rankings[1]!, rows: [] } as OptimizerBuildEvaluation,
      ),
    ).toBeLessThan(0);
  });

  test("changes the context hash for every result-affecting input but ignores search token", () => {
    const evaluationContext = context("sustained-dps");
    const candidates = generateCandidateBuilds(evaluationContext.candidateOptions);
    const options = {
      topN: 3,
      candidateIdentities: candidates.map((candidate) => candidate.identity),
    };
    const same = optimizerContextHash(evaluationContext, options);
    const changed = optimizerContextHash(
      { ...evaluationContext, base: { ...evaluationContext.base, durationSeconds: 10 } },
      options,
    );
    expect(same).toBe(optimizerContextHash(evaluationContext, options));
    expect(changed).not.toBe(same);
  });
});
