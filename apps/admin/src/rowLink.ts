/**
 * UX-72: clicking anywhere on a table row opens the row's own link (its
 * first `<a href>`), not only when the name itself is clicked. Clicks on
 * other links, buttons and form controls, and clicks that end a text
 * selection, keep their normal behaviour; Ctrl/⌘-click opens a new tab.
  * Copy of apps/web/src/lib/rowLink.ts. The link stays in the row, so keyboard and screen-reader use is unchanged.
 */
export function openRowLink(event: React.MouseEvent<HTMLTableRowElement>): void {
  if (event.defaultPrevented || event.button !== 0) return;
  const target = event.target as Element;
  if (target.closest("a, button, input, select, textarea, label, [role='button'], [role='checkbox']")) return;
  if (window.getSelection()?.toString()) return;
  const link = event.currentTarget.querySelector<HTMLAnchorElement>("a[href]");
  if (!link) return;
  if (event.metaKey || event.ctrlKey) {
    window.open(link.href, "_blank", "noopener");
    return;
  }
  link.click();
}
