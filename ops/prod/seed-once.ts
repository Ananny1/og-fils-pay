/**
 * Hosted stack only (ops/docker-compose.prod.yml): seed the database once.
 * db/seed/index.ts truncates and regenerates its tables on every run, so
 * running it on every deploy would wipe real payments. This wrapper runs
 * the seed only when no merchant exists yet (decision Q-7: seed once).
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

async function main(): Promise<void> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  let empty: boolean;
  try {
    const result = await client.query<{ empty: boolean }>("SELECT NOT EXISTS (SELECT 1 FROM merchants) AS empty");
    empty = result.rows[0]?.empty === true;
  } finally {
    await client.end();
  }
  if (!empty) {
    console.log("seed-once: database already has merchants, skipping seed");
    return;
  }
  console.log("seed-once: empty database, running seed");
  const seedPath = join(dirname(fileURLToPath(import.meta.url)), "seed.mjs");
  const run = spawnSync(process.execPath, [seedPath], { stdio: "inherit" });
  process.exitCode = run.status ?? 1;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
