import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";

export interface LoadSheddingOptions {
  /** Requests allowed in flight at once. 0 turns shedding off. */
  maxInFlight: number;
  /** Value of the Retry-After header on a shed request, seconds. */
  retryAfterSeconds: number;
}

/** Health probes are never shed: a busy api is still alive, and the
 *  container health check must not restart it for being busy. */
const NEVER_SHED = new Set(["/healthz", "/readyz"]);

/**
 * Turns away excess load fast. With 0.5 vCPU and a small pg pool, the api
 * can only work on a limited number of requests at once; without a cap,
 * extra requests pile up in memory and every client (old and new) waits
 * until it times out. Over the cap we answer `503` + `Retry-After` at once,
 * before any body parsing or database work, so the requests already
 * accepted keep their normal latency.
 */
export const loadSheddingPlugin = fp(async (app: FastifyInstance, opts: LoadSheddingOptions): Promise<void> => {
  if (opts.maxInFlight <= 0) return;
  let inFlight = 0;

  app.addHook("onRequest", async (request, reply) => {
    if (NEVER_SHED.has(request.url)) return;
    if (inFlight >= opts.maxInFlight) {
      reply.header("Retry-After", String(opts.retryAfterSeconds));
      reply.code(503);
      return reply.send({ error: "service_unavailable", message: "Server busy, retry shortly" });
    }
    inFlight++;
    // 'close' fires once per response, whether it finished or the client
    // went away, so the slot is always given back.
    reply.raw.once("close", () => {
      inFlight--;
    });
  });
});
