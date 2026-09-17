import { randomUUID } from "node:crypto";
import { database, hasDatabase, transaction } from "../src/db/client";
import { deriveBonusHealthEstimate } from "../src/domain/health";
import { applyInventoryEvent } from "../src/ingestion/inventory";
import {
  findThirdItemAnchor,
  type StaticItemShape,
  nearestFrameWithin,
} from "../src/ingestion/completed-items";
import type { RiotItemEvent, RiotTimeline } from "../src/ingestion/types";
import {
  archiveEnabled,
  buildMatchArchive,
  compressArchive,
  DATASET_VERSION,
  EXTRACTOR_VERSION,
  putVerifiedArchive,
  SOURCE_SCHEMA_VERSION,
} from "../src/storage/archive";

type AnyRecord = Record<string, any>;
const patch = process.env.LOL_PATCH ?? "26.18";
const apiKey = process.env.RIOT_API_KEY;
const platform = arg("--region") ?? "EUW1";
const routing = arg("--routing") ?? "EUROPE";
const tiers = (arg("--tiers") ?? "CHALLENGER,GRANDMASTER,MASTER").split(",");
const maxPlayers = Number(arg("--players") ?? process.env.INGEST_MAX_PLAYERS ?? 100);
const maxMatches = Math.min(
  1000,
  Number(arg("--matches") ?? process.env.INGEST_MAX_MATCHES ?? 200),
);
const candidateLimit = Math.min(
  4000,
  Number(arg("--candidates") ?? process.env.INGEST_CANDIDATES ?? maxMatches),
);
const candidateOffset = Math.max(
  0,
  Number(arg("--candidate-offset") ?? process.env.INGEST_CANDIDATE_OFFSET ?? 0),
);
const configuredMaxRequests = Math.min(
  5000,
  Number(arg("--max-requests") ?? process.env.INGEST_MAX_REQUESTS ?? 5000),
);
const scenarioMinute = Number(process.env.SCENARIO_MINUTE ?? 25);
const scenarioMinuteTolerance = Number(process.env.SCENARIO_MINUTE_TOLERANCE ?? 2);
const gameVersionPrefix = process.env.DDRAGON_VERSION?.replace(/\.1$/, "") ?? "16.18";
const patchStartUnix = Number(process.env.PATCH_START_UNIX ?? 1788912000);
const patchEndUnix = Number(process.env.PATCH_END_UNIX ?? Math.floor(Date.now() / 1000) + 3600);
const globalRequestCeiling = 5000;
const untrackedRequestReserve = Math.max(0, Number(process.env.GLOBAL_REQUEST_RESERVE ?? 500));
const archiveRequired = process.env.ARCHIVE_REQUIRED !== "false";

if (!hasDatabase())
  throw new Error(
    "DATABASE_URL is required for ingestion. Run db:migrate after binding the intended Railway Postgres service.",
  );
if (!apiKey)
  throw new Error(
    "RIOT_API_KEY is not configured. Copy .env.example, add the key locally, then rerun ingest:euw.",
  );
if (archiveRequired && !archiveEnabled())
  throw new Error(
    "Railway bucket S3 variables are required for ingestion. Configure BUCKET, ENDPOINT, REGION, ACCESS_KEY_ID, and SECRET_ACCESS_KEY.",
  );

const platformHost = `${platform.toLowerCase()}.api.riotgames.com`;
const routingHost = `${routing.toLowerCase()}.api.riotgames.com`;
const headers = { "X-Riot-Token": apiKey };
let lastRequestAt = 0;
let requestCount = 0;
let maxRequests = configuredMaxRequests;

async function riotJson<T>(url: string): Promise<T> {
  requestCount += 1;
  if (requestCount > maxRequests) throw new Error(`Riot request ceiling reached (${maxRequests}).`);
  const wait = Math.max(0, 110 - (Date.now() - lastRequestAt));
  if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
  for (let attempt = 0; attempt < 5; attempt += 1) {
    lastRequestAt = Date.now();
    const response = await fetch(url, { headers });
    if (response.ok) return (await response.json()) as T;
    if (response.status === 429 || response.status >= 500) {
      const retryAfter = Number(response.headers.get("retry-after") ?? 1);
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(retryAfter * 1000, 500 * 2 ** attempt)),
      );
      continue;
    }
    const body = await response.text();
    throw new Error(
      `Riot API ${response.status} for ${new URL(url).pathname}: ${body.slice(0, 200)}`,
    );
  }
  throw new Error(`Riot API retry budget exhausted for ${new URL(url).pathname}`);
}

function arg(name: string): string | undefined {
  const index = Bun.argv.indexOf(name);
  return index >= 0 ? Bun.argv[index + 1] : undefined;
}

const itemRows = await database().query<AnyRecord>(
  `SELECT item_id, name, tags, gold_total, purchasable, from_ids, into_ids, maps FROM lol_dps.items WHERE patch = $1`,
  [patch],
);
const staticItems = new Map<number, StaticItemShape>(
  itemRows.rows.map((row) => [
    Number(row.item_id),
    {
      id: Number(row.item_id),
      name: row.name,
      tags: row.tags ?? [],
      goldTotal: Number(row.gold_total),
      purchasable: row.purchasable,
      fromIds: (row.from_ids ?? []).map(Number),
      intoIds: (row.into_ids ?? []).map(Number),
      maps: row.maps ?? {},
    },
  ]),
);
const championRows = await database().query<AnyRecord>(
  `SELECT champion_id, stats FROM lol_dps.champions WHERE patch = $1`,
  [patch],
);
const championStats = new Map<number, AnyRecord>(
  championRows.rows.map((row) => [Number(row.champion_id), row.stats]),
);
const requestHistory = await database().query<{ used: string }>(
  `SELECT COALESCE(SUM(CASE WHEN cursor->>'requestCount' ~ '^[0-9]+$' THEN (cursor->>'requestCount')::bigint ELSE 0 END),0)::text AS used
     FROM lol_dps.ingestion_runs`,
);
const knownRequestCount = Number(requestHistory.rows[0]?.used ?? 0);
maxRequests = Math.min(
  configuredMaxRequests,
  Math.max(0, globalRequestCeiling - knownRequestCount - untrackedRequestReserve),
);
if (maxRequests <= 0) {
  throw new Error("The global Riot request ceiling is exhausted; no new ingestion was started.");
}
const runId = randomUUID();
await database().query(
  `INSERT INTO lol_dps.ingestion_runs (run_id,patch,platform_region,routing_region,tiers,status)
   VALUES ($1,$2,$3,$4,$5,'running')`,
  [runId, patch, platform, routing, tiers],
);

try {
  const enrichedRows = await database().query<{ puuid: string }>(
    `SELECT DISTINCT p.puuid
       FROM lol_dps.participants p
       JOIN lol_dps.matches m ON m.match_id = p.match_id
      WHERE p.puuid IS NOT NULL AND p.champion_id = 804 AND m.patch = $1
      ORDER BY p.puuid
      LIMIT $2`,
    [patch, Math.min(50, maxPlayers)],
  );
  const enrichedSeeds = enrichedRows.rows
    .map((row) => ({ puuid: row.puuid, tier: "ENRICHED_YUNARA" }))
    .filter((seed) => seed.puuid.length > 0);
  const regularSeeds: Array<{ puuid: string; tier: string }> = [];
  for (const tier of tiers) {
    const path =
      tier === "CHALLENGER"
        ? "challengerleagues"
        : tier === "GRANDMASTER"
          ? "grandmasterleagues"
          : "masterleagues";
    const league = await riotJson<AnyRecord>(
      `https://${platformHost}/lol/league/v4/${path}/by-queue/RANKED_SOLO_5x5`,
    );
    for (const entry of (league.entries ?? []).slice(0, Math.ceil(maxPlayers / tiers.length))) {
      let puuid = entry.puuid as string | undefined;
      if (!puuid && entry.summonerId) {
        const summoner = await riotJson<AnyRecord>(
          `https://${platformHost}/lol/summoner/v4/summoners/${entry.summonerId}`,
        );
        puuid = summoner.puuid;
      }
      if (puuid) regularSeeds.push({ puuid, tier });
      if (regularSeeds.length >= maxPlayers) break;
    }
    if (regularSeeds.length >= maxPlayers) break;
  }
  const seeds: Array<{ puuid: string; tier: string }> = [];
  const seenSeeds = new Set<string>();
  for (const seed of [...enrichedSeeds, ...regularSeeds]) {
    if (seenSeeds.has(seed.puuid)) continue;
    seenSeeds.add(seed.puuid);
    seeds.push(seed);
  }
  const knownMatchRows = await database().query<{ match_id: string }>(
    `SELECT match_id FROM lol_dps.matches`,
  );
  const knownMatchIds = new Set(knownMatchRows.rows.map((row) => row.match_id));
  const matchIds = new Set<string>();
  let emptySeeds = 0;
  for (const seed of seeds) {
    const ids = await riotJson<string[]>(
      `https://${routingHost}/lol/match/v5/matches/by-puuid/${encodeURIComponent(seed.puuid)}/ids?queue=420&startTime=${patchStartUnix}&endTime=${patchEndUnix}&start=0&count=100`,
    );
    if (ids.length === 0) emptySeeds += 1;
    for (const id of ids) {
      if (!knownMatchIds.has(id)) matchIds.add(id);
    }
    if (matchIds.size >= candidateOffset + candidateLimit) break;
  }
  const selected = [...matchIds].slice(candidateOffset, candidateOffset + candidateLimit);
  const tierByPuuid = new Map(seeds.map((seed) => [seed.puuid, seed.tier]));
  await database().query(
    `UPDATE lol_dps.ingestion_runs SET players_seen=$2,matches_seen=$3 WHERE run_id=$1`,
    [runId, seeds.length, selected.length],
  );
  let ingested = 0;
  const skipped = { existing: 0, short: 0, malformed: 0, patch: 0, outsideWindow: 0 };
  for (const matchId of selected) {
    if (ingested >= maxMatches) break;
    const exists = await database().query(`SELECT 1 FROM lol_dps.matches WHERE match_id=$1`, [
      matchId,
    ]);
    if (exists.rowCount) {
      skipped.existing += 1;
      continue;
    }
    const match = await riotJson<AnyRecord>(
      `https://${routingHost}/lol/match/v5/matches/${matchId}`,
    );
    const info = match.info as AnyRecord;
    const gameVersion = String(info.gameVersion ?? "");
    const durationSeconds = Number(info.gameDuration ?? 0);
    const gameStartUnix = Math.floor(Number(info.gameStartTimestamp ?? 0) / 1000);
    if (
      !Number.isFinite(gameStartUnix) ||
      gameStartUnix < patchStartUnix ||
      gameStartUnix > patchEndUnix
    ) {
      skipped.outsideWindow += 1;
      continue;
    }
    if (durationSeconds < 900) {
      skipped.short += 1;
      continue;
    }
    if (!Array.isArray(info.participants) || info.participants.length !== 10) {
      skipped.malformed += 1;
      continue;
    }
    if (!gameVersion.startsWith(gameVersionPrefix)) {
      skipped.patch += 1;
      continue;
    }
    const timeline = await riotJson<RiotTimeline>(
      `https://${routingHost}/lol/match/v5/matches/${matchId}/timeline`,
    );
    const archive = compressArchive(buildMatchArchive(match, timeline));
    const archiveObject = archiveEnabled()
      ? await putVerifiedArchive(archive, { patch, region: platform })
      : null;
    await persistMatch({
      matchId,
      match,
      timeline,
      staticItems,
      championStats,
      gameVersion,
      tierByPuuid,
      archiveObject,
    });
    ingested += 1;
    await database().query(
      `UPDATE lol_dps.ingestion_runs SET matches_ingested=$2,cursor=$3 WHERE run_id=$1`,
      [
        runId,
        ingested,
        { requestCount, lastMatch: ingested, candidateOffset, patchStartUnix, patchEndUnix },
      ],
    );
    console.log(`Ingested match ${ingested}/${selected.length}`);
  }
  await database().query(
    `UPDATE lol_dps.ingestion_runs SET status='complete',finished_at=now(),cursor=$2 WHERE run_id=$1`,
    [runId, { requestCount, candidateOffset, patchStartUnix, patchEndUnix }],
  );
  console.log(`Ingestion complete: ${ingested} new ${patch} matches.`);
  console.log(
    `Discovery seeds=${seeds.length} (enriched=${enrichedSeeds.length}), empty=${emptySeeds}, selected=${selected.length}, offset=${candidateOffset}.`,
  );
  console.log(
    `Skipped existing=${skipped.existing}, short=${skipped.short}, malformed=${skipped.malformed}, outside-window=${skipped.outsideWindow}, other-patch=${skipped.patch}. Requests=${requestCount}; prior-known=${knownRequestCount}.`,
  );
} catch (error) {
  await database().query(
    `UPDATE lol_dps.ingestion_runs SET status='failed',error=$2,finished_at=now(),cursor=$3 WHERE run_id=$1`,
    [
      runId,
      String(error).slice(0, 2000),
      { requestCount, candidateOffset, patchStartUnix, patchEndUnix },
    ],
  );
  throw error;
} finally {
  await database().end();
}

async function persistMatch(input: {
  matchId: string;
  match: AnyRecord;
  timeline: RiotTimeline;
  staticItems: Map<number, StaticItemShape>;
  championStats: Map<number, AnyRecord>;
  gameVersion: string;
  tierByPuuid: Map<string, string>;
  archiveObject: {
    key: string;
    sha256: string;
    compressedBytes: number;
    uncompressedBytes: number;
  } | null;
}): Promise<void> {
  const info = input.match.info as AnyRecord;
  const participants = (info.participants ?? []) as AnyRecord[];
  const participantIds = participants.map((participant) => Number(participant.participantId));
  const snapshotIds = new Map<string, string>();
  const anchorFrames = new Map<number, Array<{ timestamp: number; inventory: number[] }>>();
  const anchorEvents = new Map<number, RiotItemEvent[]>();
  const snapshotRows: Array<{
    participantId: number;
    timestamp: number;
    minute: number;
    level: number;
    totalGold: number;
    currentGold: number;
    health: number;
    armor: number;
    magicResist: number;
    attackDamage: number | null;
    attackSpeed: number | null;
    abilityPower: number | null;
    bonusHealth: number | null;
    bonusHealthStatus: string;
    inventory: number[];
  }> = [];
  await transaction(async (client) => {
    if (input.archiveObject) {
      await client.query(
        `INSERT INTO lol_dps.archive_objects
          (object_kind,source_match_id,patch,platform_region,object_key,sha256,compressed_bytes,uncompressed_bytes,
           source_schema_version,extractor_version,dataset_version,status,verified_at)
         VALUES ('match-source',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'verified',now())
         ON CONFLICT (object_kind,source_match_id) DO UPDATE SET
           object_key=EXCLUDED.object_key, sha256=EXCLUDED.sha256,
           compressed_bytes=EXCLUDED.compressed_bytes, uncompressed_bytes=EXCLUDED.uncompressed_bytes,
           source_schema_version=EXCLUDED.source_schema_version, extractor_version=EXCLUDED.extractor_version,
           dataset_version=EXCLUDED.dataset_version, status='verified', verified_at=now(), error=NULL`,
        [
          input.matchId,
          patch,
          platform,
          input.archiveObject.key,
          input.archiveObject.sha256,
          input.archiveObject.compressedBytes,
          input.archiveObject.uncompressedBytes,
          SOURCE_SCHEMA_VERSION,
          EXTRACTOR_VERSION,
          DATASET_VERSION,
        ],
      );
    }
    await client.query(
      `INSERT INTO lol_dps.matches
        (match_id,patch,game_version,platform_region,routing_region,queue_id,game_start,duration_seconds,raw,
         archive_status,source_schema_version,extractor_version,dataset_version)
       VALUES ($1,$2,$3,$4,$5,$6,to_timestamp($7/1000.0),$8,$9,$10,$11,$12,$13)`,
      [
        input.matchId,
        patch,
        input.gameVersion,
        platform,
        routing,
        info.queueId ?? 420,
        info.gameStartTimestamp ?? null,
        info.gameDuration ?? 0,
        input.archiveObject
          ? {
              archiveObjectKey: input.archiveObject.key,
              archiveSha256: input.archiveObject.sha256,
            }
          : input.match,
        input.archiveObject ? "verified" : "legacy",
        input.archiveObject ? SOURCE_SCHEMA_VERSION : null,
        input.archiveObject ? EXTRACTOR_VERSION : null,
        input.archiveObject ? DATASET_VERSION : null,
      ],
    );
    for (const participant of participants) {
      await client.query(
        `INSERT INTO lol_dps.participants (match_id,participant_id,puuid,champion_id,champion_name,team_id,role,lane,tier)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          input.matchId,
          participant.participantId,
          participant.puuid ?? null,
          participant.championId,
          participant.championName,
          participant.teamId,
          participant.teamPosition || participant.individualPosition || null,
          participant.lane || null,
          input.tierByPuuid.get(participant.puuid) ?? null,
        ],
      );
      anchorFrames.set(Number(participant.participantId), []);
      anchorEvents.set(Number(participant.participantId), []);
    }
    const inventories = new Map(participantIds.map((id) => [id, [] as number[]]));
    const eventsByParticipant = new Map<number, RiotItemEvent[]>();
    for (const frame of input.timeline.info.frames) {
      for (const event of frame.events as RiotItemEvent[]) {
        if (!event.participantId) continue;
        const events = eventsByParticipant.get(event.participantId) ?? [];
        events.push(event);
        eventsByParticipant.set(event.participantId, events);
      }
    }
    for (const [participantId, events] of eventsByParticipant) {
      events.sort((a, b) => a.timestamp - b.timestamp);
      anchorEvents.set(participantId, events);
    }
    const eventIndexes = new Map(participantIds.map((id) => [id, 0]));
    const orderedFrames = [...input.timeline.info.frames].sort((a, b) => a.timestamp - b.timestamp);
    for (const frame of orderedFrames) {
      for (const participantId of participantIds) {
        const events = eventsByParticipant.get(participantId) ?? [];
        let index = eventIndexes.get(participantId) ?? 0;
        while (index < events.length && events[index]!.timestamp <= frame.timestamp) {
          inventories.set(
            participantId,
            applyInventoryEvent(inventories.get(participantId) ?? [], events[index]!),
          );
          index += 1;
        }
        eventIndexes.set(participantId, index);
      }
      for (const participant of participants) {
        const id = Number(participant.participantId);
        const frameParticipant = frame.participantFrames[String(id)];
        if (!frameParticipant?.championStats) continue;
        const stats = frameParticipant.championStats;
        const staticStats = input.championStats.get(Number(participant.championId));
        const health = Number(stats.healthMax ?? 0);
        const estimate = deriveBonusHealthEstimate(
          health,
          Number(frameParticipant.level ?? 1),
          staticStats ? Number(staticStats.hp) : undefined,
          staticStats ? Number(staticStats.hpperlevel) : undefined,
        );
        const bonusHealth = estimate.value;
        const bonusHealthStatus = estimate.status;
        const inventory = inventories.get(id) ?? [];
        anchorFrames.get(id)!.push({ timestamp: frame.timestamp, inventory: [...inventory] });
        snapshotRows.push({
          participantId: id,
          timestamp: frame.timestamp,
          minute: frame.timestamp / 60000,
          level: Number(frameParticipant.level ?? 1),
          totalGold: Number(frameParticipant.totalGold ?? 0),
          currentGold: Number(frameParticipant.currentGold ?? 0),
          health,
          armor: Number(stats.armor ?? 0),
          magicResist: Number(stats.magicResist ?? 0),
          attackDamage: stats.attackDamage == null ? null : Number(stats.attackDamage),
          attackSpeed: stats.attackSpeed == null ? null : Number(stats.attackSpeed),
          abilityPower: stats.abilityPower == null ? null : Number(stats.abilityPower),
          bonusHealth,
          bonusHealthStatus,
          inventory: [...inventory],
        });
      }
    }
    if (snapshotRows.length > 0) {
      const snapshotValues: unknown[] = [];
      const snapshotPlaceholders = snapshotRows.map((row, index) => {
        const offset = index * 15;
        snapshotValues.push(
          input.matchId,
          row.participantId,
          row.timestamp,
          row.minute,
          row.level,
          row.totalGold,
          row.currentGold,
          row.health,
          row.armor,
          row.magicResist,
          row.attackDamage,
          row.attackSpeed,
          row.abilityPower,
          row.bonusHealth,
          row.bonusHealthStatus,
        );
        return `(${Array.from({ length: 15 }, (_, valueIndex) => `$${offset + valueIndex + 1}`).join(",")})`;
      });
      const inserted = await client.query<{
        snapshot_id: string;
        participant_id: number;
        timestamp_ms: number;
      }>(
        `INSERT INTO lol_dps.timeline_snapshots
          (match_id,participant_id,timestamp_ms,minute,level,total_gold,current_gold,health_max,armor,magic_resist,attack_damage,attack_speed,ability_power,bonus_health_estimate,bonus_health_status)
         VALUES ${snapshotPlaceholders.join(",")}
         ON CONFLICT (match_id,participant_id,timestamp_ms) DO UPDATE SET health_max=EXCLUDED.health_max, bonus_health_estimate=EXCLUDED.bonus_health_estimate, bonus_health_status=EXCLUDED.bonus_health_status
         RETURNING snapshot_id,participant_id,timestamp_ms`,
        snapshotValues,
      );
      for (const row of inserted.rows)
        snapshotIds.set(`${row.participant_id}:${row.timestamp_ms}`, row.snapshot_id);
      const itemValues: unknown[] = [];
      const itemPlaceholders: string[] = [];
      for (const row of snapshotRows) {
        const snapshotId = snapshotIds.get(`${row.participantId}:${row.timestamp}`);
        if (!snapshotId) continue;
        for (const [slot, itemId] of row.inventory.entries()) {
          const offset = itemValues.length;
          itemValues.push(snapshotId, slot, itemId);
          itemPlaceholders.push(`($${offset + 1},$${offset + 2},$${offset + 3})`);
        }
      }
      if (itemPlaceholders.length > 0) {
        await client.query(
          `INSERT INTO lol_dps.snapshot_items (snapshot_id,slot,item_id) VALUES ${itemPlaceholders.join(",")} ON CONFLICT DO NOTHING`,
          itemValues,
        );
      }
    }
    await createScenarioSamples(
      client,
      input,
      participants,
      anchorFrames,
      anchorEvents,
      snapshotIds,
    );
  });
}

async function createScenarioSamples(
  client: import("pg").PoolClient,
  input: { matchId: string; staticItems: Map<number, StaticItemShape> },
  participants: AnyRecord[],
  anchorFrames: Map<number, Array<{ timestamp: number; inventory: number[] }>>,
  anchorEvents: Map<number, RiotItemEvent[]>,
  snapshotIds: Map<string, string>,
): Promise<void> {
  const anchors = [
    ...participants
      .filter((participant) => Number(participant.championId) === 804)
      .map((p) => ({ p, phase: "yunara-third-item", fallback: 0 })),
    ...participants
      .filter((participant) =>
        ["BOTTOM", "CARRY", "BOT"].includes(
          participant.teamPosition || participant.individualPosition,
        ),
      )
      .map((p) => ({ p, phase: "bot-carry-third-item", fallback: 1 })),
  ];
  const used = new Set<string>();
  for (const anchor of anchors) {
    const id = Number(anchor.p.participantId);
    const frames = anchorFrames.get(id) ?? [];
    const third = findThirdItemAnchor(frames, anchorEvents.get(id) ?? [], input.staticItems);
    if (!third) continue;
    const enemies = participants
      .filter((participant) => Number(participant.teamId) !== Number(anchor.p.teamId))
      .map((participant) => Number(participant.participantId));
    for (const enemyId of enemies) {
      const targetSnapshot = snapshotIds.get(`${enemyId}:${third.frameTimestamp}`);
      if (!targetSnapshot) continue;
      const key = `${anchor.phase}:${id}:${targetSnapshot}`;
      if (used.has(key)) continue;
      used.add(key);
      await client.query(
        `INSERT INTO lol_dps.scenario_samples
         (patch,platform_region,phase,fallback_level,anchor_match_id,anchor_participant_id,anchor_timestamp_ms,anchor_event_timestamp_ms,anchor_frame_distance_ms,target_snapshot_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`,
        [
          patch,
          platform,
          anchor.phase,
          anchor.fallback,
          input.matchId,
          id,
          third.frameTimestamp,
          third.eventTimestamp,
          third.frameDistanceMs,
          targetSnapshot,
        ],
      );
    }
  }
  const minuteAnchor =
    participants.find((participant) =>
      ["BOTTOM", "CARRY", "BOT"].includes(
        participant.teamPosition || participant.individualPosition,
      ),
    ) ?? participants[0];
  if (minuteAnchor) {
    const id = Number(minuteAnchor.participantId);
    const frames = anchorFrames.get(id) ?? [];
    const anchorFrame = nearestFrameWithin(
      frames,
      scenarioMinute * 60_000,
      scenarioMinuteTolerance * 60_000,
    );
    if (anchorFrame) {
      const enemies = participants
        .filter((participant) => Number(participant.teamId) !== Number(minuteAnchor.teamId))
        .map((participant) => Number(participant.participantId));
      for (const enemyId of enemies) {
        const targetSnapshot = snapshotIds.get(`${enemyId}:${anchorFrame.timestamp}`);
        if (!targetSnapshot) continue;
        const key = `minute-window:${id}:${targetSnapshot}`;
        if (used.has(key)) continue;
        used.add(key);
        await client.query(
          `INSERT INTO lol_dps.scenario_samples
           (patch,platform_region,phase,fallback_level,anchor_match_id,anchor_participant_id,anchor_timestamp_ms,anchor_event_timestamp_ms,anchor_frame_distance_ms,target_snapshot_id)
           VALUES ($1,$2,'minute-window',2,$3,$4,$5,NULL,NULL,$6) ON CONFLICT DO NOTHING`,
          [patch, platform, input.matchId, id, anchorFrame.timestamp, targetSnapshot],
        );
      }
    }
  }
}
