import { database, query, transaction } from "../src/db/client";
import { archiveEnabled, listArchiveKeys, verifyArchiveKey } from "../src/storage/archive";

if (!archiveEnabled()) throw new Error("Railway bucket S3 variables are not configured.");
const pending = await query<{
  archive_object_id: string;
  object_key: string;
  sha256: string;
  compressed_bytes: string;
}>(
  `SELECT archive_object_id, object_key, sha256, compressed_bytes
     FROM lol_dps.archive_objects
    WHERE status IN ('pending','failed')
    ORDER BY archive_object_id
    LIMIT 1000`,
);
let repaired = 0;
for (const row of pending) {
  try {
    const result = await verifyArchiveKey(row.object_key, {
      sha256: row.sha256,
      compressedBytes: Number(row.compressed_bytes),
    });
    if (!result.bytesMatch || !result.checksumMatch) continue;
    await transaction(async (client) => {
      await client.query(
        `UPDATE lol_dps.archive_objects SET status='verified', verified_at=now(), error=NULL WHERE archive_object_id=$1`,
        [row.archive_object_id],
      );
    });
    repaired += 1;
  } catch {
    // Missing objects remain pending for a later retry; no destructive cleanup occurs here.
  }
}
const keys = await listArchiveKeys();
console.log(
  `Archive reconciliation checked ${pending.length} manifest(s), repaired ${repaired}, observed ${keys.length} raw object(s).`,
);
await database().end();
