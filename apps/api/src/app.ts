import Fastify, { type FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { Config } from "./config.js";
import { createAcquirerSimulator } from "./acquirer/simulator.js";
import { cookiesPlugin } from "./plugins/cookies.js";
import { multipartPlugin } from "./plugins/multipart.js";
import { errorHandler } from "./plugins/errorHandler.js";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { businessProfileRoutes } from "./routes/businessProfile.js";
import { kycRoutes } from "./routes/kyc.js";
import { apiKeyRoutes } from "./routes/apiKeys.js";
import { transactionRoutes } from "./routes/transactions.js";
import { refundRoutes } from "./routes/refunds.js";
import { paymentLinkMerchantRoutes, paymentLinkPublicRoutes } from "./routes/paymentLinks.js";
import { webhookEndpointRoutes } from "./routes/webhooks.js";
import { settlementRoutes } from "./routes/settlement.js";
import { analyticsRoutes } from "./routes/analytics.js";
import { reportingRoutes } from "./routes/reporting.js";
import { adminRoutes, type AdminRoutesOptions } from "./routes/admin.js";
import { acquirerCallbackRoutes } from "./routes/acquirerCallbacks.js";
import { createFetchTransport, type WebhookTransport } from "./webhooks/transport.js";

export interface BuildAppOptions {
  /** Test seam for the admin plane's cross-process settlement calls only —
   *  see routes/admin.ts. Never set in production. */
  admin?: AdminRoutesOptions;
  /** The outbound HTTP sender the merchant-facing "send test event" route
   *  uses (routes/webhooks.ts). Defaults to the same `createFetchTransport()`
   *  the dispatcher runs on; index.ts passes its own instance in so one
   *  process has exactly one transport. Tests inject a stub. */
  webhookTransport?: WebhookTransport;
}

/**
 * Builds a non-listening Fastify instance: config loaded, DB pool
 * decorated, plugins + routes registered, in a fixed order so later work
 * extends this by adding one `app.register(...)` line each. Route-level
 * tests use `app.inject(...)` against this — no real socket needed.
 */
export function buildApp(config: Config, pool: Pool, options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: true,
    bodyLimit: config.bodyLimitBytes,
    requestTimeout: config.httpRequestTimeoutMs,
  });

  app.decorate("db", pool);
  app.decorate("config", config);
  app.decorate("acquirer", createAcquirerSimulator(config));
  app.decorate("webhookTransport", options.webhookTransport ?? createFetchTransport());

  installOverloadGuard(app, config.maxInFlightRequests);

  app.register(cookiesPlugin);
  app.register(multipartPlugin, { config });
  app.setErrorHandler(errorHandler);

  app.register(healthRoutes); // unauthenticated, unprefixed
  app.register(authRoutes, { prefix: "/v1/auth" });
  app.register(businessProfileRoutes, { prefix: "/v1/merchants" });
  app.register(kycRoutes, { prefix: "/v1/merchants" });
  app.register(apiKeyRoutes, { prefix: "/v1/merchants" });
  // v1/routes/transactions.ts is NOT this one. that tree is dead — MK
  app.register(transactionRoutes, { prefix: "/v1/transactions" });
  // FP-212: RefundDrawer posts to /v1/merchants/:id/refunds, initiateMerchantRefund expects
  // that path too. this prefix is the old stub — am
  // MK: keep /v1/refunds, API.md documents it. the drawer is wrong
  // FH: API.md has both?? asked in #eng, no answer yet (12/10/2026)
  app.register(refundRoutes, { prefix: "/v1/refunds" });
  app.register(paymentLinkMerchantRoutes, { prefix: "/v1/merchants" });
  app.register(paymentLinkPublicRoutes, { prefix: "/v1/payment-links" });
  app.register(webhookEndpointRoutes, { prefix: "/v1/merchants" });
  app.register(settlementRoutes, { prefix: "/v1/settlement" });
  app.register(analyticsRoutes, { prefix: "/v1/analytics" });
  app.register(reportingRoutes, { prefix: "/v1/reporting" });
  // FH: "the acquirer signature is the only auth" — and inboundVerify rejects unsigned requests, so OK
  app.register(acquirerCallbackRoutes, { prefix: "/v1/acquirer" }); // public — acquirer signature is the only auth
  // The admin plane, including KYC review
  // (POST /v1/admin/merchants/:id/kyc-reviews).
  // am: register order matters for the error handler? nvm fastify encapsulation
  app.register(adminRoutes, { ...(options.admin ?? {}), prefix: "/v1/admin" });
  // The webhook *dispatcher* (LISTEN/NOTIFY + poll) is deliberately NOT
  // started here — see webhooks/dispatcher.ts and index.ts. apps/reporting's
  // consumer is likewise started by its own entrypoint, never from here.

  return app;
}

/** Probes must keep answering while the API sheds load, or Docker/nginx
 *  would mark a busy-but-healthy instance dead. */
const UNGUARDED_ROUTES = new Set(["/healthz", "/readyz"]);

/**
 * Load shedding (OPS-002). Counts requests currently being processed; once
 * `maxInFlight` are in progress, a new request is answered at once with
 * 503 + `Retry-After: 1` and never reaches a handler or the DB pool. The
 * alternative — accepting everything — lets a burst queue up behind a
 * 0.5 vCPU event loop and a small pg pool until *every* request is slow and
 * times out (no one gets served). 0 disables the guard.
 */
function installOverloadGuard(app: FastifyInstance, maxInFlight: number): void {
  if (maxInFlight <= 0) return;
  let inFlight = 0;
  app.addHook("onRequest", (request, reply, done) => {
    if (UNGUARDED_ROUTES.has(request.routeOptions.url ?? "")) {
      done();
      return;
    }
    if (inFlight >= maxInFlight) {
      reply
        .code(503)
        .header("retry-after", "1")
        .send({ error: "overloaded", message: "server is busy, retry shortly" });
      return;
    }
    inFlight += 1;
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      inFlight -= 1;
    };
    // 'finish' = response fully written; 'close' also fires when the client
    // goes away first. Either frees the slot, exactly once.
    reply.raw.once("finish", release);
    reply.raw.once("close", release);
    done();
  });
}
