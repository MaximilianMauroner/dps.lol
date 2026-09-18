import { fixtureTargets } from "../src/data/fixtures";
import { defaultSkillRanks } from "../src/domain/skills";
import { generateCandidateBuilds } from "../src/domain/optimizer";
import { rankOptimizerBuilds } from "../src/domain/optimizer-engine";
import type { OptimizerEvaluationContext } from "../src/domain/types";

/**
 * Deterministic engine-only benchmark. These are fixture targets, not a claim
 * about the size or distribution of the live Riot cohort. The slot counts
 * mirror the current level workflow's observed completed items plus one boot:
 * two at L10, three at L13, and four at L16.
 */
const contexts = [
  { level: 10, slotCount: 3 },
  { level: 13, slotCount: 4 },
  { level: 16, slotCount: 5 },
] as const;

const targets = fixtureTargets.map((target) => ({ ...target }));

for (const { level, slotCount } of contexts) {
  const candidateOptions = {
    constraints: { slotCount, bootRule: "required" as const },
  };
  const candidates = generateCandidateBuilds(candidateOptions);
  const context: OptimizerEvaluationContext = {
    base: {
      level,
      ranks: defaultSkillRanks(level),
      durationSeconds: 5,
      actions: ["R", "Q", "W", "AA", "AA"],
      continueAutos: true,
      yunTalStacks: 0,
      targetMode: "mortal",
    },
    targets,
    objective: "sustained-dps",
    candidateOptions,
  };
  const started = performance.now();
  const result = rankOptimizerBuilds(context, { candidates, topN: 3 });
  const elapsedMs = performance.now() - started;
  console.log(
    JSON.stringify({
      level,
      slotCount,
      targetCount: targets.length,
      candidateCount: result.candidateCount,
      evaluatedCount: result.evaluatedCount,
      elapsedMs: Number(elapsedMs.toFixed(1)),
      top: result.rankings.map((row) => ({
        rank: row.rank,
        identity: row.candidate.identity,
        score: row.score,
        killCoverage: row.killCoverage,
      })),
    }),
  );
}
