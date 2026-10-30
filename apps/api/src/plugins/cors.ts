import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";

/**
 * Minimal CORS for the two browser frontends (apps/web on :5173, apps/admin
 * on :5174). Both call the API from another origin with `credentials:
 * "include"`, which requires an exact `Access-Control-Allow-Origin` echo plus
 * `Access-Control-Allow-Credentials: true`; a wildcard is not allowed with
 * cookies. Unknown origins get no CORS headers at all, so the session cookie
 * is never exposed to them.
 *
 * Override the allow-list with CORS_ALLOWED_ORIGINS (comma-separated).
 */
const DEFAULT_ALLOWED_ORIGINS = ["http://localhost:5173", "http://localhost:5174"];

export function allowedOrigins(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const raw = env.CORS_ALLOWED_ORIGINS;
  if (raw === undefined || raw.trim() === "") return new Set(DEFAULT_ALLOWED_ORIGINS);
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
}

export const corsPlugin = fp(async (app: FastifyInstance): Promise<void> => {
  const allowed = allowedOrigins();

  app.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;
    reply.header("Vary", "Origin");
    if (origin === undefined || !allowed.has(origin)) return;

    reply.header("Access-Control-Allow-Origin", origin);
    reply.header("Access-Control-Allow-Credentials", "true");

    if (request.method === "OPTIONS") {
      reply.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
      reply.header(
        "Access-Control-Allow-Headers",
        request.headers["access-control-request-headers"] ?? "Content-Type, Authorization",
      );
      reply.header("Access-Control-Max-Age", "600");
      reply.code(204).send();
    }
  });
});
