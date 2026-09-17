import { Pool, type PoolClient, type QueryResultRow } from "pg";

let pool: Pool | undefined;

export function hasDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function database(): Pool {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");
  // Keep the hot pool deliberately small and let idle web instances release sockets. This helps
  // the web service sleep when Railway applies its serverless policy without putting Postgres in
  // an unverified scale-to-zero mode.
  pool ??= new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 3,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    allowExitOnIdle: true,
  });
  return pool;
}

export async function query<T extends QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  const result = await database().query<T>(text, values);
  return result.rows;
}

export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await database().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
