import type { FastifyInstance } from "fastify";
import { isReady } from "../health/state.js";

/**
 * Liveness/readiness. Liveness checks the process only; readiness checks
 * that boot finished AND that the database answers a `SELECT 1` right now
 * (bounded by READYZ_DB_TIMEOUT_MS), so a database outage after boot takes
 * the instance out of rotation instead of being invisible (OPS-001).
 */
const READYZ_DB_TIMEOUT_MS = 2_000;

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  // GET /healthz — liveness. Never touches the database. Returns 200 as
  // long as the Node process is up and Fastify can handle a request.
  app.get("/healthz", async () => ({ status: "ok", uptimeSeconds: process.uptime() }));

  // GET /readyz — readiness. Not ready until the boot-time DB check has
  // passed (index.ts), and after that re-checks the live database on every
  // poll. The probe is time-bounded so a hung database fails the check fast
  // instead of hanging the prober; probes are cheap (one round-trip), so
  // pollers should keep a sane interval (compose: every 10s).
  app.get("/readyz", async (_req, reply) => {
    if (!isReady()) {
      reply.code(503);
      return { status: "not_ready", reason: "booting" };
    }
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        app.db.query("SELECT 1"),
        new Promise((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error("readyz: database probe timed out")), READYZ_DB_TIMEOUT_MS);
        }),
      ]);
    } catch {
      reply.code(503);
      return { status: "not_ready", reason: "database_unreachable" };
    } finally {
      clearTimeout(timer);
    }
    return { status: "ready" };
  });
}
