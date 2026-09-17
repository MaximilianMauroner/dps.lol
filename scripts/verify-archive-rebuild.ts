import { database, query } from "../src/db/client";
import { readArchivedSource, archiveEnabled } from "../src/storage/archive";

if (!archiveEnabled()) throw new Error("Railway bucket S3 variables are not configured.");
const rows = await query<{
  source_match_id: string;
  object_key: string;
}>(
  `SELECT source_match_id, object_key
     FROM lol_dps.archive_objects
    WHERE object_kind='match-source' AND status='verified'
    ORDER BY archive_object_id
    LIMIT 1`,
);
if (!rows[0]?.source_match_id) throw new Error("No verified source archive is available.");
const row = rows[0];
const source = await readArchivedSource(row.object_key);
const match = source.match as {
  metadata?: { matchId?: string };
  info?: { participants?: unknown[] };
};
const timeline = source.timeline as {
  metadata?: { matchId?: string };
  info?: { frames?: Array<{ participantFrames?: Record<string, { championStats?: unknown }> }> };
};
if (
  match.metadata?.matchId !== row.source_match_id ||
  timeline.metadata?.matchId !== row.source_match_id
) {
  throw new Error("Archive match/timeline identity mismatch.");
}
const expectedSnapshotCount = (timeline.info?.frames ?? []).reduce(
  (count, frame) =>
    count +
    Object.values(frame.participantFrames ?? {}).filter((participant) => participant.championStats)
      .length,
  0,
);
const derived = await query<{ count: string }>(
  `SELECT count(*)::text AS count FROM lol_dps.timeline_snapshots WHERE match_id=$1`,
  [row.source_match_id],
);
if (Number(derived[0]?.count ?? -1) !== expectedSnapshotCount) {
  throw new Error(
    `Archive replay mismatch for verified source: expected ${expectedSnapshotCount}, derived ${derived[0]?.count ?? "unknown"}.`,
  );
}
console.log(
  `Archive replay verified for one source: ${expectedSnapshotCount} derived snapshots; no production rows changed.`,
);
await database().end();
