import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { database } from "../src/db/client";

const directory = join(process.cwd(), "migrations");
const files = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort();
for (const file of files) {
  const sql = await readFile(join(directory, file), "utf8");
  await database().query(sql);
  console.log(`Applied ${file}`);
}
await database().end();
