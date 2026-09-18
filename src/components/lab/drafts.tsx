"use client";

import type { SampleComparison } from "@/domain/types";
import type { ComparisonLabels, DraftRow, LabDataset } from "./types";

function deltaLabel(row: DraftRow, labels: ComparisonLabels): string {
  if (row.delta === null) return "—";
  if (row.outcome === "tie") return "Tie";
  const leader = row.outcome === "a" ? labels.shortA : labels.shortB;
  const magnitude = Math.abs(row.delta);
  const favoursLeader = (row.delta > 0 ? "a" : "b") === row.outcome;
  return magnitude >= 0.05 && favoursLeader
    ? `${leader} +${magnitude.toFixed(1)}%`
    : `${leader} leads`;
}

export function DraftSlices({
  rows,
  labels,
  comparison,
  dataset,
  loading,
}: {
  rows: DraftRow[];
  labels: ComparisonLabels;
  comparison: SampleComparison | null;
  dataset: LabDataset | null;
  loading: boolean;
}) {
  const summary = dataset?.summary;
  return (
    <section className="card" aria-labelledby="drafts">
      <h2 id="drafts">Draft slices and roles</h2>
      <p className="sub">Each row is a real re-simulation over that slice of the cohort.</p>
      {rows.length === 0 ? (
        <p className="note">
          {loading ? "Simulating draft slices…" : "Needs 6 or more snapshots to slice the cohort."}
        </p>
      ) : (
        rows.map((row) => (
          <div className="draft-row" key={row.key}>
            <span>
              {row.label}
              <small>{row.detail}</small>
            </span>
            <span className="track" aria-hidden>
              {row.delta !== null && row.outcome !== "tie" && (
                <i
                  className={row.outcome === "a" ? "pos" : "neg"}
                  style={
                    row.outcome === "a"
                      ? { left: "50%", width: `${Math.min(50, Math.abs(row.delta) * 2.4)}%` }
                      : { right: "50%", width: `${Math.min(50, Math.abs(row.delta) * 2.4)}%` }
                  }
                />
              )}
            </span>
            <span className={`draft-delta ${row.outcome === "tie" ? "" : row.outcome}`}>
              {deltaLabel(row, labels)}
            </span>
          </div>
        ))
      )}
      <div className="chips-row" aria-label="Win share by enemy role">
        <span className="chips-label">Roles</span>
        {(comparison?.byRole ?? []).map((group) => (
          <span className="chip" key={group.role}>
            {group.role} <strong>{Math.round(group.buildAWinRate * 100)}%</strong> {labels.shortA}
          </span>
        ))}
        {(comparison?.byRole ?? []).length === 0 && (
          <span className="note">Needs 2 or more samples per role</span>
        )}
      </div>
      <div className="chips-row" aria-label="Win share by enemy champion">
        <span className="chips-label">Champions</span>
        {(comparison?.byChampion ?? []).map((group) => (
          <span className="chip" key={group.champion}>
            {group.champion} <strong>{Math.round(group.buildAWinRate * 100)}%</strong>{" "}
            {labels.shortA}
          </span>
        ))}
        {(comparison?.byChampion ?? []).length === 0 && (
          <span className="note">Needs duplicate observations</span>
        )}
      </div>
      {summary && (
        <p className="note">
          Cohort median: {summary.health?.median ?? "—"} HP · {summary.bonusHealth?.median ?? "—"}{" "}
          bonus HP · {summary.armor?.median ?? "—"} armor · {summary.magicResist?.median ?? "—"} MR
          · minute {summary.minute?.median ?? "—"}.
        </p>
      )}
    </section>
  );
}
