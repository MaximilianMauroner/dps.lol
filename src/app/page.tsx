"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import type { ActionKind, Target } from "@/domain/types";
import type {
  WorkerSimulationRequest,
  WorkerSimulationResponse,
} from "@/workers/simulation.worker";

const ICON = "https://ddragon.leagueoflegends.com/cdn/16.18.1/img/item/";
const itemNames: Record<number, string> = {
  6672: "Kraken Slayer",
  3085: "Runaan's Hurricane",
  3006: "Berserker's Greaves",
  3031: "Infinity Edge",
  3036: "Lord Dominik's Regards",
};
const itemIcons: Record<number, string> = {
  6672: "6672.png",
  3085: "3085.png",
  3006: "3006.png",
  3031: "3031.png",
  3036: "3036.png",
};

type ResponseData = any;

export default function Home() {
  const [level, setLevel] = useState(13);
  const [duration, setDuration] = useState(5);
  const [metric, setMetric] = useState<"damage" | "ttk">("damage");
  const [targetMode, setTargetMode] = useState<"realistic" | "manual">("realistic");
  const [region, setRegion] = useState("EUW1");
  const [rank, setRank] = useState("ALL");
  const [phase, setPhase] = useState("yunara-third-item");
  const [role, setRole] = useState("ALL");
  const [targetChampion, setTargetChampion] = useState("");
  const [selectedTargetId, setSelectedTargetId] = useState("");
  const [continueAutos, setContinueAutos] = useState(true);
  const [thirdA, setThirdA] = useState<3031 | 3036>(3031);
  const [thirdB, setThirdB] = useState<3031 | 3036>(3036);
  const [ranks, setRanks] = useState({ q: 5, w: 3, e: 1, r: 2 });
  const [actions, setActions] = useState<ActionKind[]>(["R", "Q", "W", "AA", "AA"]);
  const [manual, setManual] = useState({
    health: 2200,
    armor: 100,
    magicResist: 60,
    bonusHealth: 500,
    level: 13,
  });
  const [data, setData] = useState<ResponseData>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showLog, setShowLog] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const cohortRef = useRef<{ key: string; payload: any } | null>(null);

  const buildA = useMemo(
    () => ({ name: itemNames[thirdA], itemIds: [6672, 3085, 3006, thirdA] }),
    [thirdA],
  );
  const buildB = useMemo(
    () => ({ name: itemNames[thirdB], itemIds: [6672, 3085, 3006, thirdB] }),
    [thirdB],
  );

  useEffect(() => {
    const worker = new Worker(new URL("../workers/simulation.worker.ts", import.meta.url), {
      type: "module",
    });
    workerRef.current = worker;
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  async function run(selectedOverride?: string) {
    setLoading(true);
    setError("");
    try {
      const cohort = await loadCohort();
      const targets = cohort.dataset.targets as Target[];
      if (!targets.length) throw new Error("No target snapshots matched these filters.");
      const request: WorkerSimulationRequest = {
        id: ++requestIdRef.current,
        base: {
          level,
          ranks,
          durationSeconds: duration,
          actions,
          continueAutos,
          targetMode: "mortal",
        },
        buildA,
        buildB,
        targets,
        selectedTargetId: selectedOverride ?? selectedTargetId,
        metric,
      };
      const result = await runWorker(request);
      setData({
        patch: "26.18",
        dataVersion: "16.18.1",
        engineVersion: "yunara-engine-v1",
        assumptions: `Level ${level} / Q${ranks.q} W${ranks.w} E${ranks.e} R${ranks.r}, expected crits, Kraken + Runaan + boots included.`,
        warnings: [
          "Expected crit mode averages crits; it is not a kill probability.",
          "Yunara E is unsupported for damage, and Runaan's bolts are excluded for this single-target comparison.",
          "Builds are compared at listed costs, not equal gold.",
          "Mortal-target mode stops at death; fixed-window applied damage excludes overkill.",
          "Expected-crit TTK is a first-crossing model, not a kill probability.",
        ],
        dataset: { ...cohort.dataset, count: targets.length },
        builds: { a: buildA, b: buildB },
        target: result.representative.target,
        results: {
          a: result.representative.a,
          b: result.representative.b,
          comparison: result.comparison,
        },
        breakpoints: result.breakpoints,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Simulation failed");
    } finally {
      setLoading(false);
    }
  }

  async function loadCohort(): Promise<any> {
    const key = JSON.stringify({ targetMode, region, rank, phase, role, targetChampion, manual });
    if (cohortRef.current?.key === key) return cohortRef.current.payload;
    let payload: any;
    if (targetMode === "manual") {
      const target = {
        id: "manual",
        champion: "Custom target",
        health: manual.health,
        armor: manual.armor,
        magicResist: manual.magicResist,
        bonusHealth: manual.bonusHealth,
        level: manual.level,
        provenance: "fixture",
        sampleWeight: 1,
      };
      payload = {
        dataset: {
          targets: [target],
          provenance: "fixture",
          phase: "manual target",
          fallbackLevel: 3,
          note: "Manual target values supplied by the user; no Riot snapshot claim is made.",
          count: 1,
          distinctMatchCount: 0,
          snapshotCount: 1,
          availableDistinctMatchCount: 0,
          availableSnapshotCount: 1,
          truncated: false,
          sampleLimitPerMatch: 1,
          uniqueChampions: [target.champion],
          uniqueRoles: [],
          knownRankCount: 0,
          summary: summarizeTargetValues([target]),
        },
      };
    } else {
      const response = await fetch("/api/cohort", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ region, rank, phase, role, champion: targetChampion, limit: 1000 }),
      });
      payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Cohort retrieval failed");
    }
    const targets = payload.dataset.targets as Target[];
    if (targets.length && !targets.some((target) => target.id === selectedTargetId)) {
      setSelectedTargetId(targets[Math.floor(targets.length / 2)]!.id);
    }
    cohortRef.current = { key, payload };
    return payload;
  }

  function runWorker(request: WorkerSimulationRequest): Promise<WorkerSimulationResponse> {
    const worker = workerRef.current;
    if (!worker) return Promise.reject(new Error("Simulation worker is unavailable."));
    return new Promise((resolve, reject) => {
      const onMessage = (event: MessageEvent<WorkerSimulationResponse>) => {
        if (event.data.id !== request.id) return;
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
        resolve(event.data);
      };
      const onError = () => {
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
        reject(new Error("Simulation worker failed."));
      };
      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", onError);
      worker.postMessage(request);
    });
  }

  // The initial request loads one cohort; later build/level changes reuse it in the worker.
  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    void run();
  }, []);
  /* eslint-enable react-hooks/exhaustive-deps */

  function addAction(action: ActionKind) {
    setActions((current) => [...current, action]);
  }
  function removeAction(index: number) {
    setActions((current) => current.filter((_, i) => i !== index));
  }

  const resultA = data?.results?.a;
  const resultB = data?.results?.b;
  const comparison = data?.results?.comparison;
  const winner =
    comparison?.aWins > comparison?.bWins
      ? buildA.name
      : comparison?.bWins > comparison?.aWins
        ? buildB.name
        : "—";

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">✦</span>
          <span>
            RIFT <i>DELTA</i>
          </span>
          <small>PATCH-PINNED LAB</small>
        </div>
        <div className="top-actions">
          <span className="patch-pill">26.18 · 16.18.1</span>
          <span className="live-dot" /> <span className="muted">engine ready</span>
        </div>
      </header>
      <div className="workspace">
        <aside className="sidebar">
          <div className="eyebrow">SCENARIO BUILDER</div>
          <h1>
            Yunara <span>vs.</span> the frontline
          </h1>
          <p className="lede">
            A transparent answer to the third-item question. Every number can be traced to a formula
            or a match snapshot.
          </p>
          <label className="field-label">ATTACKER</label>
          <div className="champion-card">
            <div className="champion-avatar">Y</div>
            <div>
              <strong>Yunara</strong>
              <small>The Unbroken Faith · ADC</small>
            </div>
            <span className="chevron">⌄</span>
          </div>
          <div className="two-fields">
            <label>
              <span>LEVEL</span>
              <select value={level} onChange={(event) => setLevel(Number(event.target.value))}>
                {Array.from({ length: 18 }, (_, i) => (
                  <option key={i + 1}>{i + 1}</option>
                ))}
              </select>
            </label>
            <label>
              <span>PATCH</span>
              <div className="locked">
                26.18 <b>⌁</b>
              </div>
            </label>
          </div>
          <div className="field-label ability-head">
            <span>ABILITY RANKS</span>
            <em>assumed at level {level}</em>
          </div>
          <div className="ability-row">
            <span className="spell q">Q</span>
            <select
              className="rank-select"
              value={ranks.q}
              onChange={(event) => setRanks({ ...ranks, q: Number(event.target.value) })}
            >
              {[1, 2, 3, 4, 5].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
            <span>Cultivation of Spirit</span>
          </div>
          <div className="ability-row">
            <span className="spell w">W</span>
            <select
              className="rank-select"
              value={ranks.w}
              onChange={(event) => setRanks({ ...ranks, w: Number(event.target.value) })}
            >
              {[1, 2, 3, 4, 5].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
            <span>Arc of Judgment</span>
          </div>
          <div className="ability-row">
            <span className="spell e">E</span>
            <select
              className="rank-select"
              value={ranks.e}
              onChange={(event) => setRanks({ ...ranks, e: Number(event.target.value) })}
            >
              {[1, 2, 3, 4, 5].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
            <span>Kanmei&apos;s Steps</span>
          </div>
          <div className="ability-row">
            <span className="spell r">R</span>
            <select
              className="rank-select"
              value={ranks.r}
              onChange={(event) => setRanks({ ...ranks, r: Number(event.target.value) })}
            >
              {[1, 2, 3].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
            <span>Transcend One&apos;s Self</span>
          </div>
          <label className="field-label">SCRIPTED OPENER</label>
          <div className="timeline">
            {actions.map((action, index) => (
              <button
                className={`timeline-chip ${action.toLowerCase()}`}
                key={`${action}-${index}`}
                onClick={() => removeAction(index)}
                title="Remove action"
              >
                <span>{action}</span>
                <b>×</b>
              </button>
            ))}
            <span className="timeline-line" />
          </div>
          <div className="action-buttons">
            {(["AA", "Q", "W", "R"] as ActionKind[]).map((action) => (
              <button key={action} onClick={() => addAction(action)}>
                + {action}
              </button>
            ))}
          </div>
          <label className="check-row">
            <input
              type="checkbox"
              checked={continueAutos}
              onChange={(event) => setContinueAutos(event.target.checked)}
            />
            <span>Continue optimal autos after opener</span>
          </label>
          <label className="field-label">WINDOW</label>
          <div className="segmented">
            {[2, 5, 10].map((value) => (
              <button
                className={duration === value ? "selected" : ""}
                key={value}
                onClick={() => setDuration(value)}
              >
                {value}s
              </button>
            ))}
            <label
              className={
                ![2, 5, 10].includes(duration) ? "selected custom-duration" : "custom-duration"
              }
            >
              <input
                aria-label="Custom duration"
                type="number"
                min="1"
                max="60"
                value={duration}
                onChange={(event) => setDuration(Number(event.target.value))}
              />
              s
            </label>
          </div>
          <label className="field-label">COMPARISON METRIC</label>
          <div className="segmented metric-toggle">
            <button
              className={metric === "damage" ? "selected" : ""}
              onClick={() => setMetric("damage")}
            >
              APPLIED DAMAGE
            </button>
            <button className={metric === "ttk" ? "selected" : ""} onClick={() => setMetric("ttk")}>
              EXPECTED TTK
            </button>
          </div>
          <p className="quiet metric-note">
            {metric === "ttk"
              ? "Lower first-crossing time wins; uncensored kills only."
              : "Mortal targets stop at death; both kills are an applied-damage tie."}
          </p>
          <button className="run-button" onClick={() => void run()} disabled={loading}>
            <span>{loading ? "CALCULATING…" : "RUN COMPARISON"}</span>
            <b>↗</b>
          </button>
        </aside>
        <section className="content">
          <div className="content-head">
            <div>
              <div className="eyebrow">THIRD-ITEM DECISION / EXPECTED CRITS</div>
              <h2>
                Infinity Edge <span>or</span> Lord Dominik&apos;s Regards?
              </h2>
            </div>
            <div className="head-meta">
              <span className="target-count">{data?.dataset?.count ?? "—"} targets</span>
              <span>·</span>
              <span>{metric === "ttk" ? "TTK metric" : `${duration}s window`}</span>
            </div>
          </div>
          {error && <div className="error-banner">{error}</div>}
          <div className="target-bar">
            <div className="target-mode">
              <button
                className={targetMode === "realistic" ? "active" : ""}
                onClick={() => setTargetMode("realistic")}
              >
                ◈ REALISTIC TARGETS
              </button>
              <button
                className={targetMode === "manual" ? "active" : ""}
                onClick={() => setTargetMode("manual")}
              >
                ✎ MANUAL
              </button>
            </div>
            {targetMode === "realistic" ? (
              <div className="filters">
                <select
                  value={region}
                  onChange={(event) => setRegion(event.target.value)}
                  aria-label="Region"
                >
                  <option value="EUW1">EUW1</option>
                  <option value="NA1">NA1</option>
                  <option value="KR">KR</option>
                </select>
                <select
                  value={rank}
                  onChange={(event) => setRank(event.target.value)}
                  aria-label="Rank"
                >
                  <option value="ALL">All ranks</option>
                  <option value="CHALLENGER">Challenger</option>
                  <option value="GRANDMASTER">Grandmaster</option>
                  <option value="MASTER">Master</option>
                </select>
                <select
                  value={phase}
                  onChange={(event) => setPhase(event.target.value)}
                  aria-label="Phase"
                >
                  <option value="yunara-third-item">Yunara third item</option>
                  <option value="bot-carry-third-item">Bot carry fallback</option>
                  <option value="minute-window">Around minute 25</option>
                </select>
                <select value={role} onChange={(event) => setRole(event.target.value)}>
                  <option value="ALL">All roles</option>
                  <option>TOP</option>
                  <option>JUNGLE</option>
                  <option>MIDDLE</option>
                  <option>BOTTOM</option>
                  <option>UTILITY</option>
                </select>
                <input
                  placeholder="Champion filter"
                  value={targetChampion}
                  onChange={(event) => setTargetChampion(event.target.value)}
                  onKeyDown={(event) => event.key === "Enter" && void run()}
                />
                <button onClick={() => void run()}>Apply ↵</button>
              </div>
            ) : (
              <div className="manual-fields">
                {(
                  [
                    ["health", "HP"],
                    ["armor", "ARMOR"],
                    ["magicResist", "MR"],
                    ["bonusHealth", "BONUS HP"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key}>
                    <span>{label}</span>
                    <input
                      type="number"
                      value={manual[key]}
                      onChange={(event) =>
                        setManual({ ...manual, [key]: Number(event.target.value) })
                      }
                    />
                  </label>
                ))}
              </div>
            )}
          </div>
          <div className="provenance">
            <span className={data?.dataset?.provenance === "riot" ? "riot-badge" : "fixture-badge"}>
              {data?.dataset?.provenance === "riot" ? "RIOT SNAPSHOTS" : "FIXTURE / DEMO MODE"}
            </span>
            <span>{data?.dataset?.note ?? "Loading target provenance…"}</span>
            {data?.dataset && (
              <span className="quiet">
                {data.dataset.distinctMatchCount ?? 0} distinct match(es) ·{" "}
                {data.dataset.snapshotCount ?? data.dataset.count ?? 0} snapshots ·{" "}
                {data.dataset.uniqueChampions?.length ?? 0} champions
              </span>
            )}
            {data?.dataset?.warning && <span className="warning-text">{data.dataset.warning}</span>}
            {data?.warnings?.map((warning: string) => (
              <span className="warning-text" key={warning}>
                {warning}
              </span>
            ))}
            <span className="assumption">{data?.assumptions}</span>
          </div>
          <div className="selected-target-bar">
            <label>
              <span>SELECTED ACTUAL TARGET TRACE</span>
              <select
                value={selectedTargetId}
                onChange={(event) => {
                  setSelectedTargetId(event.target.value);
                  void run(event.target.value);
                }}
              >
                {(data?.dataset?.targets ?? []).map((target: Target) => (
                  <option value={target.id} key={target.id}>
                    {target.champion} · {target.role ?? "unknown role"} ·{" "}
                    {Math.round(target.health)} HP / {Math.round(target.armor)} armor
                  </option>
                ))}
              </select>
            </label>
            <small>
              Headline uses the whole cohort; this panel and trace use one observed vector. A new
              target selection reuses the cached cohort.
            </small>
          </div>
          <div className="result-grid">
            <ResultCard
              result={resultA}
              label="BUILD A"
              title={buildA.name}
              itemIds={buildA.itemIds}
              thirdItem={thirdA}
              onThirdItemChange={setThirdA}
              winner={winner === buildA.name}
            />
            <div className="versus">VS</div>
            <ResultCard
              result={resultB}
              label="BUILD B"
              title={buildB.name}
              itemIds={buildB.itemIds}
              thirdItem={thirdB}
              onThirdItemChange={setThirdB}
              winner={winner === buildB.name}
            />
          </div>
          <div className="distribution-card">
            <div className="section-head">
              <div>
                <div className="eyebrow">DISTRIBUTION READOUT</div>
                <h3>How often does each build win?</h3>
              </div>
              <span className="quiet">{data?.dataset?.phase ?? "Inspecting snapshots"}</span>
            </div>
            <div className="win-bar">
              <div style={{ width: `${(comparison?.buildAWinRate ?? 0) * 100}%` }} />
              <span>{comparison ? `${Math.round(comparison.buildAWinRate * 100)}%` : "—"}</span>
            </div>
            <div className="win-labels">
              <span>
                <i className="orange-dot" /> Infinity Edge{" "}
                <b>{comparison ? `${comparison.aWins} wins` : "—"}</b>
              </span>
              <span>
                <i className="blue-dot" /> LDR{" "}
                <b>{comparison ? `${comparison.bWins} wins` : "—"}</b>
              </span>
            </div>
            <div className="outcome-line">
              {comparison
                ? `${comparison.ties} ties · ${comparison.censored} censored (both not killed) · ${comparison.aNotKilled}/${comparison.bNotKilled} not killed A/B`
                : "—"}
            </div>
            <div className="stats-grid">
              <Stat
                label="MEDIAN DELTA"
                value={
                  comparison
                    ? `${comparison.medianRelativeDelta > 0 ? "+" : ""}${comparison.medianRelativeDelta}%`
                    : "—"
                }
                hint={metric === "ttk" ? "positive = IE faster" : "IE relative to LDR"}
              />
              <Stat
                label="P25 → P75"
                value={
                  comparison
                    ? `${comparison.p25RelativeDelta}% → ${comparison.p75RelativeDelta}%`
                    : "—"
                }
                hint={metric === "ttk" ? "uncensored kills only" : "spread across targets"}
              />
              <Stat
                label="SAMPLE SIZE"
                value={data?.dataset?.count ?? "—"}
                hint={
                  data?.dataset?.fallbackLevel
                    ? `fallback level ${data.dataset.fallbackLevel}`
                    : "exact Yunara anchors"
                }
              />
            </div>
            <div className="breakdown-strip">
              <span>ROLE BREAKDOWN</span>
              {(comparison?.byRole ?? []).map((group: any) => (
                <b key={group.role}>
                  {group.role} <em>{Math.round(group.buildAWinRate * 100)}% IE</em>
                </b>
              ))}
              {(comparison?.byRole ?? []).length === 0 && <small>Needs 2+ samples per role</small>}
            </div>
            <div className="breakdown-strip champion-breakdown">
              <span>CHAMPION BREAKDOWN</span>
              {(comparison?.byChampion ?? []).map((group: any) => (
                <b key={group.champion}>
                  {group.champion} <em>{Math.round(group.buildAWinRate * 100)}% IE</em>
                </b>
              ))}
              {(comparison?.byChampion ?? []).length === 0 && (
                <small>Needs duplicate observations</small>
              )}
            </div>
          </div>
          <div className="lower-grid">
            <div className="target-card">
              <div className="section-head">
                <div>
                  <div className="eyebrow">TARGET SNAPSHOT SUMMARY</div>
                  <h3>Observed enemy stats</h3>
                </div>
                <span className="quiet">median · p25 / p75</span>
              </div>
              <SummaryTable summary={data?.dataset?.summary} />
            </div>
            <div className="breakpoint-card">
              <div className="section-head">
                <div>
                  <div className="eyebrow">BREAKPOINT MAP</div>
                  <h3>Where LDR catches up</h3>
                </div>
                <span className="quiet">5s damage delta</span>
              </div>
              <BreakpointTable rows={data?.breakpoints ?? []} />
            </div>
          </div>
          <div className="audit-card">
            <button className="audit-toggle" onClick={() => setShowLog(!showLog)}>
              <span>
                <span className="eyebrow">DEBUG TRACE</span>
                <strong>Inspect damage events & modifiers</strong>
              </span>
              <b>{showLog ? "⌃" : "⌄"}</b>
            </button>
            {showLog && (
              <div className="event-log">
                {(resultA?.events ?? []).slice(0, 30).map((event: any, index: number) => (
                  <div className="event-row" key={`${event.time}-${index}`}>
                    <time>{event.time.toFixed(2)}s</time>
                    <strong>{event.source}</strong>
                    <span className={`damage-type ${event.type}`}>{event.type}</span>
                    <span>
                      {event.raw} → <b>{event.final}</b>
                    </span>
                    <small>{event.notes.join(" · ")}</small>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
      <footer>
        Rift Delta is an independent project and is not endorsed by Riot Games or anyone officially
        involved in producing or managing League of Legends. League of Legends and Riot Games are
        trademarks or registered trademarks of Riot Games, Inc.
      </footer>
    </main>
  );
}

function ResultCard({
  result,
  label,
  title,
  itemIds,
  thirdItem,
  onThirdItemChange,
  winner,
}: {
  result: any;
  label: string;
  title: string;
  itemIds: number[];
  thirdItem: 3031 | 3036;
  onThirdItemChange: (id: 3031 | 3036) => void;
  winner: boolean;
}) {
  return (
    <article className={`result-card ${winner ? "winner" : ""}`}>
      <div className="result-card-head">
        <span className="eyebrow">{label}</span>
        {winner && <span className="winner-badge">LEADS</span>}
      </div>
      <div className="result-title-row">
        <h3>{title}</h3>
        <select
          aria-label={`${label} third item`}
          className="item-select"
          value={thirdItem}
          onChange={(event) => onThirdItemChange(Number(event.target.value) as 3031 | 3036)}
        >
          <option value={3031}>IE</option>
          <option value={3036}>LDR</option>
        </select>
      </div>
      <div className="items">
        {itemIds.map((id) => (
          <span className="item-icon" key={id} title={itemNames[id]}>
            <Image src={`${ICON}${itemIcons[id]}`} alt="" width={27} height={27} unoptimized />
          </span>
        ))}
      </div>
      <div className="big-number">
        {result ? result.totalDamage.toLocaleString() : "—"}
        <small>total damage</small>
      </div>
      <div className="cost-line">Listed build cost: {goldTotal(itemIds).toLocaleString()}g</div>
      <div className="card-stats">
        <span>
          <b>{result ? result.dps.toLocaleString() : "—"}</b> DPS
        </span>
        <span>
          <b>{result?.ttk !== null && result?.ttk !== undefined ? `${result.ttk}s` : "censored"}</b>{" "}
          TTK
        </span>
        <span>
          <b>
            {result && result.totalDamage > 0
              ? `${Math.round((result.split.physical / result.totalDamage) * 100)}%`
              : "—"}
          </b>{" "}
          physical
        </span>
      </div>
      {result && (
        <div className="kill-line">
          {result.killed ? `Killed at ${result.ttk}s` : "Not killed in window"} · overkill{" "}
          {result.overkill}
        </div>
      )}
      <div className="source-list">
        {result &&
          Object.entries(result.sources)
            .slice(0, 4)
            .map(([source, value]) => (
              <div key={source}>
                <span>{source}</span>
                <b>{Number(value).toLocaleString()}</b>
              </div>
            ))}
      </div>
    </article>
  );
}
function goldTotal(itemIds: number[]) {
  const costs: Record<number, number> = {
    6672: 3100,
    3085: 2650,
    3006: 1100,
    3031: 3500,
    3036: 3000,
  };
  return itemIds.reduce((total, id) => total + (costs[id] ?? 0), 0);
}

function summarizeTargetValues(targets: Array<Record<string, unknown>>) {
  const keys = ["health", "bonusHealth", "armor", "magicResist", "level", "minute"] as const;
  return Object.fromEntries(
    keys.map((key) => {
      const values = targets.map((target) => Number(target[key] ?? 0)).sort((a, b) => a - b);
      const at = (p: number) =>
        values[Math.min(values.length - 1, Math.floor((values.length - 1) * p))] ?? 0;
      return [key, { p25: at(0.25), median: at(0.5), p75: at(0.75) }];
    }),
  );
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint: string }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </div>
  );
}
function SummaryTable({ summary }: { summary: any }) {
  if (!summary) return <div className="empty">Waiting for snapshots…</div>;
  return (
    <div className="summary-table">
      {[
        ["Health", "health"],
        ["Bonus health", "bonusHealth"],
        ["Armor", "armor"],
        ["Magic resist", "magicResist"],
        ["Level", "level"],
        ["Game minute", "minute"],
      ].map(([label, key]) => (
        <div className="summary-row" key={key}>
          <span>{label}</span>
          <b>{summary[key].median}</b>
          <small>
            {summary[key].p25} — {summary[key].p75}
          </small>
        </div>
      ))}
    </div>
  );
}
function BreakpointTable({ rows }: { rows: any[] }) {
  const armorValues = [...new Set(rows.map((row) => row.armor))];
  const healthValues = [...new Set(rows.map((row) => row.bonusHealth))];
  if (!rows.length) return <div className="empty">Waiting for calculation…</div>;
  return (
    <div className="breakpoint-table">
      <div className="bp-row bp-head">
        <span>ARMOR \ BONUS HP</span>
        {healthValues.map((value) => (
          <b key={value}>{value}</b>
        ))}
      </div>
      {armorValues.map((armor) => (
        <div className="bp-row" key={armor}>
          <span>{armor}</span>
          {healthValues.map((health) => {
            const row = rows.find(
              (candidate) => candidate.armor === armor && candidate.bonusHealth === health,
            );
            return (
              <b className={row?.delta >= 0 ? "ie-cell" : "ldr-cell"} key={health}>
                {row ? `${row.delta >= 0 ? "+" : "−"}${Math.abs(Math.round(row.delta))}` : "—"}
              </b>
            );
          })}
        </div>
      ))}
    </div>
  );
}
