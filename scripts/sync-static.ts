import { database, transaction } from "../src/db/client";
import { isCompletedLegendary } from "../src/ingestion/completed-items";

const patch = process.env.LOL_PATCH ?? "26.18";
const version = process.env.DDRAGON_VERSION ?? "16.18.1";
const base = `https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US`;

const [championResponse, itemResponse] = await Promise.all([
  fetch(`${base}/champion.json`),
  fetch(`${base}/item.json`),
]);
if (!championResponse.ok || !itemResponse.ok)
  throw new Error("Data Dragon static-data request failed");
const champions = (await championResponse.json()) as { data: Record<string, any> };
const items = (await itemResponse.json()) as { data: Record<string, any> };

await transaction(async (client) => {
  await client.query(
    `INSERT INTO lol_dps.patches (patch, ddragon_version, released_at)
     VALUES ($1, $2, DATE '2026-09-09')
     ON CONFLICT (patch) DO UPDATE SET ddragon_version = EXCLUDED.ddragon_version, synced_at = now()`,
    [patch, version],
  );
  for (const champion of Object.values(champions.data)) {
    await client.query(
      `INSERT INTO lol_dps.champions (patch, champion_id, slug, name, stats, raw)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (patch, champion_id) DO UPDATE SET stats=EXCLUDED.stats, raw=EXCLUDED.raw`,
      [patch, Number(champion.key), champion.id, champion.name, champion.stats, champion],
    );
  }
  for (const [id, item] of Object.entries(items.data)) {
    const shape = {
      id: Number(id),
      name: item.name as string,
      tags: (item.tags ?? []) as string[],
      goldTotal: Number(item.gold?.total ?? 0),
      purchasable: Boolean(item.gold?.purchasable),
      fromIds: (item.from ?? []).map(Number),
      intoIds: (item.into ?? []).map(Number),
      maps: (item.maps ?? {}) as Record<string, boolean>,
    };
    await client.query(
      `INSERT INTO lol_dps.items
        (patch,item_id,name,tags,gold_total,purchasable,from_ids,into_ids,maps,completed_legendary,raw)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (patch,item_id) DO UPDATE SET name=EXCLUDED.name, tags=EXCLUDED.tags,
         gold_total=EXCLUDED.gold_total, purchasable=EXCLUDED.purchasable,
         from_ids=EXCLUDED.from_ids, into_ids=EXCLUDED.into_ids, maps=EXCLUDED.maps,
         completed_legendary=EXCLUDED.completed_legendary, raw=EXCLUDED.raw`,
      [
        patch,
        shape.id,
        shape.name,
        shape.tags,
        shape.goldTotal,
        shape.purchasable,
        shape.fromIds,
        shape.intoIds,
        shape.maps,
        isCompletedLegendary(shape),
        item,
      ],
    );
  }
});
console.log(
  `Synced ${Object.keys(champions.data).length} champions and ${Object.keys(items.data).length} items for ${patch} (${version}).`,
);
await database().end();
