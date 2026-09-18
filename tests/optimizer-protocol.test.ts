import { describe, expect, test } from "bun:test";
import { fixtureTargets } from "../src/data/fixtures";
import { defaultSkillRanks } from "../src/domain/skills";
import type { OptimizerEvaluationContext } from "../src/domain/types";
import {
  acceptsOptimizerResponse,
  OPTIMIZER_PROGRESS,
  OPTIMIZER_RESULT,
  OptimizerMemoCache,
  runOptimizerInChunks,
  type OptimizerWorkerProgress,
  type OptimizerWorkerRequest,
  type OptimizerWorkerResult,
} from "../src/workers/optimizer-protocol";

const context: OptimizerEvaluationContext = {
  base: {
    level: 13,
    ranks: defaultSkillRanks(13),
    durationSeconds: 1,
    actions: [],
    continueAutos: false,
    yunTalStacks: 0,
    targetMode: "mortal",
  },
  targets: [fixtureTargets[0]!],
  objective: "fixed-window-damage",
  candidateOptions: {
    eligibleItemIds: [3006, 3008, 3031, 3032, 3036, 3085],
    constraints: { slotCount: 3, bootRule: "required" },
  },
};

function request(searchToken: string): OptimizerWorkerRequest {
  return {
    type: "optimizer/optimize",
    searchToken,
    context,
    topN: 3,
    chunkSize: 2,
  };
}

function callbacksFor(
  active: () => boolean,
  progress: OptimizerWorkerProgress[],
  results: OptimizerWorkerResult[],
  cancelled: string[],
) {
  return {
    isActive: active,
    onProgress: (message: OptimizerWorkerProgress): void => {
      progress.push(message);
    },
    onResult: (message: OptimizerWorkerResult): void => {
      results.push(message);
    },
    onCancelled: (message: { searchToken: string }): void => {
      cancelled.push(message.searchToken);
    },
    yieldControl: async () => {},
  };
}

describe("optimizer Worker protocol", () => {
  test("reports chunk progress and evaluates every candidate before returning", async () => {
    const cache = new OptimizerMemoCache();
    const progress: OptimizerWorkerProgress[] = [];
    const results: OptimizerWorkerResult[] = [];
    const cancelled: string[] = [];
    const outcome = await runOptimizerInChunks(
      request("search-1"),
      cache,
      callbacksFor(() => true, progress, results, cancelled),
    );

    expect(outcome.status).toBe("complete");
    expect(results).toHaveLength(1);
    expect(results[0]!.result.candidateCount).toBe(12); // 2 boots × C(4 non-boots, 2)
    expect(results[0]!.result.evaluatedCount).toBe(12);
    expect(progress.map((message) => message.evaluatedCount)).toEqual([0, 2, 4, 6, 8, 10, 12]);
    expect(progress.every((message) => message.searchToken === "search-1")).toBe(true);
    expect(cancelled).toEqual([]);
    expect(cache.size).toBe(1);
  });

  test("memoizes only complete context results and is independent of search token", async () => {
    const cache = new OptimizerMemoCache();
    const firstProgress: OptimizerWorkerProgress[] = [];
    const firstResults: OptimizerWorkerResult[] = [];
    const firstCancelled: string[] = [];
    await runOptimizerInChunks(
      request("first-token"),
      cache,
      callbacksFor(() => true, firstProgress, firstResults, firstCancelled),
    );

    const secondProgress: OptimizerWorkerProgress[] = [];
    const secondResults: OptimizerWorkerResult[] = [];
    const secondCancelled: string[] = [];
    const second = await runOptimizerInChunks(
      request("new-token"),
      cache,
      callbacksFor(() => true, secondProgress, secondResults, secondCancelled),
    );

    expect(second.status).toBe("cached");
    expect(secondResults[0]!.cached).toBe(true);
    expect(secondProgress).toHaveLength(1);
    expect(secondProgress[0]!.cached).toBe(true);
    expect(secondResults[0]!.contextHash).toBe(firstResults[0]!.contextHash);
  });

  test("cancels at a chunk boundary and never caches a partial ranking", async () => {
    const cache = new OptimizerMemoCache();
    const progress: OptimizerWorkerProgress[] = [];
    const results: OptimizerWorkerResult[] = [];
    const cancelled: string[] = [];
    let activeToken = "search-1";
    const callbacks = callbacksFor(() => activeToken === "search-1", progress, results, cancelled);
    const onProgress = callbacks.onProgress;
    callbacks.onProgress = (message) => {
      onProgress(message);
      if (message.evaluatedCount === 2) activeToken = "new-search";
    };
    const outcome = await runOptimizerInChunks(request("search-1"), cache, callbacks);
    expect(outcome.status).toBe("cancelled");
    expect(results).toHaveLength(0);
    expect(cancelled).toEqual(["search-1"]);
    expect(progress.map((message) => message.evaluatedCount)).toEqual([0, 2]);
    expect(cache.size).toBe(0);
  });

  test("rejects stale token/context messages on the receiving side", () => {
    const message: OptimizerWorkerResult = {
      type: OPTIMIZER_RESULT,
      searchToken: "old",
      contextHash: "old-context",
      cached: false,
      result: {
        objective: "fixed-window-damage",
        contextHash: "old-context",
        candidateCount: 0,
        evaluatedCount: 0,
        rankings: [],
      },
    };
    expect(
      acceptsOptimizerResponse(message, { searchToken: "new", contextHash: "new-context" }),
    ).toBe(false);
    expect(
      acceptsOptimizerResponse(message, { searchToken: "old", contextHash: "new-context" }),
    ).toBe(false);
    expect(
      acceptsOptimizerResponse(message, { searchToken: "old", contextHash: "old-context" }),
    ).toBe(true);
    const progress: OptimizerWorkerProgress = {
      type: OPTIMIZER_PROGRESS,
      searchToken: "old",
      contextHash: "old-context",
      candidateCount: 1,
      evaluatedCount: 0,
      progress: 0,
      rankings: [],
      cached: false,
    };
    expect(acceptsOptimizerResponse(progress, { searchToken: "old" })).toBe(true);
  });
});
