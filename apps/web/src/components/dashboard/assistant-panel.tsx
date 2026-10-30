import { ArrowUp, Loader2, RotateCcw, Square, XIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { streamAssistant, type ChatTurn } from "@/api/assistant";
import { useDashboardAuth } from "@/auth/DashboardAuthContext";
import { BotIcon } from "@/components/dashboard/bot-icon";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const TOOL_LABELS: Record<string, string> = {
  list_transactions: "Looking up transactions",
  list_settlement_batches: "Checking settlement batches",
  get_reconciliation: "Running reconciliation",
};

const SUGGESTIONS = [
  "How much did I capture in the last 7 days?",
  "What will tonight's payout be?",
  "Show my partially captured payments",
  "Do my books reconcile for August?",
];

interface UiTurn extends ChatTurn {
  tools?: string[];
  error?: boolean;
}

/** Floating "Ask FilsPay" button + slide-over chat, available on every
 *  dashboard page. Opens with ⌘J. */
export function AssistantPanel() {
  const { me } = useDashboardAuth();
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<UiTurn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const launcherRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  const send = useCallback(
    async (text: string) => {
      const question = text.trim();
      if (!question || busy) return;
      const history: ChatTurn[] = [
        ...turns.filter((t) => !t.error && t.content).map(({ role, content }) => ({ role, content })),
        { role: "user", content: question },
      ];
      setTurns((prev) => [...prev, { role: "user", content: question }, { role: "assistant", content: "", tools: [] }]);
      setInput("");
      setBusy(true);
      const controller = new AbortController();
      abortRef.current = controller;

      const patchLast = (fn: (t: UiTurn) => UiTurn) =>
        setTurns((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last && last.role === "assistant") next[next.length - 1] = fn(last);
          return next;
        });

      try {
        await streamAssistant(
          history,
          (ev) => {
            if (ev.type === "text") patchLast((t) => ({ ...t, content: t.content + ev.text }));
            else if (ev.type === "tool") patchLast((t) => ({ ...t, tools: [...(t.tools ?? []), ev.name] }));
            else if (ev.type === "error") patchLast((t) => ({ ...t, content: t.content || ev.message, error: !t.content }));
          },
          controller.signal,
        );
      } catch (err) {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          patchLast((t) => ({ ...t, content: t.content || "Couldn't reach the assistant.", error: !t.content }));
        }
      } finally {
        setBusy(false);
        abortRef.current = null;
      }
    },
    [busy, turns],
  );

  const firstName = (me?.email ?? "").split("@")[0]?.split(/[._-]/)[0] ?? "";

  return (
    <>
      {/* The launcher stays mounted (just hidden) while the panel is open, so
          closing the panel can hand focus back to it instead of <body>. */}
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.9 }}
        animate={open ? { opacity: 0, y: 16, scale: 0.9 } : { opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 320, damping: 24 }}
        aria-hidden={open || undefined}
        className={cn("fixed right-5 bottom-5 z-40", open && "pointer-events-none")}
      >
            <Button
              ref={launcherRef}
              size="lg"
              aria-label="Open the FilsPay assistant chat"
              tabIndex={open ? -1 : undefined}
              className="group h-12 gap-2.5 border-2 border-[var(--card-border)] pr-2 pl-2 sm:pr-5"
              onClick={() => setOpen(true)}
            >
              <span className="relative flex size-9 items-center justify-center bg-primary-foreground/15">
                <BotIcon className="size-[22px]" />
              </span>
              <span className="hidden sm:inline">Ask FilsPay</span>
              <Kbd className="ml-1 hidden bg-primary-foreground/15 text-primary-foreground sm:inline-flex">⌘J</Kbd>
            </Button>
      </motion.div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          showCloseButton={false}
          finalFocus={launcherRef}
          className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
        >
          <SheetHeader className="border-b px-5 py-4">
            <div className="flex items-center gap-2.5">
              <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-elegant">
                <BotIcon className="size-6" thinking={busy} />
              </span>
              <div className="min-w-0 flex-1">
                <SheetTitle>Ask FilsPay</SheetTitle>
                <SheetDescription className="truncate">
                  Questions about {me?.merchant.displayName ?? "your account"}&apos;s payments and payouts
                </SheetDescription>
              </div>
              {turns.length > 0 ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="New conversation"
                  disabled={busy}
                  onClick={() => setTurns([])}
                >
                  <RotateCcw />
                </Button>
              ) : null}
              {/* In the header row, not the sheet's absolute X, so it no
                  longer sits on top of the reset button. */}
              <SheetClose render={<Button variant="ghost" size="icon-sm" aria-label="Close" />}>
                <XIcon />
              </SheetClose>
            </div>
          </SheetHeader>

          <div ref={scrollRef} className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
            {turns.length === 0 ? (
              <div className="pt-6">
                <motion.span
                  initial={{ scale: 0.6, opacity: 0, rotate: -8 }}
                  animate={{ scale: 1, opacity: 1, rotate: 0 }}
                  transition={{ type: "spring", stiffness: 260, damping: 16 }}
                  className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-elegant"
                >
                  <BotIcon className="size-9" />
                </motion.span>
                <p className="text-xl font-bold tracking-tight">
                  {firstName ? `Hi ${firstName.charAt(0).toUpperCase()}${firstName.slice(1)},` : "Hi,"}
                </p>
                <p className="mt-1 text-muted-foreground">
                  ask about your transactions, fees, payouts or reconciliation. I read your live data and can&apos;t change
                  anything.
                </p>
                <div className="mt-6 grid gap-2">
                  {SUGGESTIONS.map((s, i) => (
                    <motion.button
                      key={s}
                      type="button"
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.05 * i }}
                      onClick={() => void send(s)}
                      className="rounded-xl border border-border/70 bg-card px-3.5 py-2.5 text-left text-sm shadow-soft transition-colors hover:border-primary/30 hover:bg-primary/[0.04]"
                    >
                      {s}
                    </motion.button>
                  ))}
                </div>
              </div>
            ) : null}

            {turns.map((t, i) =>
              t.role === "user" ? (
                <div key={i} className="flex justify-end">
                  <p className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-sm whitespace-pre-wrap text-primary-foreground">
                    {t.content}
                  </p>
                </div>
              ) : (
                <div key={i} className="flex gap-2.5">
                  <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/15">
                    <BotIcon className="size-[18px]" animated={i === turns.length - 1} thinking={busy && i === turns.length - 1} />
                  </span>
                  <div className="min-w-0 flex-1 space-y-2">
                  {t.tools && t.tools.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {t.tools.map((name, j) => (
                        <span
                          key={j}
                          className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-muted/60 px-2.5 py-0.5 text-xs text-muted-foreground"
                        >
                          {busy && i === turns.length - 1 && !t.content ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            <span className="size-1.5 rounded-full bg-success" />
                          )}
                          {TOOL_LABELS[name] ?? name}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {t.content ? (
                    <div
                      className={cn(
                        "prose-chat text-sm leading-6",
                        t.error && "rounded-xl border border-destructive/25 bg-destructive/10 px-3 py-2 text-destructive",
                      )}
                    >
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{t.content}</ReactMarkdown>
                    </div>
                  ) : busy && i === turns.length - 1 ? (
                    <div className="flex gap-1 py-2" aria-label="Thinking">
                      {[0, 1, 2].map((d) => (
                        <motion.span
                          key={d}
                          className="size-1.5 rounded-full bg-muted-foreground/60"
                          animate={{ opacity: [0.3, 1, 0.3], y: [0, -3, 0] }}
                          transition={{ duration: 0.9, repeat: Infinity, delay: d * 0.15 }}
                        />
                      ))}
                    </div>
                  ) : null}
                  </div>
                </div>
              ),
            )}
          </div>

          <form
            className="border-t p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
          >
            <div className="relative rounded-2xl border bg-card shadow-soft focus-within:ring-2 focus-within:ring-ring/30">
              <Textarea
                aria-label="Ask FilsPay a question"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send(input);
                  }
                }}
                placeholder="Ask anything about your money…"
                rows={2}
                className="max-h-40 min-h-[3.25rem] resize-none border-0 bg-transparent pr-12 shadow-none focus-visible:ring-0"
              />
              {busy ? (
                <Button
                  type="button"
                  size="icon-sm"
                  variant="secondary"
                  aria-label="Stop"
                  className="absolute right-2 bottom-2 rounded-full"
                  onClick={() => abortRef.current?.abort()}
                >
                  <Square className="size-3 fill-current" />
                </Button>
              ) : (
                <Button
                  type="submit"
                  size="icon-sm"
                  aria-label="Send"
                  disabled={!input.trim()}
                  className="absolute right-2 bottom-2 rounded-full"
                >
                  <ArrowUp />
                </Button>
              )}
            </div>
            <p className="mt-2 text-center text-[11px] text-muted-foreground">
              Answers come from Claude and your live data. Double-check before acting on money.
            </p>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}
