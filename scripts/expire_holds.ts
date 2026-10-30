#!/usr/bin/env -S npx tsx
/**
 * Nightly janitor: a hold that's never captured or released would sit as
 * 'active' past its expires_at forever. This flips it to 'expired' (holds
 * are never deleted — docs/HANDOVER.md). Run once a night from cron/the
 * host's own scheduler.
 *
 * Usage: DATABASE_URL=postgres://... npx tsx scripts/expire_holds.ts
 */
import { pathToFileURL } from "node:url";
import { Client } from "pg";

/**
 * One statement, so there is no gap between finding expired holds and
 * changing them (a hold captured in between is no longer 'active' and is
 * left alone), and a night with nothing expired matches no rows.
 */
export const EXPIRE_HOLDS_SQL = `UPDATE holds SET status = 'expired' WHERE status = 'active' AND expires_at < now()`;

/** Flips every active hold past expires_at to 'expired'; returns how many. */
export async function expireHolds(client: Pick<Client, "query">): Promise<number> {
  const result = await client.query(EXPIRE_HOLDS_SQL);
  return result.rowCount ?? 0;
}

/**
 * Expires only holds that are still 'active' and past expires_at. Captured
 * or released holds are never touched, and a night with nothing expired
 * changes no rows.
 */
async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("expire_holds: DATABASE_URL environment variable is not set");
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const expired = await expireHolds(client);
    console.log(`expire_holds: expired ${expired} abandoned hold(s)`);
  } finally {
    await client.end();
  }
}

const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
}
