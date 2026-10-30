import type { Pool } from "pg";
import { formatBhd, toFils } from "@filspay/money";
import type { TransactionRow } from "./serialize.js";

export interface TransactionsExportFilters {
  merchantId: string;
  from?: Date;
  to?: Date;
  status?: string[];
}

function csvEscape(value: string): string {
  // BUG-030: a cell starting with = + - @ TAB or CR runs as a formula in
  // Excel/Sheets; a leading ' makes the spreadsheet treat it as text (OWASP).
  if (/^[=+\-@\t\r]/.test(value)) {
    value = `'${value}`;
  }
  if (value.includes(",") || value.includes('"') || value.includes("\n") || value.includes("\r")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function toCsvRow(row: TransactionRow): string {
  return [
    row.id,
    row.status,
    formatBhd(toFils(Number(row.amount_fils))),
    formatBhd(toFils(Number(row.captured_fils))),
    csvEscape(row.reference ?? ""),
    row.occurred_at.toISOString(),
    // Last column, so readers that index the first six are unchanged (FP-300.5).
    formatBhd(toFils(Number(row.refunded_fils ?? 0))),
  ].join(",");
}

/** Builds the CSV body for `GET /v1/transactions/export`. */
export async function buildTransactionsExportCsv(
  pool: Pool,
  filters: TransactionsExportFilters,
): Promise<string> {
  const statusArray = filters.status && filters.status.length > 0 ? filters.status : null;
  const result = await pool.query<TransactionRow>(
    `SELECT * FROM transactions
      WHERE merchant_id = $1
        AND ($2::timestamptz IS NULL OR occurred_at >= $2)
        AND ($3::timestamptz IS NULL OR occurred_at <  $3)
        AND ($4::text[] IS NULL OR status = ANY($4))
      ORDER BY occurred_at ASC`,
    [filters.merchantId, filters.from ?? null, filters.to ?? null, statusArray],
  );

  const header = "id,status,amount_bhd,captured_bhd,reference,occurred_at,refunded_bhd";
  const lines = result.rows.map(toCsvRow);
  return [header, ...lines].join("\n");
}


/**
 * Cursor-paginated export for large date ranges.
 * BUG-025: the route used the in-memory builder, and this keyset paged on
 * `occurred_at` alone, so rows sharing a timestamp at a page edge were
 * skipped. Keyset on (occurred_at, id); `write` may return a promise so the
 * caller can wait for the socket to drain.
 */
export async function streamTransactionsExportCsv(
  pool: Pool,
  filters: TransactionsExportFilters,
  write: (chunk: string) => void | Promise<void>,
  pageSize = 1000,
): Promise<void> {
  await write("id,status,amount_bhd,captured_bhd,reference,occurred_at,refunded_bhd\n");

  let cursor: { occurredAt: Date; id: string } | null = null;
  const statusArray = filters.status && filters.status.length > 0 ? filters.status : null;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const result: { rows: TransactionRow[] } = await pool.query<TransactionRow>(
      `SELECT * FROM transactions
        WHERE merchant_id = $1
          AND ($2::timestamptz IS NULL OR occurred_at >= $2)
          AND ($3::timestamptz IS NULL OR occurred_at <  $3)
          AND ($4::text[] IS NULL OR status = ANY($4))
          AND ($5::timestamptz IS NULL OR (occurred_at, id) > ($5, $6::uuid))
        ORDER BY occurred_at ASC, id ASC
        LIMIT $7`,
      [filters.merchantId, filters.from ?? null, filters.to ?? null, statusArray,
        cursor?.occurredAt ?? null, cursor?.id ?? null, pageSize],
    );

    if (result.rows.length > 0) {
      await write(result.rows.map((row) => toCsvRow(row) + "\n").join(""));
    }

    if (result.rows.length < pageSize) break;
    const last = result.rows[result.rows.length - 1]!;
    cursor = { occurredAt: last.occurred_at, id: last.id };
  }
}
