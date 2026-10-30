/**
 * The ticked ids that are still rows on screen, in row order. A bulk action
 * must act only on what the operator can see under the current search and
 * filters, not on ticks left over from an earlier view (BUG-087).
 */
export function visibleSelection(selected: Set<string>, rows: Array<{ id: string }>): string[] {
  return rows.filter((row) => selected.has(row.id)).map((row) => row.id);
}
