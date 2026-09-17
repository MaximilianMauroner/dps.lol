import { NextResponse } from "next/server";
import { getRealisticTargets, type TargetFilters } from "@/data/realistic-targets";
import { round, weightedQuantile } from "@/domain/math";

const REGIONS = new Set(["EUW1", "NA1", "KR"]);
const PHASES = new Set(["yunara-third-item", "bot-carry-third-item", "minute-window"]);
const RANKS = new Set(["ALL", "CHALLENGER", "GRANDMASTER", "MASTER"]);
const ROLES = new Set(["ALL", "TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"]);

export async function POST(request: Request) {
  try {
    if (Number(request.headers.get("content-length") ?? 0) > 32_768) {
      return NextResponse.json({ error: "Cohort request is too large." }, { status: 413 });
    }
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const filters: TargetFilters = {
      region: boundedChoice(body.region, REGIONS, "EUW1"),
      phase: boundedChoice(body.phase, PHASES, "yunara-third-item"),
      rank: boundedChoice(body.rank, RANKS, "ALL"),
      role: boundedChoice(body.role, ROLES, "ALL"),
      champion: typeof body.champion === "string" ? body.champion.trim().slice(0, 48) : "",
      limit: boundedInt(body.limit, 1, 1000, 500),
    };
    const dataset = await getRealisticTargets(filters);
    return NextResponse.json({
      patch: "26.18",
      dataVersion: "16.18.1",
      filters,
      dataset: {
        ...dataset,
        targets: dataset.targets.map(sanitizeTarget),
        count: dataset.targets.length,
        summary: summarizeTargets(dataset.targets),
        warning:
          dataset.provenance === "fixture"
            ? "Fixture/demo data only; no Riot observation claim is made."
            : dataset.distinctMatchCount < 10
              ? `Low sample: ${dataset.distinctMatchCount} distinct match(es), ${dataset.snapshotCount} target snapshot(s).`
              : dataset.truncated
                ? `Deterministic bounded sample: ${dataset.snapshotCount} of ${dataset.availableSnapshotCount} matching snapshots.`
                : undefined,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Cohort retrieval failed" },
      { status: 400 },
    );
  }
}

function summarizeTargets(targets: Awaited<ReturnType<typeof getRealisticTargets>>["targets"]) {
  const metric = (key: "health" | "bonusHealth" | "armor" | "magicResist" | "level" | "minute") =>
    targets.map((target) => ({
      value: Number(target[key] ?? 0),
      weight: target.sampleWeight ?? 1,
    }));
  return Object.fromEntries(
    (["health", "bonusHealth", "armor", "magicResist", "level", "minute"] as const).map((key) => {
      const values = metric(key);
      return [
        key,
        {
          p25: round(weightedQuantile(values, 0.25)),
          median: round(weightedQuantile(values, 0.5)),
          p75: round(weightedQuantile(values, 0.75)),
        },
      ];
    }),
  );
}

function sanitizeTarget(
  target: Awaited<ReturnType<typeof getRealisticTargets>>["targets"][number],
) {
  return {
    id: String(target.id).slice(0, 64),
    champion: target.champion.slice(0, 64),
    role: target.role,
    rank: target.rank,
    health: finite(target.health, 0, 1_000_000),
    armor: finite(target.armor, -500, 2_000),
    magicResist: finite(target.magicResist, -500, 2_000),
    bonusHealth: finite(target.bonusHealth, 0, 1_000_000),
    bonusHealthStatus: target.bonusHealthStatus,
    level: Math.max(1, Math.min(18, Math.round(target.level))),
    minute: finite(target.minute ?? 0, 0, 120),
    itemIds: (target.itemIds ?? []).filter((id) => Number.isInteger(id)).slice(0, 6),
    sampleWeight: finite(target.sampleWeight ?? 1, 0.000001, 1),
    sourceMatchKey: target.sourceMatchKey,
    anchorEventTimestampMs: target.anchorEventTimestampMs,
    anchorFrameDistanceMs: target.anchorFrameDistanceMs,
    provenance: target.provenance,
  };
}

function boundedChoice(value: unknown, allowed: Set<string>, fallback: string): string {
  return typeof value === "string" && allowed.has(value) ? value : fallback;
}

function boundedInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.round(parsed))) : fallback;
}

function finite(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : min;
}
