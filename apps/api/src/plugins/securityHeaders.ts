import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import type { Config } from "../config.js";

export interface SecurityHeadersPluginOptions {
  config: Pick<Config, "nodeEnv">;
}

/**
 * Security headers on every reply, errors and 404s included (SEC-3). The
 * API only ever answers JSON or CSV, so the CSP allows nothing at all: a
 * response opened in a browser can't run script or be framed. No helmet
 * dependency for six fixed headers.
 */
export const securityHeadersPlugin = fp<SecurityHeadersPluginOptions>(
  async (app: FastifyInstance, opts): Promise<void> => {
    const production = opts.config.nodeEnv === "production";

    app.addHook("onSend", async (request, reply, payload) => {
      reply.header("x-content-type-options", "nosniff");
      reply.header("x-frame-options", "DENY");
      reply.header("referrer-policy", "no-referrer");
      reply.header("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
      reply.removeHeader("x-powered-by");
      // Only in production: HSTS pins the host to HTTPS in the browser for a
      // year, which would break plain-HTTP localhost dev.
      if (production) {
        reply.header("strict-transport-security", "max-age=31536000; includeSubDomains");
      }
      // Session-bound data (balances, transactions, CSV exports) must never
      // land in a shared or browser cache.
      if (request.url.startsWith("/v1/")) {
        reply.header("cache-control", "no-store");
      }
      return payload;
    });
  },
);
