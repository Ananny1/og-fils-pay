import { RefreshCw } from "lucide-react";
import { BotIcon } from "@/components/dashboard/bot-icon";
import { motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { getPayoutExplanation } from "@/api/assistant";
import { ApiError, describeError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

type State = { kind: "loading" } | { kind: "ready"; text: string } | { kind: "error"; message: string } | { kind: "off" };

/** "In plain words" card on a settlement batch: Claude explains the payout.
 *  Hidden entirely when the assistant isn't configured on the API. */
export function PayoutExplanation({ batchId }: { batchId: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const res = await getPayoutExplanation(batchId);
      setState({ kind: "ready", text: res.explanation });
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 503) setState({ kind: "off" });
      else setState({ kind: "error", message: describeError(err) });
    }
  }, [batchId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.kind === "off") return null;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/[0.07] via-card to-card p-5 shadow-card">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15">
          <BotIcon className="size-5" thinking={state.kind === "loading"} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold">This payout in plain words</p>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Explain again"
              disabled={state.kind === "loading"}
              onClick={() => void load()}
            >
              <RefreshCw className={state.kind === "loading" ? "animate-spin" : undefined} />
            </Button>
          </div>
          {state.kind === "loading" ? (
            <div className="mt-2 space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-11/12" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ) : state.kind === "error" ? (
            <p className="mt-1 text-sm text-muted-foreground">{state.message}</p>
          ) : (
            <motion.p
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35 }}
              className="mt-1 text-[15px] leading-7 text-foreground/90"
            >
              {state.text}
            </motion.p>
          )}
          <p className="mt-3 text-[11px] text-muted-foreground">
            Written by Claude from this batch&apos;s figures. The amounts in the cards above are the official ones.
          </p>
        </div>
      </div>
    </div>
  );
}
