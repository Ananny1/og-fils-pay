import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export const PAGE_SIZES = [10, 15, 25] as const;

/**
 * Numbered pages over a keyset (cursor) API. The API only says "here is
 * the cursor for the rows after these", never a total, so pages are
 * discovered as you go forward: page N's cursor is the `nextCursor` page
 * N-1 returned. Every visited page stays one click away.
 *
 * `fetchPage` loads one page, puts its rows into the caller's state, and
 * returns that page's `nextCursor`. When `fetchPage` changes identity
 * (its filters changed) or the page size changes, paging restarts at 1.
 */
export function useCursorPages(
  fetchPage: (cursor: string | null, limit: number) => Promise<string | null>,
  initialPageSize: number = 15,
) {
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [page, setPage] = useState(0);
  const [cursors, setCursors] = useState<Array<string | null>>([null]);
  const [hasNext, setHasNext] = useState(false);
  const cursorsRef = useRef(cursors);
  cursorsRef.current = cursors;

  // New filters or page size: back to page 1, forget discovered cursors.
  useEffect(() => {
    setPage(0);
    setCursors([null]);
  }, [fetchPage, pageSize]);

  useEffect(() => {
    let cancelled = false;
    const cursor = cursorsRef.current[page] ?? null;
    fetchPage(cursor, pageSize)
      .then((next) => {
        if (cancelled) return;
        setHasNext(next !== null);
        setCursors((prev) => {
          const copy = prev.slice(0, Math.max(prev.length, page + 1));
          if (next) copy[page + 1] = next;
          else copy.length = page + 1;
          return copy;
        });
      })
      .catch(() => {
        if (!cancelled) setHasNext(false);
      });
    return () => {
      cancelled = true;
    };
  }, [page, pageSize, fetchPage]);

  return {
    page,
    pageSize,
    setPageSize,
    hasNext,
    /** Pages whose cursor is known, so they can be opened directly. */
    knownPages: cursors.length,
    goTo: (index: number) => {
      if (index >= 0 && index < cursorsRef.current.length) setPage(index);
    },
  };
}

export type CursorPages = ReturnType<typeof useCursorPages>;

/** The page-number bar: rows-per-page, Previous, 1 2 3 …, Next. */
export function Pager({
  pager,
  loading,
  rowCount,
  noun = "rows",
  className,
}: {
  pager: CursorPages;
  loading: boolean;
  rowCount: number;
  noun?: string;
  className?: string;
}) {
  const { page, pageSize, hasNext, knownPages, goTo, setPageSize } = pager;
  if (page === 0 && !hasNext && rowCount === 0) return null;

  // Window of page numbers around the current one, first and last always shown.
  const last = knownPages - 1;
  const nums = new Set<number>([0, last, page - 1, page, page + 1].filter((n) => n >= 0 && n <= last));
  const sorted = [...nums].sort((a, b) => a - b);
  const first = page * pageSize + 1;
  const to = page * pageSize + rowCount;

  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3", className)}>
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span className="tabular-nums">
          {rowCount > 0 ? (
            <>
              <span className="font-medium text-foreground">
                {first}–{to}
              </span>{" "}
              {noun}
              {hasNext ? "" : " · end"}
            </>
          ) : (
            "No rows"
          )}
        </span>
        <span className="hidden h-4 w-px bg-border sm:block" />
        <label className="hidden items-center gap-2 sm:flex">
          Per page
          <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
            <SelectTrigger size="sm" className="w-[4.5rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>

      <nav aria-label="Pagination" className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          disabled={page === 0 || loading}
          onClick={() => goTo(page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft /> <span className="hidden sm:inline">Previous</span>
        </Button>
        {sorted.map((n, i) => (
          <span key={n} className="flex items-center">
            {i > 0 && n - sorted[i - 1]! > 1 ? <span className="px-1 text-muted-foreground">…</span> : null}
            <Button
              variant={n === page ? "default" : "ghost"}
              size="icon-sm"
              aria-current={n === page ? "page" : undefined}
              disabled={loading && n !== page}
              onClick={() => goTo(n)}
              className={cn("tabular-nums", n === page && "pointer-events-none")}
            >
              {loading && n === page ? <Spinner className="size-3.5" /> : n + 1}
            </Button>
          </span>
        ))}
        <Button
          variant="ghost"
          size="sm"
          disabled={!hasNext || loading}
          onClick={() => goTo(page + 1)}
          aria-label="Next page"
        >
          <span className="hidden sm:inline">Next</span> <ChevronRight />
        </Button>
      </nav>
    </div>
  );
}
