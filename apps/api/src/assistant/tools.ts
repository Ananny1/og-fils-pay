import type Anthropic from "@anthropic-ai/sdk";
import type { Pool } from "pg";
import { formatBhd, toFils } from "@filspay/money";
import { listTransactions } from "../transactions/query.js";
import { getReconciliationReport, listSettlementBatches } from "../settlement/query.js";

/**
 * Read-only tools the dashboard assistant can call. Every tool is scoped to
 * the merchant from the authenticated session (`ToolContext.merchantId`) —
 * the model never supplies a merchant id, so it cannot read another shop's
 * data no matter what the user types.
 *
 * Amounts go back to the model twice: the integer `*Fils` value and a
 * pre-formatted `*Bhd` string from `formatBhd`, so the model quotes BD
 * amounts without doing any division itself (1 BD = 1000 fils).
 */
export interface ToolContext {
  pool: Pool;
  merchantId: string;
  role: "owner" | "finance" | "support" | null;
}

export const ASSISTANT_TOOLS: Anthropic.Beta.BetaToolUnion[] = [
  {
    name: "list_transactions",
    description:
      "List this merchant's card transactions, newest first. Use for questions about specific payments, recent activity, captures, voids or a reference. Dates are Bahrain calendar dates (YYYY-MM-DD); `to` is exclusive.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        status: {
          type: "array",
          items: {
            type: "string",
            enum: ["authorized", "captured", "partially_captured", "voided", "partially_refunded", "refunded", "chargeback"],
          },
          description: "Only these statuses. Empty array means all.",
        },
        from: { type: ["string", "null"], description: "Start date, inclusive, or null." },
        to: { type: ["string", "null"], description: "End date, exclusive, or null." },
        search: { type: ["string", "null"], description: "Reference, acquirer reference or transaction id fragment, or null." },
        limit: { type: "integer", description: "How many rows, 1-50." },
      },
      required: ["status", "from", "to", "search", "limit"],
    },
  },
  {
    name: "list_settlement_batches",
    description:
      "List this merchant's daily settlement batches (gross, fee, net payout, status open/closed/paid). One batch per Bahrain business day. Use for payout and fee questions.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        status: { type: "array", items: { type: "string", enum: ["open", "closed", "paid"] } },
        from: { type: ["string", "null"] },
        to: { type: ["string", "null"] },
        limit: { type: "integer", description: "How many batches, 1-60." },
      },
      required: ["status", "from", "to", "limit"],
    },
  },
  {
    name: "get_reconciliation",
    description:
      "Reconciliation for a period: ledger merchant payable vs settled net payout vs pending (not yet batched), and the gap. Owner/finance users only. Use when asked whether the books tie out.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        from: { type: "string" },
        to: { type: "string" },
      },
      required: ["from", "to"],
    },
  },
];

function bhd(fils: number): string {
  const negative = fils < 0;
  return `${negative ? "-" : ""}${formatBhd(toFils(Math.abs(fils)))} BHD`;
}

/** `YYYY-MM-DD` Bahrain date → the UTC instant that day starts at. */
function bahrainDayStart(date: string): Date {
  return new Date(`${date}T00:00:00+03:00`);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function str(v: unknown): string | undefined {
  return typeof v === "string" && v !== "" ? v : undefined;
}
/** A `YYYY-MM-DD` date, or undefined; anything else is an error the model sees. */
function date(v: unknown, field: string): string | undefined {
  const s = str(v);
  if (s === undefined) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(new Date(`${s}T00:00:00Z`).getTime())) {
    throw new Error(`${field} must be a date like 2026-10-29.`);
  }
  return s;
}
function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}
function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === "number" && Number.isInteger(v) ? Math.min(max, Math.max(min, v)) : fallback;
}

/** Runs one tool call. Returns JSON text for the tool_result, or throws a
 *  plain Error whose message is safe to show the model. */
export async function runAssistantTool(name: string, rawInput: unknown, ctx: ToolContext): Promise<string> {
  const input = isObject(rawInput) ? rawInput : {};

  switch (name) {
    case "list_transactions": {
      const from = date(input.from, "from");
      const to = date(input.to, "to");
      const status = strArray(input.status);
      const result = await listTransactions(ctx.pool, {
        merchantId: ctx.merchantId,
        status: status.length ? status : undefined,
        from: from ? bahrainDayStart(from) : undefined,
        to: to ? bahrainDayStart(to) : undefined,
        search: str(input.search),
        limit: clampInt(input.limit, 1, 50, 20),
      });
      return JSON.stringify({
        count: result.transactions.length,
        more: result.nextCursor !== null,
        transactions: result.transactions.map((t) => ({
          id: t.id,
          reference: t.reference,
          status: t.status,
          authorizedFils: t.amountFils,
          authorizedBhd: bhd(t.amountFils),
          capturedFils: t.capturedFils,
          capturedBhd: bhd(t.capturedFils),
          occurredAt: t.occurredAt,
        })),
      });
    }

    case "list_settlement_batches": {
      const from = date(input.from, "from");
      const to = date(input.to, "to");
      const status = strArray(input.status);
      const result = await listSettlementBatches(ctx.pool, {
        merchantId: ctx.merchantId,
        status: status.length ? status : undefined,
        from: from ? new Date(from) : undefined,
        to: to ? new Date(to) : undefined,
        limit: clampInt(input.limit, 1, 60, 14),
      });
      let gross = 0;
      let fee = 0;
      let net = 0;
      const batches = result.batches.map((b) => {
        gross += b.grossFils;
        fee += b.feeFils;
        net += b.netPayoutFils;
        return {
          batchDate: b.batchDate,
          status: b.status,
          grossBhd: bhd(b.grossFils),
          feeBhd: bhd(b.feeFils),
          netPayoutBhd: bhd(b.netPayoutFils),
          closedAt: b.closedAt,
          paidAt: b.paidAt,
        };
      });
      return JSON.stringify({
        count: batches.length,
        more: result.nextCursor !== null,
        totals: { grossBhd: bhd(gross), feeBhd: bhd(fee), netPayoutBhd: bhd(net) },
        batches,
      });
    }

    case "get_reconciliation": {
      if (ctx.role !== "owner" && ctx.role !== "finance") {
        throw new Error("Reconciliation is only available to owner and finance users.");
      }
      const from = date(input.from, "from");
      const to = date(input.to, "to");
      if (!from || !to) throw new Error("from and to (YYYY-MM-DD) are both required.");
      const r = await getReconciliationReport(ctx.pool, { merchantId: ctx.merchantId, from, to });
      return JSON.stringify({
        periodFrom: r.periodFrom,
        periodTo: r.periodTo,
        ledgerMerchantPayableBhd: bhd(r.ledgerMerchantPayableNetFils),
        settlementNetPayoutBhd: bhd(r.settlementNetPayoutFils),
        pendingUnbatchedBhd: bhd(r.pendingUnbatchedFils),
        gapFils: r.gapFils,
        gapBhd: bhd(r.gapFils),
        reconciled: r.explained && r.gapFils === 0,
      });
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
