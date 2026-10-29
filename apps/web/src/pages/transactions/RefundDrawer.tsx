// YA (Mar): parked until the refunds API exists — FP-212
// MK: drawer is done, just uncomment + add the route. 30 min job
// FH: claude review: posts to /v1/refunds but initiateMerchantRefund expects /v1/merchants/:id/refunds,
// and it makes a new idempotency key per click. check before uncommenting
// max refund = captured is right, partial refunds are tracked server side — am
/**
 * Parked, not wired. The drawer is finished, but `POST /v1/refunds` still
 * answers 501, so shipping the control would only put a dead button on every
 * transaction page. Restore this file and add its route in the same change —
 * it is deliberately imported nowhere in the meantime so the bundle does not
 * carry it.
 *
 * Restyled to the shadcn `Sheet` + `Field` primitives while parked so it
 * matches the rest of the dashboard the day it is switched on. Logic, API
 * call and role gate are unchanged from the original.
 */

/*
import { Undo2 } from "lucide-react";
import { useState } from "react";
import { request } from "../../api/client.js";
import { describeError } from "../../api/client.js";
import { useDashboardAuth } from "../../auth/DashboardAuthContext.js";
import { RequireRole } from "../../auth/RequireRole.js";
import { Money } from "@/components/dashboard/money";
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

export function RefundDrawer({ txn, onRefunded }: RefundDrawerProps) {
  const { me } = useDashboardAuth();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const merchantId = me?.merchant.id;
  const refundable = txn.status === "captured" || txn.status === "partially_captured";

  async function handleRefund(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!merchantId) return;
    if (!window.confirm("Refund this transaction? The money goes back to the cardholder and cannot be recalled.")) {
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const trimmed = amount.trim();
      // Left blank, amountFils is omitted entirely and the API refunds
      // everything still refundable — its own documented default, same
      // affordance the capture form has.
      const body = trimmed === "" ? { transactionId: txn.id } : { transactionId: txn.id, amountFils: Number(trimmed) };

      await request<RefundResponse>(`/v1/merchants/${encodeURIComponent(merchantId)}/refunds`, {
        method: "POST",
        // A fresh key per click, including a retry after a decline — same
        // discipline as capture and the checkout page's submit handler.
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify(body),
      });

      setOpen(false);
      setAmount("");
      // Refetch rather than patch: the refund wrote a new transaction_events
      // row server-side, so the timeline is stale, not merely shorter.
      await onRefunded();
    } catch (err) {
      setError(describeError(err));
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
          if (!submitting) setOpen(next);
        }}
      >
        <SheetTrigger render={<Button variant="outline" />}>
          <Undo2 />
          Refund
        </SheetTrigger>
        <SheetContent side="right">
          <form className="flex h-full flex-col" onSubmit={(e) => void handleRefund(e)}>
            <SheetHeader>
              <SheetTitle>Refund transaction</SheetTitle>
              <SheetDescription>
                The money goes back to the cardholder and cannot be recalled.
              </SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-4 px-4">
              <Field>
                <FieldLabel htmlFor="refund-amount">Amount in fils</FieldLabel>
                <Input
                  id="refund-amount"
                  type="number"
                  min={1}
                  step={1}
                  max={txn.capturedFils}
                  inputMode="numeric"
                  placeholder="Everything still refundable"
                  className="font-mono tabular-nums"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  disabled={submitting}
                />
                <FieldDescription>
                  Leave blank to refund everything still refundable. Captured so far:{" "}
                  <Money fils={txn.capturedFils} />.
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
          </form>
        </SheetContent>
      </Sheet>
    </RequireRole>
  );
}
*/

export {};
