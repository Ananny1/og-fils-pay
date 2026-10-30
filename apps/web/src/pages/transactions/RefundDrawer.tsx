/**
 * Refund drawer on the transaction detail page (FP-300). Posts to
 * `POST /v1/merchants/:merchantId/refunds` (FP-300.1). Shown only to owner and
 * finance (the server also answers 403 to support) and only while something
 * captured is still left to refund.
 *
 * Amounts are typed in BD with up to 3 decimals and turned into integer fils
 * with `parseBhdToFils` (string maths, never a float).
 */
import { Undo2 } from "lucide-react";
import { useState, useRef } from "react";
import { parseBhdToFils } from "@filspay/money";
import { keyForNextAttempt } from "./refundIdempotency.js";
import { ApiError, describeError, request } from "../../api/client.js";
import { useDashboardAuth } from "../../auth/DashboardAuthContext.js";
import { RequireRole } from "../../auth/RequireRole.js";
import { Money, formatMoney } from "@/components/dashboard/money";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import type { TransactionDto } from "../../types.js";
import { CheckedForm } from "@/components/checked-form";

interface RefundResponse {
  id: string;
  transactionId: string;
  amountFils: number;
  feeReversedFils: number;
  status: string;
  transactionStatus: string;
  refundedTotalFils: number;
  occurredAt: string;
}

interface RefundDrawerProps {
  txn: TransactionDto;
  onRefunded: () => Promise<void>;
}

const REFUNDABLE_STATUSES = new Set(["captured", "partially_captured", "partially_refunded"]);

/** The refund API's error codes in plain words. Validation errors come back
 *  as `{ code }`, the rest as `{ error }`. */
export function describeRefundError(err: unknown): string {
  if (err instanceof ApiError) {
    const code = err.body.error ?? (err.body.code as string | undefined);
    switch (code) {
      case "refund_exceeds_refundable": {
        const left = typeof err.body.refundableFils === "number" ? err.body.refundableFils : null;
        return left === null
          ? "That is more than can still be refunded on this payment."
          : `That is more than can still be refunded. At most ${formatMoney(left)} BHD can go back.`;
      }
      case "request_in_progress":
        return "A refund for this payment is already being processed. Wait a moment, then refresh the page.";
      case "transaction_not_refundable":
        return "This payment can no longer be refunded.";
      case "refund_amount_invalid":
        return "Enter an amount above 0.000 BHD.";
      case "refund_declined":
        return "The card network declined the refund. Nothing was refunded.";
      case "acquirer_unavailable":
        return "The card network did not answer. Nothing was refunded. Please try again.";
      case "refunds_on_hold":
        return "Refunds are on hold for your account. Please contact FilsPay support.";
      case "transaction_not_found":
        return "This payment was not found on your account.";
      default:
        break;
    }
  }
  return describeError(err);
}

export function RefundDrawer({ txn, onRefunded }: RefundDrawerProps) {
  const { me } = useDashboardAuth();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per intended refund; kept across a retry whose answer was lost.
  const idempotencyKey = useRef<string | null>(null);

  const merchantId = me?.merchant.id;
  const refundableFils = Math.max(0, txn.capturedFils - (txn.refundedFils ?? 0));
  const refundable = REFUNDABLE_STATUSES.has(txn.status) && refundableFils > 0;

  async function handleRefund(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!merchantId) return;

    const trimmed = amount.trim();
    let amountFils: number | undefined;
    if (trimmed !== "") {
      try {
        amountFils = parseBhdToFils(trimmed);
      } catch {
        setError("Enter the amount in BHD, for example 2.500 (at most 3 decimals).");
        return;
      }
      if (amountFils <= 0) {
        setError("Enter an amount above 0.000 BHD.");
        return;
      }
    }

    setSubmitting(true);
    setError(null);
    try {
      // Left blank, amountFils is omitted and the API refunds everything
      // still refundable — its own default, same as the capture form.
      const body = amountFils === undefined ? { transactionId: txn.id } : { transactionId: txn.id, amountFils };

      idempotencyKey.current ??= crypto.randomUUID();
      const usedKey = idempotencyKey.current;
      try {
        await request<RefundResponse>(`/v1/merchants/${encodeURIComponent(merchantId)}/refunds`, {
          method: "POST",
          headers: { "Idempotency-Key": usedKey },
          body: JSON.stringify(body),
        });
        idempotencyKey.current = keyForNextAttempt(usedKey, true);
      } catch (err) {
        // BUG-096: a fresh key on a retry after a lost answer refunded twice.
        idempotencyKey.current = keyForNextAttempt(usedKey, err instanceof ApiError);
        throw err;
      }

      setOpen(false);
      setAmount("");
      // Refetch rather than patch: the refund wrote a new transaction_events
      // row server-side, so the timeline is stale, not merely shorter.
      await onRefunded();
    } catch (err) {
      setError(describeRefundError(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (!refundable) return null;

  return (
    <RequireRole allow={["owner", "finance"]}>
      <Sheet
        open={open}
        onOpenChange={(next) => {
          if (!submitting) {
            setOpen(next);
            setError(null);
          }
        }}
      >
        <SheetTrigger render={<Button variant="outline" />}>
          <Undo2 />
          Refund
        </SheetTrigger>
        <SheetContent side="right">
          <CheckedForm className="flex h-full flex-col" onSubmit={(e) => void handleRefund(e)}>
            <SheetHeader>
              <SheetTitle>Refund payment</SheetTitle>
              <SheetDescription>
                The money goes back to the cardholder. This cannot be undone.
              </SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-4 px-4">
              <Field>
                <FieldLabel htmlFor="refund-amount">Amount (BHD)</FieldLabel>
                <Input
                  id="refund-amount"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder={formatMoney(refundableFils)}
                  className="font-mono tabular-nums"
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    // A different amount is a different refund.
                    idempotencyKey.current = null;
                  }}
                  disabled={submitting}
                />
                <FieldDescription>
                  Leave blank to refund everything left: <Money fils={refundableFils} />. Captured{" "}
                  <Money fils={txn.capturedFils} />, already refunded <Money fils={txn.refundedFils ?? 0} />.
                </FieldDescription>
                {error ? <FieldError>{error}</FieldError> : null}
              </Field>
            </div>
            <SheetFooter>
              <Button type="submit" variant="destructive" disabled={submitting}>
                {submitting ? <Spinner /> : <Undo2 />}
                {submitting ? "Refunding…" : "Refund"}
              </Button>
              <SheetClose render={<Button variant="outline" disabled={submitting} />}>Cancel</SheetClose>
            </SheetFooter>
          </CheckedForm>
        </SheetContent>
      </Sheet>
    </RequireRole>
  );
}
