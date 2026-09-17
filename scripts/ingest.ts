import { randomUUID } from "node:crypto";
import { database, hasDatabase, transaction } from "../src/db/client";
import { deriveBonusHealth } from "../src/domain/health";
import { applyInventoryEvent } from "../src/ingestion/inventory";
import { isCompletedLegendary, type StaticItemShape } from "../src/ingestion/completed-items";
import type { RiotItemEvent, RiotTimeline } from "../src/ingestion/types";

type AnyRecord = Record<string, any>;
const patch = process.env.LOL_PATCH ?? "26.18";
const apiKey = process.env.RIOT_API_KEY;
const platform = arg("--region") ?? "EUW1";
const routing = arg("--routing") ?? "EUROPE";
const tiers = (arg("--tiers") ?? "CHALLENGER,GRANDMASTER,MASTER").split(",");
const maxPlayers = Number(arg("--players") ?? process.env.INGEST_MAX_PLAYERS ?? 100);
const maxMatches = Number(arg("--matches") ?? process.env.INGEST_MAX_MATCHES ?? 100);
const scenarioMinute = Number(process.env.SCENARIO_MINUTE ?? 25);
const gameVersionPrefix = process.env.DDRAGON_VERSION?.replace(/\.1$/, "") ?? "16.18";

if (!hasDatabase())
  throw new Error(
    "DATABASE_URL is required for ingestion. Run db:migrate after binding the intended Railway Postgres service.",
  );
if (!apiKey)
  throw new Error(
    "RIOT_API_KEY is not configured. Copy .env.example, add the key locally, then rerun ingest:euw.",
  );

const platformHost = `${platform.toLowerCase()}.api.riotgames.com`;
const routingHost = `${routing.toLowerCase()}.api.riotgames.com`;
const headers = { "X-Riot-Token": apiKey };
let lastRequestAt = 0;

async function riotJson<T>(url: string): Promise<T> {
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
const runId = randomUUID();
await database().query(
  `INSERT INTO lol_dps.ingestion_runs (run_id,patch,platform_region,routing_region,tiers,status)
   VALUES ($1,$2,$3,$4,$5,'running')`,
  [runId, patch, platform, routing, tiers],
);

try {
  const seeds: Array<{ puuid: string; tier: string }> = [];
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
      if (puuid) seeds.push({ puuid, tier });
      if (seeds.length >= maxPlayers) break;
    }
    if (seeds.length >= maxPlayers) break;
  }
  const matchIds = new Set<string>();
  for (const seed of seeds) {
    const ids = await riotJson<string[]>(
      `https://${routingHost}/lol/match/v5/matches/by-puuid/${encodeURIComponent(seed.puuid)}/ids?queue=420&start=0&count=100`,
    );
    for (const id of ids) matchIds.add(id);
    if (matchIds.size >= maxMatches) break;
  }
  const selected = [...matchIds].slice(0, maxMatches);
  const tierByPuuid = new Map(seeds.map((seed) => [seed.puuid, seed.tier]));
  await database().query(
    `UPDATE lol_dps.ingestion_runs SET players_seen=$2,matches_seen=$3 WHERE run_id=$1`,
    [runId, seeds.length, selected.length],
  );
  let ingested = 0;
  for (const matchId of selected) {
    const exists = await database().query(`SELECT 1 FROM lol_dps.matches WHERE match_id=$1`, [
      matchId,
    ]);
    if (exists.rowCount) continue;
    const match = await riotJson<AnyRecord>(
      `https://${routingHost}/lol/match/v5/matches/${matchId}`,
    );
    const info = match.info as AnyRecord;
    const gameVersion = String(info.gameVersion ?? "");
    if (!gameVersion.startsWith(gameVersionPrefix)) continue;
    const timeline = await riotJson<RiotTimeline>(
      `https://${routingHost}/lol/match/v5/matches/${matchId}/timeline`,
    );
    await persistMatch({
      matchId,
      match,
      timeline,
      staticItems,
      championStats,
      gameVersion,
      tierByPuuid,
    });
    ingested += 1;
    await database().query(
      `UPDATE lol_dps.ingestion_runs SET matches_ingested=$2 WHERE run_id=$1`,
      [runId, ingested],
    );
    console.log(`Ingested ${matchId} (${ingested}/${selected.length})`);
  }
  await database().query(
    `UPDATE lol_dps.ingestion_runs SET status='complete',finished_at=now() WHERE run_id=$1`,
    [runId],
  );
  console.log(`Ingestion complete: ${ingested} new ${patch} matches.`);
} catch (error) {
  await database().query(
    `UPDATE lol_dps.ingestion_runs SET status='failed',error=$2,finished_at=now() WHERE run_id=$1`,
    [runId, String(error).slice(0, 2000)],
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
}): Promise<void> {
  const info = input.match.info as AnyRecord;
  const participants = (info.participants ?? []) as AnyRecord[];
  const participantIds = participants.map((participant) => Number(participant.participantId));
  const snapshotIds = new Map<string, string>();
  const anchorFrames = new Map<number, Array<{ timestamp: number; inventory: number[] }>>();
  await transaction(async (client) => {
    await client.query(
      `INSERT INTO lol_dps.matches (match_id,patch,game_version,platform_region,routing_region,queue_id,game_start,duration_seconds,raw)
       VALUES ($1,$2,$3,$4,$5,$6,to_timestamp($7/1000.0),$8,$9)`,
      [
        input.matchId,
        patch,
        input.gameVersion,
        platform,
        routing,
        info.queueId ?? 420,
        info.gameStartTimestamp ?? null,
        info.gameDuration ?? 0,
        input.match,
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
    }
    const inventories = new Map(participantIds.map((id) => [id, [] as number[]]));
    for (const frame of input.timeline.info.frames) {
      for (const event of frame.events as RiotItemEvent[]) {
        if (!event.participantId) continue;
        inventories.set(
          event.participantId,
          applyInventoryEvent(inventories.get(event.participantId) ?? [], event),
        );
      }
      for (const participant of participants) {
        const id = Number(participant.participantId);
        const frameParticipant = frame.participantFrames[String(id)];
        if (!frameParticipant?.championStats) continue;
        const stats = frameParticipant.championStats;
        const staticStats = input.championStats.get(Number(participant.championId)) ?? {};
        const health = Number(stats.healthMax ?? 0);
        const bonusHealth = deriveBonusHealth(
          health,
          Number(frameParticipant.level ?? 1),
          Number(staticStats.hp ?? 0),
          Number(staticStats.hpperlevel ?? 0),
        );
        const result = await client.query<{ snapshot_id: string }>(
          `INSERT INTO lol_dps.timeline_snapshots
            (match_id,participant_id,timestamp_ms,minute,level,total_gold,current_gold,health_max,armor,magic_resist,attack_damage,attack_speed,ability_power,bonus_health_estimate)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
           ON CONFLICT (match_id,participant_id,timestamp_ms) DO UPDATE SET health_max=EXCLUDED.health_max
           RETURNING snapshot_id`,
          [
            input.matchId,
            id,
            frame.timestamp,
            frame.timestamp / 60000,
            frameParticipant.level,
            frameParticipant.totalGold,
            frameParticipant.currentGold,
            health,
            stats.armor ?? 0,
            stats.magicResist ?? 0,
            stats.attackDamage ?? null,
            stats.attackSpeed ?? null,
            stats.abilityPower ?? null,
            bonusHealth,
          ],
        );
        const snapshotId = result.rows[0]!.snapshot_id;
        snapshotIds.set(`${id}:${frame.timestamp}`, snapshotId);
        const inventory = inventories.get(id) ?? [];
        anchorFrames.get(id)!.push({ timestamp: frame.timestamp, inventory: [...inventory] });
        for (const [slot, itemId] of inventory.entries()) {
          await client.query(
            `INSERT INTO lol_dps.snapshot_items (snapshot_id,slot,item_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
            [snapshotId, slot, itemId],
          );
        }
      }
    }
    await createScenarioSamples(client, input, participants, anchorFrames, snapshotIds);
  });
}

async function createScenarioSamples(
  client: import("pg").PoolClient,
  input: { matchId: string; staticItems: Map<number, StaticItemShape> },
  participants: AnyRecord[],
  anchorFrames: Map<number, Array<{ timestamp: number; inventory: number[] }>>,
  snapshotIds: Map<string, string>,
): Promise<void> {
  const enemyByTeam = new Map<number, number[]>();
  for (const participant of participants) {
    const id = Number(participant.participantId);
    const list = enemyByTeam.get(Number(participant.teamId)) ?? [];
    list.push(id);
    enemyByTeam.set(Number(participant.teamId), list);
  }
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
    const third = frames.find(
      (frame) =>
        frame.inventory.filter((itemId) => {
          const item = input.staticItems.get(itemId);
          return item ? isCompletedLegendary(item) : false;
        }).length >= 3,
    );
    if (!third) continue;
    const enemies = (enemyByTeam.get(Number(anchor.p.teamId)) ?? []).filter(
      (enemyId) => enemyId !== id,
    );
    for (const enemyId of enemies) {
      const targetSnapshot = snapshotIds.get(`${enemyId}:${third.timestamp}`);
      if (!targetSnapshot) continue;
      const key = `${anchor.phase}:${id}:${targetSnapshot}`;
      if (used.has(key)) continue;
      used.add(key);
      await client.query(
        `INSERT INTO lol_dps.scenario_samples
         (patch,platform_region,phase,fallback_level,anchor_match_id,anchor_participant_id,anchor_timestamp_ms,target_snapshot_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
        [
          patch,
          platform,
          anchor.phase,
          anchor.fallback,
          input.matchId,
          id,
          third.timestamp,
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
    const anchorFrame = frames.reduce<{ timestamp: number; inventory: number[] } | null>(
      (closest, frame) =>
        !closest ||
        Math.abs(frame.timestamp - scenarioMinute * 60_000) <
          Math.abs(closest.timestamp - scenarioMinute * 60_000)
          ? frame
          : closest,
      null,
    );
    if (anchorFrame) {
      const enemies = (enemyByTeam.get(Number(minuteAnchor.teamId)) ?? []).filter(
        (enemyId) => enemyId !== id,
      );
      for (const enemyId of enemies) {
        const targetSnapshot = snapshotIds.get(`${enemyId}:${anchorFrame.timestamp}`);
        if (!targetSnapshot) continue;
        const key = `minute-window:${id}:${targetSnapshot}`;
        if (used.has(key)) continue;
        used.add(key);
        await client.query(
          `INSERT INTO lol_dps.scenario_samples
           (patch,platform_region,phase,fallback_level,anchor_match_id,anchor_participant_id,anchor_timestamp_ms,target_snapshot_id)
           VALUES ($1,$2,'minute-window',2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
          [patch, platform, input.matchId, id, anchorFrame.timestamp, targetSnapshot],
        );
      }
    }
  }
}
