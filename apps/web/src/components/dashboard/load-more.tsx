import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

/**
 * "Load more" control for keyset-paginated lists. `nextCursor` is an opaque
 * server token passed straight back on the next request; renders nothing
 * once the server says there is no next page.
 */
export function LoadMoreButton({
  nextCursor,
  loading,
  onLoadMore,
}: {
  nextCursor: string | null;
  loading: boolean;
  onLoadMore: () => void;
}) {
  if (!nextCursor) return null;
  return (
    <div className="flex justify-center">
      <Button variant="outline" size="sm" onClick={onLoadMore} disabled={loading}>
        {loading ? <Spinner /> : <ChevronDown />}
        {loading ? "Loading…" : "Load more"}
      </Button>
    </div>
  );
}
