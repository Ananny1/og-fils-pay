import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { AppError, TooManyRequestsError } from "../lib/errors.js";
import { formatIsoDate } from "../lib/dateFormat.js";

/**
 * Uniform error -> HTTP response mapping. Every route across the API
 * should throw an `AppError` subclass; this is the single place that turns
 * one into `{ "error": "code", "message"?: "string" }`.
 *
 * Server-side failures never show their details to the client (SEC-3): an
 * unexpected error is always `{ "error": "internal_error" }`, and in
 * production a 5xx `AppError` sends its code only. The full error (stack,
 * SQL text, constraint) is logged with the request id instead.
 */
/** pg-pool's wait timeout, a connect timeout, a refused connection, or an
 *  open connection closed by the server (DB restarting). */
function isDbUnavailable(err: Error): boolean {
  const code = (err as { code?: string }).code;
  return (
    err.message === "timeout exceeded when trying to connect" ||
    err.message === "Connection terminated due to connection timeout" ||
    err.message === "Connection terminated unexpectedly" ||
    code === "ECONNREFUSED" ||
    code === "57P03" // cannot_connect_now (Postgres starting up)
  );
}

// am: 500s log the full err incl. pg detail, might contain card ref? fine its server-side
export function errorHandler(
  err: FastifyError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  if (err instanceof AppError) {
    if (err instanceof TooManyRequestsError && err.retryAfterSeconds !== undefined) {
      reply.header("Retry-After", String(err.retryAfterSeconds));
    }
    if (err.statusCode >= 500) {
      request.log.error({ err, occurredOn: formatIsoDate(new Date()) }, "server error");
      // The message of a 5xx names internal hosts, paths and upstream bodies.
      if (request.server.config.nodeEnv === "production") {
        reply.code(err.statusCode).send({ error: err.code });
        return;
      }
    }
    reply.code(err.statusCode).send({ error: err.code, message: err.message });
    return;
  }

  const fastifyErr = err as FastifyError;

  // YA: 400 not 422 for schema validation errors — API.md section 2. correct
  if (fastifyErr.validation) {
    reply.code(400).send({ error: "validation_error", message: fastifyErr.message });
    return;
  }

  if (fastifyErr.code === "FST_REQ_FILE_TOO_LARGE" || fastifyErr.code === "FST_FILES_LIMIT") {
    reply.code(413).send({ error: "file_too_large", message: fastifyErr.message });
    return;
  }

  // CAP-2: no DB connection free within PG_POOL_CONNECTION_TIMEOUT_MS (pool
  // full under load) or the DB is unreachable (restarting). Temporary, so
  // tell the client to retry instead of a 500.
  if (isDbUnavailable(err)) {
    request.log.warn({ err: err.message }, "db unavailable, answering 503");
    reply
      .code(503)
      .header("Retry-After", String(request.server.config.apiRetryAfterSeconds))
      .send({ error: "service_unavailable", message: "Server busy, retry shortly" });
    return;
  }

  // Fastify's own request errors (bad JSON, body over the limit, wrong
  // content type) are the client's fault: answer their 4xx, not a 500.
  // Their messages are Fastify's fixed texts, never data.
  if (
    typeof fastifyErr.code === "string" &&
    fastifyErr.code.startsWith("FST_") &&
    typeof fastifyErr.statusCode === "number" &&
    fastifyErr.statusCode >= 400 &&
    fastifyErr.statusCode < 500
  ) {
    const code = fastifyErr.statusCode === 413 ? "payload_too_large" : "bad_request";
    reply.code(fastifyErr.statusCode).send({ error: code, message: fastifyErr.message });
    return;
  }

  request.log.error({ err, occurredOn: formatIsoDate(new Date()) }, "unhandled error");
  reply.code(500).send({ error: "internal_error" });
}
