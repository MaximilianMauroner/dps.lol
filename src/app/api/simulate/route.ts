import { NextResponse } from "next/server";
import { compareAcrossSamples, simulateYunara } from "@/domain/simulator";
import { quantile, round } from "@/domain/math";
import { getRealisticTargets } from "@/data/realistic-targets";
import type { ActionKind, Build, Target } from "@/domain/types";

const DEFAULT_A: Build = { name: "Infinity Edge", itemIds: [6672, 3085, 3006, 3031] };
const DEFAULT_B: Build = { name: "Lord Dominik's Regards", itemIds: [6672, 3085, 3006, 3036] };

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, any>;
    const duration = Math.max(1, Math.min(60, Number(body.durationSeconds ?? 5)));
    const ranks = {
      q: clampInt(body.ranks?.q ?? 5, 1, 5),
      w: clampInt(body.ranks?.w ?? 3, 1, 5),
      e: clampInt(body.ranks?.e ?? 1, 1, 5),
      r: clampInt(body.ranks?.r ?? 2, 1, 3),
    };
    const actions = (
      Array.isArray(body.actions) ? body.actions : ["R", "Q", "W", "AA", "AA"]
    ).filter((action): action is ActionKind => ["AA", "Q", "W", "R"].includes(action));
    const buildA = normalizeBuild(body.buildA, DEFAULT_A);
    const buildB = normalizeBuild(body.buildB, DEFAULT_B);
    const dataset = await getRealisticTargets({
      region: body.region,
      role: body.role,
      champion: body.targetChampion,
      rank: body.rank,
      phase: body.phase,
    });
    const manualTarget: Target = {
      id: "manual",
      champion: "Custom target",
      health: positive(body.manualTarget?.health, 2200),
      armor: Number(body.manualTarget?.armor ?? 100),
      magicResist: Number(body.manualTarget?.magicResist ?? 60),
      bonusHealth: positive(body.manualTarget?.bonusHealth, 500),
      level: clampInt(body.manualTarget?.level ?? 13, 1, 18),
      provenance: "fixture",
    };
    const targets = body.targetMode === "manual" ? [manualTarget] : dataset.targets;
    const fallbackTarget = targets[0] ?? manualTarget;
    const base: Omit<import("@/domain/types").SimulationInput, "build" | "target"> = {
      level: clampInt(body.level ?? 13, 1, 18),
      ranks,
      durationSeconds: duration,
      actions: actions.length ? actions : ["AA"],
      continueAutos: body.continueAutos !== false,
    };
    const a = simulateYunara({ ...base, build: buildA, target: fallbackTarget });
    const b = simulateYunara({ ...base, build: buildB, target: fallbackTarget });
    const comparison = compareAcrossSamples(base, buildA, buildB, targets);
    const summary = summarizeTargets(targets);
    return NextResponse.json({
      patch: "26.18",
      dataVersion: "16.18.1",
      assumptions: `Level ${base.level} / Q${ranks.q} W${ranks.w} E${ranks.e} R${ranks.r}, expected crits, Kraken + Runaan + boots included.`,
      dataset: { ...dataset, count: targets.length, summary },
      builds: { a: buildA, b: buildB },
      target: fallbackTarget,
      results: { a, b, comparison },
      breakpoints: breakpointGrid(base, buildA, buildB, fallbackTarget),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Simulation failed" },
      { status: 400 },
    );
  }
}

function normalizeBuild(value: unknown, fallback: Build): Build {
  if (!value || typeof value !== "object") return fallback;
  const candidate = value as { name?: unknown; itemIds?: unknown };
  const itemIds = Array.isArray(candidate.itemIds)
    ? candidate.itemIds.map(Number).filter(Number.isFinite)
    : fallback.itemIds;
  return { name: typeof candidate.name === "string" ? candidate.name : fallback.name, itemIds };
}

function clampInt(value: unknown, min: number, max: number): number {
  const number = Number(value);
  return Math.round(Math.max(min, Math.min(max, Number.isFinite(number) ? number : min)));
}

function positive(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function summarizeTargets(targets: Target[]) {
  const metric = (key: keyof Target) => targets.map((target) => Number(target[key] ?? 0));
  return {
    health: bands(metric("health")),
    bonusHealth: bands(metric("bonusHealth")),
    armor: bands(metric("armor")),
    magicResist: bands(metric("magicResist")),
    level: bands(metric("level")),
    minute: bands(metric("minute")),
  };
}

function bands(values: number[]) {
  return {
    p25: round(quantile(values, 0.25)),
    median: round(quantile(values, 0.5)),
    p75: round(quantile(values, 0.75)),
  };
}

function breakpointGrid(
  base: Omit<Parameters<typeof simulateYunara>[0], "build" | "target">,
  a: Build,
  b: Build,
  target: Target,
) {
  const rows: Array<{ armor: number; bonusHealth: number; a: number; b: number; delta: number }> =
    [];
  for (const armor of [0, 50, 100, 150, 200, 250, 300]) {
    for (const bonusHealth of [0, 500, 1000, 1500, 2000]) {
      const point = { ...target, id: `breakpoint-${armor}-${bonusHealth}`, armor, bonusHealth };
      const resultA = simulateYunara({ ...base, build: a, target: point });
      const resultB = simulateYunara({ ...base, build: b, target: point });
      rows.push({
        armor,
        bonusHealth,
        a: resultA.totalDamage,
        b: resultB.totalDamage,
        delta: resultA.totalDamage - resultB.totalDamage,
      });
    }
  }
  return rows;
}
