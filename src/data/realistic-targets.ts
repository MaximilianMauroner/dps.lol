import { hasDatabase, query } from "@/db/client";
import { fixtureTargets } from "./fixtures";
import type { Target } from "@/domain/types";

interface TargetRow {
  snapshot_id: string;
  champion_name: string;
  role: string | null;
  tier: string | null;
  health_max: string;
  armor: string;
  magic_resist: string;
  bonus_health_estimate: string;
  level: number;
  minute: string;
}

export interface TargetDataset {
  targets: Target[];
  provenance: "riot" | "fixture";
  phase: string;
  fallbackLevel: number;
  note: string;
}

export async function getRealisticTargets(filters?: {
  region?: string;
  role?: string;
  champion?: string;
  rank?: string;
  phase?: string;
}): Promise<TargetDataset> {
  if (!hasDatabase()) {
    return {
      targets: filterFixtures(filters),
      provenance: "fixture",
      phase: "Yunara third-item timing (demo approximation)",
      fallbackLevel: 3,
      note: "Fixture values are illustrative and are not presented as Riot match observations.",
    };
  }

  const role = filters?.role && filters.role !== "ALL" ? filters.role : null;
  const champion = filters?.champion?.trim() || null;
  const rank = filters?.rank && filters.rank !== "ALL" ? filters.rank : null;
  const phase = filters?.phase;
  const region = filters?.region ?? "EUW1";
  const candidates = [
    { phase: "yunara-third-item", fallback: 0 },
    { phase: "bot-carry-third-item", fallback: 1 },
    { phase: "minute-window-25", fallback: 2 },
  ];
  if (phase && candidates.some((candidate) => candidate.phase === phase)) {
    candidates.sort((a, b) => Number(a.phase !== phase) - Number(b.phase !== phase));
  }
  for (const candidate of candidates) {
    const rows = await query<TargetRow>(
      `SELECT DISTINCT s.snapshot_id, p.champion_name, p.role, p.tier, s.health_max, s.armor,
              s.magic_resist, COALESCE(s.bonus_health_estimate, 0) AS bonus_health_estimate,
              s.level, s.minute
         FROM lol_dps.scenario_samples ss
         JOIN lol_dps.timeline_snapshots s ON s.snapshot_id = ss.target_snapshot_id
         JOIN lol_dps.participants p
           ON p.match_id = s.match_id AND p.participant_id = s.participant_id
        WHERE ss.patch = $1 AND ss.platform_region = $2 AND ss.phase = $3
          AND ($4::text IS NULL OR p.role = $4)
          AND ($5::text IS NULL OR lower(p.champion_name) = lower($5))
          AND ($6::text IS NULL OR p.tier = $6)
        ORDER BY s.snapshot_id DESC LIMIT 2000`,
      ["26.18", region, candidate.phase, role, champion, rank],
    );
    if (rows.length > 0) {
      return {
        targets: rows.map((row) => ({
          id: row.snapshot_id,
          champion: row.champion_name,
          role: row.role ?? undefined,
          rank: row.tier ?? undefined,
          health: Number(row.health_max),
          armor: Number(row.armor),
          magicResist: Number(row.magic_resist),
          bonusHealth: Number(row.bonus_health_estimate),
          level: row.level,
          minute: Number(row.minute),
          provenance: "riot",
        })),
        provenance: "riot",
        phase: candidate.phase,
        fallbackLevel: candidate.fallback,
        note:
          candidate.fallback === 0
            ? "Exact Yunara third-item anchors."
            : "Sparse-data fallback was used.",
      };
    }
  }
  return {
    targets: [],
    provenance: "riot",
    phase: "no-samples",
    fallbackLevel: 3,
    note: "The database is connected but contains no matching scenario samples.",
  };
}

function filterFixtures(filters?: { role?: string; champion?: string }): Target[] {
  return fixtureTargets.filter(
    (target) =>
      (!filters?.role || filters.role === "ALL" || target.role === filters.role) &&
      (!filters?.champion || target.champion.toLowerCase() === filters.champion.toLowerCase()),
  );
}
