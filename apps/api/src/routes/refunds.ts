import type { FastifyInstance, FastifyRequest } from "fastify";
import { toFils } from "@filspay/money";
import { requireMerchantAuth, requireMerchantRole, requireMerchantWriterActor } from "../auth/requireMerchantAuth.js";
import { assertRefundRequestScope, initiateMerchantRefund } from "../refunds/initiateMerchantRefund.js";
import { UUID_RE } from "../admin/merchants.js";
import { BadRequestError, ForbiddenError, NotFoundError } from "../lib/errors.js";

/**
 * `POST /v1/merchants/:merchantId/refunds` (FP-300.1). Registered under the
 * `/v1/merchants` prefix, the path the web app's RefundDrawer and
 * `initiateMerchantRefund` already use (decision Q-1). The old `/v1/refunds`
 * 501 stub is gone.
 *
 * Guards, in order: a merchant session or API key; role owner or finance
 * (support cannot move money); the path merchant must be the caller's own;
 * never an admin "view as merchant" grant (read-only); a required
 * Idempotency-Key header, so a retried request can never refund twice.
 */
interface RefundParams {
  merchantId: string;
}

interface RefundBody {
  transactionId?: unknown;
  amountFils?: unknown;
  reason?: unknown;
}

function getIdempotencyKey(request: FastifyRequest): string {
  const header = request.headers["idempotency-key"];
  const key = Array.isArray(header) ? header[0] : header;
  if (!key || key.trim() === "") {
    throw new BadRequestError("idempotency_key_required", "Idempotency-Key header is required");
  }
  return key;
}

export async function refundRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: RefundParams; Body: RefundBody }>(
    "/:merchantId/refunds",
    { preHandler: [requireMerchantAuth, requireMerchantRole("owner", "finance")] },
    async (request, reply) => {
      const auth = request.merchantAuth!;
      assertRefundRequestScope(auth, request.params.merchantId);
      if (auth.actorType === "admin_impersonation") {
        throw new ForbiddenError("impersonation_read_only");
      }
      const idempotencyKey = getIdempotencyKey(request);

      const { transactionId, amountFils, reason } = request.body ?? {};
      if (typeof transactionId !== "string" || transactionId === "") {
        throw new BadRequestError("invalid_request", "transactionId is required");
      }
      if (!UUID_RE.test(transactionId)) {
        throw new NotFoundError("transaction_not_found");
      }
      if (amountFils !== undefined && (typeof amountFils !== "number" || !Number.isSafeInteger(amountFils) || amountFils <= 0)) {
        throw new BadRequestError("refund_amount_invalid", "amountFils must be a positive whole number of fils");
      }
      if (reason !== undefined && (typeof reason !== "string" || reason.length > 500)) {
        throw new BadRequestError("invalid_request", "reason must be a string of at most 500 characters");
      }

      const result = await initiateMerchantRefund(app.db, app.acquirer, {
        merchantId: auth.merchantId,
        transactionId,
        amountFils: amountFils !== undefined ? toFils(amountFils) : undefined,
        idempotencyKey,
        actor: requireMerchantWriterActor(auth),
        reason,
      });
      reply.code(result.statusCode).send(result.body);
    },
  );
}
