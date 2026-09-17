"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import type { ActionKind, Target } from "@/domain/types";
import { weightedHeadlineWinner } from "@/domain/simulator";
import { buildGoldTotal, itemWarnings, ITEMS } from "@/domain/items";
import { defaultSkillRanks, skillBounds, tryAdjustSkillRank } from "@/domain/skills";
import type {
  WorkerSimulationRequest,
  WorkerSimulationResponse,
} from "@/workers/simulation.worker";

const ICON = "https://ddragon.leagueoflegends.com/cdn/16.18.1/img/item/";
const itemNames: Record<number, string> = {
  6672: "Kraken Slayer",
  3085: "Runaan's Hurricane",
  3006: "Berserker's Greaves",
  3008: "Gluttonous Greaves",
  2523: "Hexoptics C44",
  3032: "Yun Tal Wildarrows",
  3031: "Infinity Edge",
  3036: "Lord Dominik's Regards",
};
const itemIcons: Record<number, string> = {
  6672: "6672.png",
  3085: "3085.png",
  3006: "3006.png",
  3008: "3008.png",
  2523: "2523.png",
  3032: "3032.png",
  3031: "3031.png",
  3036: "3036.png",
  3046: "3046.png",
  3072: "3072.png",
  3095: "3095.png",
  3153: "3153.png",
  3302: "3302.png",
  3026: "3026.png",
  3139: "3139.png",
  3033: "3033.png",
  2512: "2512.png",
};
const SUPPORTED_BUILD_ITEMS = Object.keys(ITEMS)
  .map(Number)
  .sort((left, right) => left - right);
const INITIAL_REALISTIC_BUILD = [6672, 3085, 3006];
const WINDOWS = [2, 5, 10, 20] as const;
const COMBO_PRESETS: Array<{
  id: string;
  label: string;
  actions: ActionKind[];
  continueAutos: boolean;
}> = [
  { id: "autos", label: "Autos", actions: ["AA"], continueAutos: true },
  { id: "q-autos", label: "Q → autos", actions: ["Q"], continueAutos: true },
  { id: "r-q-w", label: "R → Q → W → autos", actions: ["R", "Q", "W"], continueAutos: true },
];

type ResponseData = any;

interface MatrixRow {
  key: string;
  label: string;
  detail: string;
  n: number;
  delta: number | null;
  outcome: "a" | "b" | "tie";
}

export default function Home() {
  const [level, setLevel] = useState(13);
  const [duration, setDuration] = useState(5);
  const [metric, setMetric] = useState<"damage" | "ttk">("damage");
  const [targetMode, setTargetMode] = useState<"realistic" | "manual">("realistic");
  const [region, setRegion] = useState("EUW1");
  const [rank, setRank] = useState("ALL");
  const [phase, setPhase] = useState("yunara-level");
  const [role, setRole] = useState("ALL");
  const [targetChampion, setTargetChampion] = useState("");
  const [selectedTargetId, setSelectedTargetId] = useState("");
  const [continueAutos, setContinueAutos] = useState(true);
  const [yunTalStacks, setYunTalStacks] = useState(0);
  const [buildAItems, setBuildAItems] = useState<number[]>(INITIAL_REALISTIC_BUILD);
  const [buildBItems, setBuildBItems] = useState<number[]>(INITIAL_REALISTIC_BUILD);
  const [buildsEdited, setBuildsEdited] = useState(false);
  const [progression, setProgression] = useState<any>(null);
  const [progressionLoading, setProgressionLoading] = useState(true);
  const [progressionError, setProgressionError] = useState("");
  const [ranks, setRanks] = useState(() => defaultSkillRanks(13));
  const [actions, setActions] = useState<ActionKind[]>(["R", "Q", "W", "AA", "AA"]);
  const [manual, setManual] = useState({
    health: 2200,
    armor: 100,
    magicResist: 60,
    bonusHealth: 500,
    level: 13,
  });
  const [data, setData] = useState<ResponseData>();
  const [matrix, setMatrix] = useState<MatrixRow[] | null>(null);
  const [matrixLoading, setMatrixLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showLog, setShowLog] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const cohortRef = useRef<{ key: string; payload: any } | null>(null);
  const progressionCacheRef = useRef(new Map<number, any>());
  const buildsEditedRef = useRef(false);
  const ranksEditedRef = useRef(false);
  const comboEditedRef = useRef(false);

  const buildA = useMemo(
    () => ({ name: buildDisplayName(buildAItems, "Build A"), itemIds: buildAItems }),
    [buildAItems],
  );
  const buildB = useMemo(
    () => ({ name: buildDisplayName(buildBItems, "Build B"), itemIds: buildBItems }),
    [buildBItems],
  );

  useEffect(() => {
    let active = true;
    async function loadProgression() {
      setProgressionLoading(true);
      setProgressionError("");
      try {
        const cached = progressionCacheRef.current.get(level);
        const next =
          cached ??
          (await fetch(`/api/progression?champion=Yunara&level=${level}`, {
            headers: { accept: "application/json" },
          }).then(async (response) => {
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error ?? "Progression query failed");
            progressionCacheRef.current.set(level, payload);
            return payload;
          }));
        if (!active) return;
        setProgression(next);
        if (!ranksEditedRef.current) {
          const observedRanks = next.skill?.ranks;
          setRanks(
            observedRanks && isLegalRankShape(observedRanks, level)
              ? observedRanks
              : defaultSkillRanks(level),
          );
        }
        if (!comboEditedRef.current) {
          setActions(defaultActionsForLevel(level));
          setContinueAutos(true);
        }
        if (!buildsEditedRef.current) {
          const recommended = recommendedBuild(next);
          setBuildAItems(recommended);
          setBuildBItems(recommended);
        }
      } catch (caught) {
        if (active)
          setProgressionError(caught instanceof Error ? caught.message : "Progression unavailable");
      } finally {
        if (active) setProgressionLoading(false);
      }
    }
    void loadProgression();
    return () => {
      active = false;
    };
  }, [level]); // manual build edits intentionally do not trigger a default overwrite

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
      const base = {
        level,
        ranks,
        durationSeconds: duration,
        actions,
        continueAutos,
        yunTalStacks,
        targetMode: "mortal" as const,
      };
      const request: WorkerSimulationRequest = {
        id: ++requestIdRef.current,
        base,
        buildA,
        buildB,
        targets,
        selectedTargetId: selectedOverride ?? selectedTargetId,
        metric,
      };
      const result = await runWorker(request);
      const simulationWarnings = [
        "Expected crit mode averages crits; it is not a kill probability.",
        "Yunara E is unsupported for damage, and Runaan's bolts are excluded for this single-target comparison.",
        "Builds are compared at listed costs, not equal gold.",
        "Mortal-target mode stops at death; fixed-window applied damage excludes overkill.",
        "Expected-crit TTK is a first-crossing model, not a kill probability.",
        ...result.representative.a.warnings,
        ...result.representative.b.warnings,
      ].filter((warning, index, warnings) => warnings.indexOf(warning) === index);
      setData({
        patch: "26.18",
        dataVersion: "16.18.1",
        engineVersion: "yunara-engine-v1",
        assumptions: `Level ${level} / Q${ranks.q} W${ranks.w} E${ranks.e} R${ranks.r}, expected crits, Yun Tal starts at ${yunTalStacks}/125 ranged stacks.`,
        warnings: simulationWarnings,
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
      await runMatrix(base, targets, result.comparison);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Simulation failed");
    } finally {
      setLoading(false);
    }
  }

  async function runMatrix(
    base: WorkerSimulationRequest["base"],
    targets: Target[],
    main: WorkerSimulationResponse["comparison"],
  ) {
    if (targetMode !== "realistic" || targets.length < 6) {
      setMatrix(null);
      return;
    }
    setMatrixLoading(true);
    try {
      const take = Math.max(2, Math.ceil(targets.length / 3));
      const topBy = (pick: (target: Target) => number) =>
        [...targets].sort((x, y) => pick(y) - pick(x)).slice(0, take);
      const groups = [
        {
          key: "hp",
          label: "HP-heavy draft",
          detail: "Top third by bonus HP",
          list: topBy((t) => t.bonusHealth),
        },
        {
          key: "armor",
          label: "Armor-heavy draft",
          detail: "Top third by armor",
          list: topBy((t) => t.armor),
        },
        {
          key: "mr",
          label: "MR-heavy draft",
          detail: "Top third by magic resist",
          list: topBy((t) => t.magicResist),
        },
      ];
      const rows: MatrixRow[] = [
        {
          key: "avg",
          label: "Average draft",
          detail: `${targets.length} snapshots`,
          n: targets.length,
          delta: main.medianRelativeDelta,
          outcome: weightedHeadlineWinner(main),
        },
      ];
      for (const group of groups) {
        const response = await runWorker({
          id: ++requestIdRef.current,
          base,
          buildA,
          buildB,
          targets: group.list,
          metric,
        });
        rows.push({
          key: group.key,
          label: group.label,
          detail: `${group.list.length} snapshots`,
          n: group.list.length,
          delta: response.comparison.medianRelativeDelta,
          outcome: weightedHeadlineWinner(response.comparison),
        });
      }
      setMatrix(rows);
    } catch {
      setMatrix(null);
    } finally {
      setMatrixLoading(false);
    }
  }

  async function loadCohort(): Promise<any> {
    const key = JSON.stringify({
      targetMode,
      region,
      rank,
      phase,
      role,
      targetChampion,
      level,
      manual,
    });
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
        body: JSON.stringify({
          region,
          rank,
          phase,
          role,
          champion: targetChampion,
          level,
          limit: 1000,
        }),
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

  // Recompute from the cached cohort whenever an input changes; the champion
  // text field and manualRun-only edits commit through their Apply buttons.
  const autoKey = JSON.stringify({
    level,
    duration,
    metric,
    targetMode,
    region,
    rank,
    phase,
    role,
    buildAItems,
    buildBItems,
    ranks,
    actions,
    continueAutos,
    yunTalStacks,
    manual,
    selectedTargetId,
  });
  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    const timer = setTimeout(() => void run(), 280);
    return () => clearTimeout(timer);
  }, [autoKey]);
  /* eslint-enable react-hooks/exhaustive-deps */

  function addAction(action: ActionKind) {
    if (!actionAvailable(action, level)) return;
    comboEditedRef.current = true;
    setActions((current) => [...current, action]);
  }
  function removeAction(index: number) {
    comboEditedRef.current = true;
    setActions((current) => current.filter((_, i) => i !== index));
  }

  function moveAction(index: number, direction: -1 | 1) {
    comboEditedRef.current = true;
    setActions((current) => {
      const destination = index + direction;
      if (destination < 0 || destination >= current.length) return current;
      const next = [...current];
      [next[index], next[destination]] = [next[destination]!, next[index]!];
      return next;
    });
  }

  function applyComboPreset(preset: (typeof COMBO_PRESETS)[number]) {
    const legal = preset.actions.filter((action) => actionAvailable(action, level));
    comboEditedRef.current = true;
    setActions(legal.length ? legal : ["AA"]);
    setContinueAutos(preset.continueAutos);
  }

  function adjustRank(key: "q" | "w" | "e" | "r", delta: number) {
    const next = tryAdjustSkillRank(ranks, level, key, delta);
    if (!next) return;
    ranksEditedRef.current = true;
    setRanks(next);
  }

  function markBuildEdited() {
    buildsEditedRef.current = true;
    setBuildsEdited(true);
  }

  function updateBuild(side: "a" | "b", index: number, value: number | null) {
    markBuildEdited();
    const setter = side === "a" ? setBuildAItems : setBuildBItems;
    setter((current) => {
      if (value === null) return current.filter((_, itemIndex) => itemIndex !== index);
      const next = [...current];
      next[index] = value;
      return next.length > 0 ? next : [value];
    });
  }

  function addBuildItem(side: "a" | "b") {
    markBuildEdited();
    const setter = side === "a" ? setBuildAItems : setBuildBItems;
    setter((current) => (current.length >= 6 ? current : [...current, SUPPORTED_BUILD_ITEMS[0]!]));
  }

  function resetRealisticBuild() {
    const recommended = recommendedBuild(progression);
    setBuildAItems(recommended);
    setBuildBItems(recommended);
    buildsEditedRef.current = false;
    setBuildsEdited(false);
    ranksEditedRef.current = false;
    comboEditedRef.current = false;
    setRanks(
      progression?.skill?.ranks && isLegalRankShape(progression.skill.ranks, level)
        ? progression.skill.ranks
        : defaultSkillRanks(level),
    );
    setActions(defaultActionsForLevel(level));
    setContinueAutos(true);
    setYunTalStacks(0);
  }

  function setIeLdrComparison() {
    markBuildEdited();
    const baseline = progression ? recommendedBuild(progression) : INITIAL_REALISTIC_BUILD;
    const completed = baseline.filter((id) => !isBootItem(id) && id !== 3031 && id !== 3036);
    const core = [...new Set(completed)];
    const withBoot = [...core, ...baseline.filter((id) => isBootItem(id))];
    setBuildAItems([...withBoot, 3031]);
    setBuildBItems([...withBoot, 3036]);
  }

  const resultA = data?.results?.a;
  const resultB = data?.results?.b;
  const comparison = data?.results?.comparison;
  const headlineOutcome = comparison ? weightedHeadlineWinner(comparison) : "tie";
  const winnerName =
    headlineOutcome === "a" ? buildA.name : headlineOutcome === "b" ? buildB.name : null;
  const scope = targetMode === "manual" ? "custom target" : `real level-${level} enemy cohort`;
  const verdictTitle = winnerName ? (
    <>
      <span className="winner">{winnerName}</span> leads the {scope}
    </>
  ) : (
    <>The builds are tied on the {scope}</>
  );
  const delta = comparison?.medianRelativeDelta ?? 0;
  const signed = `${delta > 0 ? "+" : delta < 0 ? "−" : ""}${Math.abs(delta)}%`;
  const verdictSub = comparison
    ? comparisonSentence(comparison, {
        buildA: buildA.name,
        buildB: buildB.name,
        duration,
        level,
        metric,
        distinctMatchCount: data?.dataset?.distinctMatchCount ?? comparison.distinctMatchCount,
      })
    : "Loading the level-matched target cohort…";

  return (
    <main className="page">
      <header className="top">
        <div className="top-in">
          <span className="logo" aria-hidden>
            Δ
          </span>
          <strong>Rift Delta</strong>
          <nav aria-label="Sections">
            <a href="#verdict">Lab</a>
            <a href="#drafts">Drafts</a>
            <a href="#trace">Traces</a>
          </nav>
          <div className="top-right">
            <span className="pill pill-gold">Patch 26.18 · 16.18.1</span>
            <span className="pill">
              <span className="dot" aria-hidden /> Engine ready
            </span>
          </div>
        </div>
      </header>

      <div className="wrap">
        <section className="card verdict" id="verdict" aria-live="polite">
          <div>
            <h1>{loading && !comparison ? "Computing the verdict…" : verdictTitle}</h1>
            <p>
              <strong>{verdictSub}</strong>
              {" · "}Level-aware attacker inventory{" · "}R-Q-W-AA-AA + autos{" · "}
              {buildGoldTotal(buildB.itemIds).toLocaleString()}g vs{" "}
              {buildGoldTotal(buildA.itemIds).toLocaleString()}g
            </p>
          </div>
          <div className="segs" role="group" aria-label="Fight length">
            {WINDOWS.map((value) => (
              <button
                key={value}
                className={duration === value ? "on" : ""}
                onClick={() => setDuration(value)}
                aria-pressed={duration === value}
              >
                {value}s
              </button>
            ))}
          </div>
        </section>

        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}

        <section aria-labelledby="builds-h">
          <h2 id="builds-h">Build comparison</h2>
          <p className="sub">
            Same opener, same targets, mortal-target rules. The winner is computed over the whole
            cohort.
          </p>
          <div className="build-actions">
            <button className="ghost-btn" onClick={resetRealisticBuild} disabled={!progression}>
              Use realistic level default
            </button>
            <button className="ghost-btn" onClick={setIeLdrComparison}>
              Compare IE vs LDR
            </button>
            {buildsEdited && (
              <span className="dim">Manual build edits are preserved on level changes.</span>
            )}
          </div>
          {progression && unsupportedObservedDefaults(progression).length > 0 && (
            <p className="warn build-default-warning" role="status">
              The realistic level default observed{" "}
              {progression.selection.recommendedObservedItemIds.length} completed items, but{" "}
              {unsupportedObservedDefaults(progression).join(", ")}{" "}
              {unsupportedObservedDefaults(progression).length === 1 ? "is" : "are"} not modeled by
              the combat engine. It is excluded from both builds; damage uses the nearest supported
              observed subset and does not treat the omitted item as statless. Choose a supported
              item manually if you want a different comparison.
            </p>
          )}
          <div className="duel">
            <BuildCard
              side="a"
              name={buildA.name}
              itemIds={buildA.itemIds}
              cost={buildGoldTotal(buildA.itemIds)}
              result={resultA}
              onChange={updateBuild}
              onAdd={addBuildItem}
              tag={headlineOutcome === "a" ? "WINNER" : "2ND"}
              leads={headlineOutcome === "a"}
              maxSource={maxSource(resultA, resultB)}
              rarity={buildRarity(progression, buildA.itemIds)}
              warnings={itemWarnings(buildA.itemIds)}
            />
            <div className="vs" aria-hidden>
              <span>VS</span>
            </div>
            <BuildCard
              side="b"
              name={buildB.name}
              itemIds={buildB.itemIds}
              cost={buildGoldTotal(buildB.itemIds)}
              result={resultB}
              onChange={updateBuild}
              onAdd={addBuildItem}
              tag={headlineOutcome === "b" ? "WINNER" : "2ND"}
              leads={headlineOutcome === "b"}
              maxSource={maxSource(resultA, resultB)}
              rarity={buildRarity(progression, buildB.itemIds)}
              warnings={itemWarnings(buildB.itemIds)}
            />
          </div>
          <div className="card dist">
            <div
              className="winbar"
              role="img"
              aria-label={`Build A wins ${Math.round((comparison?.buildAWinRate ?? 0) * 100)} percent of cohort mass`}
            >
              <i style={{ width: `${(comparison?.buildAWinRate ?? 0) * 100}%` }} />
            </div>
            <div className="winlbl">
              <span>
                <strong>{buildA.name}</strong> {aWinsLabel(comparison)}
              </span>
              <span>
                <strong>{buildB.name}</strong> {bWinsLabel(comparison)}
              </span>
            </div>
            <div className="dist-meta">
              <span>
                Median <strong>{comparison ? `${signed}` : "—"}</strong>
                {metric === "ttk" ? " first-crossing" : " damage"}
              </span>
              <span>
                P25 → P75{" "}
                <strong>
                  {comparison
                    ? `${comparison.p25RelativeDelta}% → ${comparison.p75RelativeDelta}%`
                    : "—"}
                </strong>
              </span>
              <span>
                Sample <strong>{data?.dataset?.count ?? "—"}</strong>
                {data?.dataset?.fallbackLevel
                  ? ` · fallback level ${data.dataset.fallbackLevel}`
                  : ""}
              </span>
              <span>
                {comparison
                  ? `${comparison.ties} ties · ${comparison.censored} censored · ${comparison.aNotKilled}/${comparison.bNotKilled} not killed A/B`
                  : "Inspecting snapshots"}
              </span>
            </div>
            <div className="chips-row" aria-label="Role breakdown">
              <span className="chips-label">Roles</span>
              {(comparison?.byRole ?? []).map((group: any) => (
                <span className="chip" key={group.role}>
                  {group.role} <strong>{Math.round(group.buildAWinRate * 100)}% A</strong>
                </span>
              ))}
              {(comparison?.byRole ?? []).length === 0 && (
                <span className="dim">Needs 2+ samples per role</span>
              )}
            </div>
            <div className="chips-row" aria-label="Champion breakdown">
              <span className="chips-label">Champions</span>
              {(comparison?.byChampion ?? []).map((group: any) => (
                <span className="chip" key={group.champion}>
                  {group.champion} <strong>{Math.round(group.buildAWinRate * 100)}% A</strong>
                </span>
              ))}
              {(comparison?.byChampion ?? []).length === 0 && (
                <span className="dim">Needs duplicate observations</span>
              )}
            </div>
          </div>
        </section>

        <section className="card progression-panel" aria-labelledby="progression-h">
          <div className="section-head">
            <div>
              <h2 id="progression-h">Yunara inventory at level {level}</h2>
              <p className="sub">
                Attacker progression comes from Yunara snapshots; it is independent of the enemy
                target cohort used for damage.
              </p>
            </div>
            <span className="pill">Patch 26.18 · Data Dragon 16.18.1</span>
          </div>
          {progressionLoading && <p className="dim">Loading observed inventory states…</p>}
          {progressionError && (
            <p className="warn">{progressionError} Using the last known/default state.</p>
          )}
          {progression && (
            <>
              <div className="progression-stats">
                <span>
                  <strong>{progression.exactLevel.sampleCount}</strong> exact-level observations
                </span>
                <span>
                  <strong>{progression.exactLevel.distinctMatchCount}</strong> distinct matches
                </span>
                <span>
                  Mean <strong>{progression.selection.meanCompletedLegendary.toFixed(2)}</strong>
                </span>
                <span>
                  Median <strong>{progression.selection.medianCompletedLegendary}</strong>
                </span>
                <span>
                  Mode <strong>{progression.selection.modeCompletedLegendary}</strong>
                </span>
              </div>
              <p className="dim progression-note">
                {progression.selection.fallbackUsed
                  ? progression.selection.fallbackLabel
                  : "Exact level sample used."}
                {progression.selection.lowSample
                  ? " Low-sample estimate (fewer than 20 exact observations)."
                  : ""}{" "}
                {progression.dedupeRule}
              </p>
              <div className="skill-summary" role="status">
                <strong>
                  Common skill ranks: Q{progression.skill.ranks.q} W{progression.skill.ranks.w} E
                  {progression.skill.ranks.e} R{progression.skill.ranks.r}
                </strong>
                <span>
                  {progression.skill.provenance === "timeline"
                    ? "Archived timeline-derived"
                    : "Legal fallback"}
                  {progression.skill.sampleCount > 0 ? ` · n=${progression.skill.sampleCount}` : ""}
                  . {progression.skill.note}
                </span>
              </div>
              <div className="progression-grid">
                <div>
                  <h3>Completed legendary count</h3>
                  <div className="distribution-list">
                    {progression.selection.distribution.map((row: any) => (
                      <span key={row.count}>
                        <strong>{row.count}</strong> items · {row.observations} ({row.percent}%)
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <h3>Common observed core</h3>
                  <div className="distribution-list">
                    {progression.selection.commonPatterns.slice(0, 3).map((pattern: any) => (
                      <span key={pattern.itemIds.join(",")}>
                        {pattern.itemNames.join(" + ") || "No completed legendary"} ·{" "}
                        {pattern.percent}%
                      </span>
                    ))}
                  </div>
                  <p className="dim">
                    Boots are separate:{" "}
                    {progression.selection.commonBootId
                      ? (itemNames[progression.selection.commonBootId] ??
                        `item ${progression.selection.commonBootId}`)
                      : "none observed"}{" "}
                    ({progression.selection.commonBootTier}). Components/wards do not count as
                    legendaries.
                  </p>
                </div>
              </div>
              <p className="provenance">
                {progression.provenance === "riot"
                  ? "Observed verified Riot timeline snapshots"
                  : "Fixture / demo inventory progression"}
                . {progression.note}
              </p>
              <p className="dim">
                Mode observed completed core:{" "}
                {progression.selection.recommendedObservedItemIds
                  .map((id: number) => itemNames[id] ?? ITEMS[id]?.name ?? `item ${id}`)
                  .join(" + ") || "none"}
                . The simulated default uses only supported mechanics; observed unsupported items
                stay visible in the pattern but are not fabricated into damage.
              </p>
              <p className="progression-interpretation">
                The level-{level} default uses the modal full core:{" "}
                <strong>
                  {progression.selection.modeCompletedLegendary} completed legendary items
                </strong>
                . Boots and components are shown separately and never increase that count.
              </p>
            </>
          )}
        </section>

        {targetMode === "realistic" && (
          <section aria-labelledby="drafts-h" id="drafts">
            <h2 id="drafts-h">Enemy draft matrix</h2>
            <p className="sub">
              The same question against heavier drafts — each row is a real re-simulation over that
              slice of the cohort.
            </p>
            <div className="card">
              {matrixLoading && !matrix && <p className="dim">Simulating draft slices…</p>}
              {(matrix ?? []).map((row) => (
                <div className="mrow" key={row.key}>
                  <span>
                    {row.label}
                    <small>{row.detail}</small>
                  </span>
                  <span className="track" aria-hidden>
                    {row.delta !== null && (
                      <i
                        className={row.delta >= 0 ? "pos" : "neg"}
                        style={
                          row.delta >= 0
                            ? { left: "50%", width: `${Math.min(50, Math.abs(row.delta) * 2.4)}%` }
                            : { right: "50%", width: `${Math.min(50, Math.abs(row.delta) * 2.4)}%` }
                        }
                      />
                    )}
                  </span>
                  <span
                    className={`delta ${row.outcome === "tie" ? "" : row.delta !== null && row.delta >= 0 ? "u" : "d"}`}
                  >
                    {row.delta === null
                      ? "—"
                      : row.outcome === "tie"
                        ? "Tie"
                        : `${row.outcome === "a" ? buildA.name : buildB.name} ${formatDelta(row.delta)}`}
                  </span>
                </div>
              ))}
              {!matrixLoading && !matrix && (
                <p className="dim">Needs 6+ snapshots to slice the cohort.</p>
              )}
            </div>
          </section>
        )}

        <section aria-labelledby="setup-h">
          <h2 id="setup-h">Setup</h2>
          <p className="sub">
            Attacker, opener, and target. Everything recomputes from the cached cohort.
          </p>
          <div className="setup">
            <div className="card">
              <h3>Attacker · Yunara</h3>
              <label className="fl" htmlFor="level">
                Level
              </label>
              <select
                id="level"
                value={level}
                onChange={(event) => setLevel(Number(event.target.value))}
              >
                {Array.from({ length: 18 }, (_, i) => (
                  <option key={i + 1}>{i + 1}</option>
                ))}
              </select>
              <span className="fl">Ability ranks</span>
              <div className="ranks" role="group" aria-label="Ability ranks">
                {(["q", "w", "e", "r"] as const).map((key) => (
                  <div className="rank" key={key}>
                    <span>{key.toUpperCase()}</span>
                    <div className="stepper">
                      <button
                        aria-label={`Decrease ${key}`}
                        disabled={ranks[key] <= skillBounds(level)[key].min}
                        onClick={() => adjustRank(key, -1)}
                      >
                        −
                      </button>
                      <strong
                        title={`Legal range ${skillBounds(level)[key].min}–${skillBounds(level)[key].max}`}
                      >
                        {ranks[key]}
                      </strong>
                      <button
                        aria-label={`Increase ${key}`}
                        disabled={ranks[key] >= skillBounds(level)[key].max}
                        onClick={() => adjustRank(key, 1)}
                      >
                        +
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <label className="fl" htmlFor="yun-tal-stacks">
                Yun Tal starting stacks (ranged)
              </label>
              <input
                id="yun-tal-stacks"
                type="number"
                min={0}
                max={125}
                step={1}
                value={yunTalStacks}
                onChange={(event) =>
                  setYunTalStacks(
                    Math.max(0, Math.min(125, Math.round(Number(event.target.value) || 0))),
                  )
                }
              />
              <p className="dim" style={{ marginTop: 10 }}>
                Patch pinned to 26.18 · level changes load the common archived skill pattern when
                available; manual edits are preserved · E is mobility-only · 3032 starts at the
                explicit stack value above because stored frames do not expose crit chance.
              </p>
            </div>

            <div className="card">
              <h3>Opener</h3>
              <div className="preset-row" aria-label="Simulator combo presets">
                {COMBO_PRESETS.map((preset) => (
                  <button key={preset.id} onClick={() => applyComboPreset(preset)}>
                    {preset.label}
                  </button>
                ))}
              </div>
              <div className="opener">
                {actions.map((action, index) => (
                  <span className="op-wrap" key={`${action}-${index}`}>
                    <button
                      className="op"
                      onClick={() => removeAction(index)}
                      title="Remove action"
                    >
                      {action} <small aria-hidden>×</small>
                    </button>
                    <button
                      className="op-move"
                      aria-label={`Move ${action} ${index === 0 ? "down" : "up"}`}
                      onClick={() => moveAction(index, index === 0 ? 1 : -1)}
                    >
                      {index === 0 ? "↓" : "↑"}
                    </button>
                  </span>
                ))}
              </div>
              <div className="addrow">
                {(["AA", "Q", "W", "R", "E"] as ActionKind[]).map((action) => (
                  <button
                    key={action}
                    onClick={() => addAction(action)}
                    disabled={!actionAvailable(action, level)}
                  >
                    + {action}
                  </button>
                ))}
              </div>
              <p className="dim">E can be sequenced for timing, but remains mobility-only and contributes no damage in this MVP.</p>
              {!actions.every((action) => actionAvailable(action, level)) && (
                <p className="warn">
                  This opener contains an ability unavailable at level {level}; choose a preset or
                  remove it.
                </p>
              )}
              <span className="fl">After the opener</span>
              <div className="toggle" role="group" aria-label="Continue autos">
                <button
                  className={continueAutos ? "on" : ""}
                  onClick={() => setContinueAutos(true)}
                  aria-pressed={continueAutos}
                >
                  Keep autoing
                </button>
                <button
                  className={!continueAutos ? "on" : ""}
                  onClick={() => setContinueAutos(false)}
                  aria-pressed={!continueAutos}
                >
                  Stop
                </button>
              </div>
              <label className="fl" htmlFor="duration">
                Window (seconds)
              </label>
              <input
                id="duration"
                type="number"
                min={1}
                max={60}
                value={duration}
                onChange={(event) => setDuration(Number(event.target.value))}
              />
              <button className="run" onClick={() => void run()} disabled={loading}>
                {loading ? "Calculating…" : "Run comparison"}
              </button>
            </div>

            <div className="card">
              <h3>Target</h3>
              <div className="toggle" role="group" aria-label="Target mode">
                <button
                  className={targetMode === "realistic" ? "on" : ""}
                  onClick={() => setTargetMode("realistic")}
                  aria-pressed={targetMode === "realistic"}
                >
                  Realistic
                </button>
                <button
                  className={targetMode === "manual" ? "on" : ""}
                  onClick={() => setTargetMode("manual")}
                  aria-pressed={targetMode === "manual"}
                >
                  Manual
                </button>
              </div>
              {targetMode === "realistic" ? (
                <>
                  <label className="fl" htmlFor="region">
                    Region
                  </label>
                  <select
                    id="region"
                    value={region}
                    onChange={(event) => setRegion(event.target.value)}
                  >
                    <option value="EUW1">EUW1</option>
                    <option value="NA1">NA1</option>
                    <option value="KR">KR</option>
                  </select>
                  <div className="two">
                    <div>
                      <label className="fl" htmlFor="rank">
                        Rank
                      </label>
                      <select
                        id="rank"
                        value={rank}
                        onChange={(event) => setRank(event.target.value)}
                      >
                        <option value="ALL">All ranks</option>
                        <option value="CHALLENGER">Challenger</option>
                        <option value="GRANDMASTER">Grandmaster</option>
                        <option value="MASTER">Master</option>
                      </select>
                    </div>
                    <div>
                      <label className="fl" htmlFor="role">
                        Role
                      </label>
                      <select
                        id="role"
                        value={role}
                        onChange={(event) => setRole(event.target.value)}
                      >
                        <option value="ALL">All roles</option>
                        <option>TOP</option>
                        <option>JUNGLE</option>
                        <option>MIDDLE</option>
                        <option>BOTTOM</option>
                        <option>UTILITY</option>
                      </select>
                    </div>
                  </div>
                  <label className="fl" htmlFor="phase">
                    Timing
                  </label>
                  <select
                    id="phase"
                    value={phase}
                    onChange={(event) => setPhase(event.target.value)}
                  >
                    <option value="yunara-level">Same-frame Yunara level (recommended)</option>
                    <option value="yunara-third-item">Yunara third item</option>
                    <option value="bot-carry-third-item">Bot carry fallback</option>
                    <option value="minute-window">Around minute 25</option>
                  </select>
                  <label className="fl" htmlFor="champ">
                    Champion
                  </label>
                  <div className="apply-row">
                    <input
                      id="champ"
                      type="text"
                      placeholder="Any champion"
                      value={targetChampion}
                      onChange={(event) => setTargetChampion(event.target.value)}
                      onKeyDown={(event) => event.key === "Enter" && void run()}
                    />
                    <button onClick={() => void run()}>Apply</button>
                  </div>
                </>
              ) : (
                <div className="two" style={{ marginTop: 4 }}>
                  {(
                    [
                      ["health", "HP"],
                      ["armor", "Armor"],
                      ["magicResist", "MR"],
                      ["bonusHealth", "Bonus HP"],
                    ] as const
                  ).map(([key, label]) => (
                    <div key={key}>
                      <label className="fl" htmlFor={`m-${key}`}>
                        {label}
                      </label>
                      <input
                        id={`m-${key}`}
                        type="number"
                        value={manual[key]}
                        onChange={(event) =>
                          setManual({ ...manual, [key]: Number(event.target.value) })
                        }
                      />
                    </div>
                  ))}
                </div>
              )}
              <span className="fl">Metric</span>
              <div className="toggle" role="group" aria-label="Comparison metric">
                <button
                  className={metric === "damage" ? "on" : ""}
                  onClick={() => setMetric("damage")}
                  aria-pressed={metric === "damage"}
                >
                  Damage
                </button>
                <button
                  className={metric === "ttk" ? "on" : ""}
                  onClick={() => setMetric("ttk")}
                  aria-pressed={metric === "ttk"}
                >
                  TTK
                </button>
              </div>
              <p className="dim" style={{ marginTop: 10 }}>
                {metric === "ttk"
                  ? "Lower first-crossing time wins; uncensored kills only."
                  : "Mortal targets stop at death; both kills are an applied-damage tie."}
              </p>
              {targetMode === "realistic" && (
                <p className="provenance">
                  Level {level} loads enemy vectors from the same archived match/frame as the Yunara
                  level observation. Build, combo, rank, and stack edits reuse this cohort;
                  level/filter changes fetch a new one.
                </p>
              )}
            </div>
          </div>
        </section>

        <section className="card" aria-labelledby="trace-h" id="trace">
          <h2 id="trace-h">Damage trace</h2>
          <p className="sub">
            One observed vector, shot by shot. The headline uses the whole cohort; this panel shows
            the kill.
          </p>
          <label className="fl" htmlFor="target-sel">
            Selected target
          </label>
          <select
            id="target-sel"
            value={selectedTargetId}
            onChange={(event) => {
              setSelectedTargetId(event.target.value);
              void run(event.target.value);
            }}
          >
            {(data?.dataset?.targets ?? []).map((target: Target) => (
              <option value={target.id} key={target.id}>
                {target.champion} · {target.role ?? "unknown role"} · {Math.round(target.health)} HP
                / {Math.round(target.armor)} armor
              </option>
            ))}
          </select>
          {resultA && (
            <p className="kill">
              {resultA.killed ? `Killed at ${resultA.ttk}s` : "Not killed in window"} · overkill{" "}
              {resultA.overkill}
            </p>
          )}
          <div className="events">
            {(resultA?.events ?? []).slice(0, 30).map((event: any, index: number) => (
              <div className="event" key={`${event.time}-${index}`}>
                <time>{event.time.toFixed(2)}s</time>
                <strong>{event.source}</strong>
                <span>
                  {event.raw} → <strong>{event.final}</strong>
                </span>
                <small>{event.notes.join(" · ")}</small>
              </div>
            ))}
            {!(resultA?.events ?? []).length && <p className="dim">Waiting for a run…</p>}
          </div>
          <button
            className="ghost-btn"
            onClick={() => setShowLog(!showLog)}
            aria-expanded={showLog}
          >
            {showLog ? "Hide full damage log" : "Show full damage log"}
          </button>
          {showLog && (
            <div className="fulllog">
              {(resultB?.events ?? []).slice(0, 30).map((event: any, index: number) => (
                <div className="event" key={`b-${event.time}-${index}`}>
                  <time>{event.time.toFixed(2)}s</time>
                  <strong>
                    {buildB.name} · {event.source}
                  </strong>
                  <span>
                    {event.raw} → <strong>{event.final}</strong>
                  </span>
                  <small>{event.notes.join(" · ")}</small>
                </div>
              ))}
            </div>
          )}
          <div className="prov">
            <span
              className={data?.dataset?.provenance === "riot" ? "badge b-riot" : "badge b-demo"}
            >
              {data?.dataset?.provenance === "riot" ? "Riot snapshots" : "Fixture / demo"}
            </span>
            <span>{data?.dataset?.note ?? "Loading target provenance…"}</span>
          </div>
          {data?.dataset && (
            <p className="dim">
              {data.dataset.distinctMatchCount ?? 0} distinct matches ·{" "}
              {data.dataset.snapshotCount ?? data.dataset.count ?? 0} snapshots ·{" "}
              {data.dataset.uniqueChampions?.length ?? 0} champions
            </p>
          )}
          {(data?.warnings ?? []).map((warning: string) => (
            <p className="warn" key={warning}>
              {warning}
            </p>
          ))}
          {data?.assumptions && <p className="dim">{data.assumptions}</p>}
        </section>

        <section className="card" aria-labelledby="cohort-h">
          <h2 id="cohort-h">Cohort detail</h2>
          <p className="sub">Observed enemy stats and where the builds trade places.</p>
          <div className="cohort-grid">
            <div>
              <h3>Target snapshot summary</h3>
              <SummaryTable summary={data?.dataset?.summary} />
            </div>
            <div>
              <h3>Breakpoint map · {duration}s damage delta</h3>
              <BreakpointTable rows={data?.breakpoints ?? []} />
            </div>
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

function actionAvailable(action: ActionKind, level: number): boolean {
  if (action === "R") return level >= 6;
  return level >= 1;
}

function defaultActionsForLevel(level: number): ActionKind[] {
  if (level < 6) return ["Q", "AA"];
  return ["R", "Q", "W", "AA", "AA"];
}

function isLegalRankShape(
  ranks: { q: number; w: number; e: number; r: number },
  level: number,
): boolean {
  const bounds = skillBounds(level);
  return (
    (["q", "w", "e", "r"] as const).every((key) => {
      const value = ranks[key];
      return Number.isInteger(value) && value >= bounds[key].min && value <= bounds[key].max;
    }) && ranks.q + ranks.w + ranks.e + ranks.r <= level
  );
}

function comparisonSentence(
  comparison: any,
  context: {
    buildA: string;
    buildB: string;
    duration: number;
    level: number;
    metric: "damage" | "ttk";
    distinctMatchCount: number;
  },
): string {
  const total = Object.values(comparison.weightedOutcomes ?? {}).reduce(
    (sum: number, value) => sum + Number(value ?? 0),
    0,
  );
  const aMass = Number(comparison.weightedOutcomes?.a ?? 0);
  const bMass = Number(comparison.weightedOutcomes?.b ?? 0);
  const tieMass = Number(comparison.weightedOutcomes?.tie ?? 0);
  const censoredMass = Number(comparison.weightedOutcomes?.censored ?? 0);
  const pct = (value: number) => (total > 0 ? Math.round((value / total) * 100) : 0);
  const median = Number(comparison.medianRelativeDelta ?? 0);
  const signedMedian = `${median >= 0 ? "+" : "−"}${Math.abs(median)}%`;
  const metricText =
    context.metric === "ttk" ? "first-crossing TTK" : `${context.duration}s applied damage`;
  const leader = aMass > bMass ? context.buildA : bMass > aMass ? context.buildB : "neither build";
  return `Across ${comparison.count} real enemy vectors from ${context.distinctMatchCount} matches at Yunara level ${context.level}, ${leader} leads ${metricText}: ${pct(aMass)}% A / ${pct(bMass)}% B weighted mass, ${pct(tieMass)}% ties, ${pct(censoredMass)}% censored; median A-vs-B delta ${signedMedian}.`;
}

function maxSource(a: any, b: any) {
  const values = [
    ...Object.values((a?.sources ?? {}) as Record<string, number>),
    ...Object.values((b?.sources ?? {}) as Record<string, number>),
  ].map(Number);
  return Math.max(1, ...values);
}

function buildDisplayName(itemIds: number[], fallback: string): string {
  const names = [
    ...new Set(
      itemIds.filter((id) => !isBootItem(id)).map((id) => itemNames[id] ?? ITEMS[id]?.name),
    ),
  ].filter(Boolean) as string[];
  if (names.length === 0) return fallback;
  if (names.length <= 2) return names.join(" + ");
  return `${names[0]} + ${names[1]} + ${names.length - 2} more`;
}

function recommendedBuild(progression: any): number[] {
  const selected = progression?.selection;
  if (!selected) return [...INITIAL_REALISTIC_BUILD];
  const supported = (selected.recommendedSupportedItemIds ?? []).filter((id: number) =>
    SUPPORTED_BUILD_ITEMS.includes(id),
  );
  const boot = Number(selected.recommendedBootId);
  const next: number[] = [...new Set<number>(supported)];
  if (Number.isInteger(boot) && SUPPORTED_BUILD_ITEMS.includes(boot)) next.push(boot);
  return next.length > 0 ? next.slice(0, 6) : [...INITIAL_REALISTIC_BUILD];
}

function unsupportedObservedDefaults(progression: any): string[] {
  const selection = progression?.selection;
  if (!selection) return [];
  if (Array.isArray(selection.recommendedExcludedItemNames)) {
    return selection.recommendedExcludedItemNames;
  }
  const supported = new Set<number>(selection.recommendedSupportedItemIds ?? []);
  return (selection.recommendedObservedItemIds ?? [])
    .filter((id: number) => !supported.has(id))
    .map((id: number) => "item " + id);
}

function isBootItem(id: number): boolean {
  return Boolean(ITEMS[id]?.boots);
}

function buildRarity(progression: any, itemIds: number[]) {
  const selected = progression?.selection;
  if (!selected) return null;
  const count = itemIds.filter((id) => !isBootItem(id)).length;
  const rarity = selected.rarityByCount?.find((row: any) => row.count === count) ?? {
    count,
    progressionPercentile: 0,
    tailPercent: 0,
    exactPercent: 0,
  };
  const coreIds = [...new Set(itemIds.filter((id) => !isBootItem(id)))].sort(
    (left, right) => left - right,
  );
  const core = selected.supportedCoreFrequencies?.find(
    (row: any) => row.itemIds.join(",") === coreIds.join(","),
  );
  return {
    count,
    progressionPercentile: rarity.progressionPercentile,
    tailPercent: rarity.tailPercent,
    exactPercent: rarity.exactPercent,
    corePercent: coreIds.length === 0 ? 100 : Number(core?.percent ?? 0),
    sampleCount: selected.sampleCount,
    lowSample: Boolean(selected.lowSample),
  };
}

function BuildRarity({ rarity }: { rarity: any }) {
  const ahead = Math.max(0, Math.min(100, Number(rarity.progressionPercentile)));
  return (
    <div className="build-rarity" aria-label="Economic item progression rarity">
      <strong>
        {rarity.count} completed legendary item{rarity.count === 1 ? "" : "s"}
      </strong>
      <span>
        {rarity.lowSample ? "Low-sample · " : ""}ahead of {ahead}% of observed Yunara states at this
        level
      </span>
      <span>
        Only {rarity.tailPercent}% had ≥{rarity.count} · exact count {rarity.exactPercent}% · exact
        selected core {rarity.corePercent}% (n={rarity.sampleCount})
      </span>
      <small>Economic/item progression only; not player skill or win probability.</small>
    </div>
  );
}

function formatDelta(delta: number) {
  return `${delta >= 0 ? "+" : "−"}${Math.abs(delta)}%`;
}

function aWinsLabel(comparison: any) {
  if (!comparison) return "—";
  return `${comparison.aWins} rows · ${Math.round(weightedShare(comparison, "a") * 100)}% mass`;
}

function bWinsLabel(comparison: any) {
  if (!comparison) return "—";
  return `${comparison.bWins} rows · ${Math.round(weightedShare(comparison, "b") * 100)}% mass`;
}

function BuildCard({
  side,
  name,
  itemIds,
  cost,
  result,
  onChange,
  onAdd,
  tag,
  leads,
  maxSource: max,
  rarity,
  warnings,
}: {
  side: "a" | "b";
  name: string;
  itemIds: number[];
  cost: number;
  result: any;
  onChange: (side: "a" | "b", index: number, value: number | null) => void;
  onAdd: (side: "a" | "b") => void;
  tag: string;
  leads: boolean;
  maxSource: number;
  rarity: any;
  warnings: string[];
}) {
  const heroItem = itemIds[itemIds.length - 1] ?? 6672;
  return (
    <article className={`build ${leads ? "win" : ""}`}>
      <div className="build-head">
        <Image
          src={`${ICON}${itemIcons[heroItem] ?? `${heroItem}.png`}`}
          alt=""
          width={44}
          height={44}
          unoptimized
          className="third-icon"
        />
        <div>
          <strong>{name}</strong>
          <small>{cost.toLocaleString()}g</small>
        </div>
        <span className={`tag ${leads ? "" : "dim"}`}>{tag}</span>
      </div>
      <div className="items">
        {itemIds.map((id, index) => (
          <label className="build-slot" key={`${side}-${index}`}>
            <Image
              src={`${ICON}${itemIcons[id] ?? `${id}.png`}`}
              alt=""
              width={30}
              height={30}
              unoptimized
            />
            <select
              aria-label={`${side === "a" ? "Build A" : "Build B"} item ${index + 1}`}
              value={id}
              onChange={(event) => onChange(side, index, Number(event.target.value))}
            >
              {SUPPORTED_BUILD_ITEMS.map((candidate) => (
                <option value={candidate} key={candidate}>
                  {itemNames[candidate] ?? ITEMS[candidate]?.name ?? candidate}
                </option>
              ))}
            </select>
            {itemIds.length > 1 && (
              <button
                type="button"
                className="remove-slot"
                aria-label={`Remove ${side === "a" ? "Build A" : "Build B"} item ${index + 1}`}
                onClick={() => onChange(side, index, null)}
              >
                ×
              </button>
            )}
          </label>
        ))}
        <button
          type="button"
          className="add-slot"
          onClick={() => onAdd(side)}
          disabled={itemIds.length >= 6}
        >
          + item
        </button>
      </div>
      {rarity && <BuildRarity rarity={rarity} />}
      {warnings.length > 0 && (
        <div className="build-warnings" role="note">
          {warnings.map((warning) => (
            <span key={warning}>⚠ {warning}</span>
          ))}
        </div>
      )}
      <div className="bignum num">
        {result ? Math.round(result.totalDamage).toLocaleString() : "—"}
        <small>total damage</small>
      </div>
      <div className="stat-chips">
        <span className="chip">
          <strong className="num">{result ? Math.round(result.dps).toLocaleString() : "—"}</strong>{" "}
          DPS
        </span>
        <span className="chip">
          TTK{" "}
          <strong className="num">
            {result?.ttk !== null && result?.ttk !== undefined ? `${result.ttk}s` : "censored"}
          </strong>
        </span>
        <span className="chip">
          <strong className="num">
            {result && result.totalDamage > 0
              ? `${Math.round((result.split.physical / result.totalDamage) * 100)}%`
              : "—"}
          </strong>{" "}
          physical
        </span>
      </div>
      <div className="sources">
        {result &&
          Object.entries(result.sources)
            .slice(0, 4)
            .map(([source, value]) => (
              <div className="src" key={source}>
                <span>{source}</span>
                <span className="bar" aria-hidden>
                  <i style={{ width: `${(Number(value) / max) * 100}%` }} />
                </span>
                <strong className="num">{Number(value).toLocaleString()}</strong>
              </div>
            ))}
      </div>
    </article>
  );
}

function weightedShare(comparison: any, side: "a" | "b") {
  const weighted = comparison.weightedOutcomes;
  const decisive = Number(weighted?.a ?? 0) + Number(weighted?.b ?? 0);
  return decisive > 0 ? Number(weighted?.[side] ?? 0) / decisive : 0;
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

function SummaryTable({ summary }: { summary: any }) {
  if (!summary) return <p className="dim">Waiting for snapshots…</p>;
  return (
    <div className="summary">
      {[
        ["Health", "health"],
        ["Bonus health", "bonusHealth"],
        ["Armor", "armor"],
        ["Magic resist", "magicResist"],
        ["Level", "level"],
        ["Game minute", "minute"],
      ].map(([label, key]) => (
        <div className="srow" key={key}>
          <span>{label}</span>
          <strong className="num">{summary[key].median}</strong>
          <small className="num">
            {summary[key].p25} – {summary[key].p75}
          </small>
        </div>
      ))}
    </div>
  );
}

function BreakpointTable({ rows }: { rows: any[] }) {
  const armorValues = [...new Set(rows.map((row) => row.armor))];
  const healthValues = [...new Set(rows.map((row) => row.bonusHealth))];
  if (!rows.length) return <p className="dim">Waiting for calculation…</p>;
  return (
    <div className="bpscroll">
      <table className="bp">
        <thead>
          <tr>
            <th scope="col">Armor \ bonus HP</th>
            {healthValues.map((value) => (
              <th scope="col" key={value} className="num">
                {value}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {armorValues.map((armor) => (
            <tr key={armor}>
              <th scope="row" className="num">
                {armor}
              </th>
              {healthValues.map((health) => {
                const row = rows.find(
                  (candidate) => candidate.armor === armor && candidate.bonusHealth === health,
                );
                return (
                  <td className={`num ${row && row.delta >= 0 ? "pos" : "neg"}`} key={health}>
                    {row ? formatDelta(Math.round(row.delta)) : "—"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
