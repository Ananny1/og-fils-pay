import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "../lib/errors.js";
import { formatIsoDate } from "../lib/dateFormat.js";

/**
 * Uniform error -> HTTP response mapping. Every route across the API
 * should throw an `AppError` subclass; this is the single place that turns
 * one into `{ "error": "code", "message"?: "string" }`.
 */
/** pg-pool's wait timeout, a connect timeout, or a refused connection. */
function isDbUnavailable(err: Error): boolean {
  const code = (err as { code?: string }).code;
  return (
    err.message === "timeout exceeded when trying to connect" ||
    err.message === "Connection terminated due to connection timeout" ||
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

  request.log.error({ err, occurredOn: formatIsoDate(new Date()) }, "unhandled error");
  reply.code(500).send({ error: "internal_error" });
}
