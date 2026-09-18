"use client";

import { itemLabel } from "@/domain/compare-view";
import type {
  OptimizerObjective,
  OptimizerRankedBuild,
  OptimizerSearchResult,
} from "@/domain/types";
import type { OptimizerWorkerProgress } from "@/workers/optimizer-protocol";

const OBJECTIVES: Array<{ value: OptimizerObjective; label: string; detail: string }> = [
  {
    value: "sustained-dps",
    label: "Sustained DPS",
    detail: "Continue autos through the configured fight window.",
  },
  {
    value: "fixed-window-damage",
    label: "Fixed-window damage",
    detail: "Use the current opener and continuation setting exactly.",
  },
  {
    value: "burst-damage",
    label: "Burst / combo",
    detail: "Use the scripted combo and stop after its final action.",
  },
  {
    value: "ttk",
    label: "Time to kill",
    detail: "Maximize kill coverage, then minimize weighted first-crossing time.",
  },
];

export function OptimizerPanel({
  objective,
  slotCount,
  topN,
  running,
  progress,
  result,
  error,
  onObjective,
  onSlotCount,
  onTopN,
  onRun,
  onCancel,
  onUseBuild,
}: {
  objective: OptimizerObjective;
  slotCount: number;
  topN: number;
  running: boolean;
  progress: OptimizerWorkerProgress | null;
  result: OptimizerSearchResult | null;
  error: string;
  onObjective: (objective: OptimizerObjective) => void;
  onSlotCount: (slotCount: number) => void;
  onTopN: (topN: number) => void;
  onRun: () => void;
  onCancel: () => void;
  onUseBuild: (build: OptimizerRankedBuild["candidate"], side: "a" | "b") => void;
}) {
  const selectedObjective = OBJECTIVES.find((item) => item.value === objective)!;
  const shownProgress = progress?.progress ?? (result ? 1 : 0);
  return (
    <section className="card optimizer-panel" aria-labelledby="optimizer-title">
      <div className="rail-head">
        <h2 id="optimizer-title">Find an optimal build</h2>
        <span className="pill">exhaustive</span>
      </div>
      <p className="sub">
        Search every legal one-boot combination in the curated simulator catalog. Pairwise
        comparison below remains available for inspecting any result.
      </p>
      <div className="optimizer-controls">
        <div>
          <label className="fl" htmlFor="optimizer-objective">
            Objective
          </label>
          <select
            id="optimizer-objective"
            value={objective}
            onChange={(event) => onObjective(event.target.value as OptimizerObjective)}
            disabled={running}
          >
            {OBJECTIVES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="fl" htmlFor="optimizer-slots">
            Completed slots
          </label>
          <select
            id="optimizer-slots"
            value={slotCount}
            onChange={(event) => onSlotCount(Number(event.target.value))}
            disabled={running}
          >
            {[3, 4, 5, 6].map((count) => (
              <option key={count} value={count}>
                {count} items · 1 boot
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="fl" htmlFor="optimizer-top-n">
            Results
          </label>
          <select
            id="optimizer-top-n"
            value={topN}
            onChange={(event) => onTopN(Number(event.target.value))}
            disabled={running}
          >
            {[5, 10, 20].map((count) => (
              <option key={count} value={count}>
                Top {count}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="note">{selectedObjective.detail}</p>
      <div className="actions optimizer-actions">
        <button className="primary" onClick={onRun} disabled={running}>
          {running ? "Searching…" : "Search all builds"}
        </button>
        {running && (
          <button className="ghost" onClick={onCancel}>
            Cancel search
          </button>
        )}
      </div>
      {running && progress && (
        <div className="optimizer-progress" aria-live="polite">
          <div className="optimizer-progress-head">
            <span>Evaluating candidates</span>
            <span>
              {progress.evaluatedCount.toLocaleString()} /{" "}
              {progress.candidateCount.toLocaleString()}
            </span>
          </div>
          <progress max={1} value={shownProgress} />
        </div>
      )}
      {error && (
        <p className="warn" role="alert">
          {error}
        </p>
      )}
      {result && !running && (
        <div className="optimizer-results" aria-live="polite">
          <div className="optimizer-result-head">
            <strong>{result.candidateCount.toLocaleString()} legal builds searched</strong>
            <span>{result.evaluatedCount.toLocaleString()} evaluated</span>
          </div>
          <div className="optimizer-list">
            {result.rankings.map((row) => (
              <OptimizerRow key={row.candidate.identity} row={row} onUseBuild={onUseBuild} />
            ))}
          </div>
          <p className="note">
            TTK excludes censored targets from its mean and reports kill coverage separately. Items
            with partially modeled passives retain their simulator warnings.
          </p>
        </div>
      )}
    </section>
  );
}

function OptimizerRow({
  row,
  onUseBuild,
}: {
  row: OptimizerRankedBuild;
  onUseBuild: (build: OptimizerRankedBuild["candidate"], side: "a" | "b") => void;
}) {
  const metric = row.objective === "ttk" ? row.meanTtk : row.score;
  const metricLabel =
    row.objective === "ttk"
      ? metric === null
        ? "no kills"
        : `${metric.toFixed(2)}s mean TTK`
      : row.objective === "sustained-dps"
        ? `${Math.round(metric ?? 0).toLocaleString()} DPS`
        : `${Math.round(metric ?? 0).toLocaleString()} damage`;
  return (
    <article className="optimizer-row">
      <div className="optimizer-row-main">
        <span className="optimizer-rank">#{row.rank}</span>
        <div>
          <strong>{row.candidate.itemIds.map(itemLabel).join(" + ")}</strong>
          <span>
            {metricLabel} · {Math.round(row.killCoverage * 100)}% kill coverage ·{" "}
            {row.candidate.goldTotal.toLocaleString()}g
          </span>
        </div>
      </div>
      <div className="optimizer-row-actions">
        <button className="ghost" onClick={() => onUseBuild(row.candidate, "a")}>
          Use as A
        </button>
        <button className="ghost" onClick={() => onUseBuild(row.candidate, "b")}>
          Use as B
        </button>
      </div>
    </article>
  );
}
