import type { KeyboardEvent } from "react";
/** Arrow keys move between primary row targets; fields and secondary controls keep native keys. */
export function navigateListRows(event: KeyboardEvent<HTMLUListElement>) {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.nativeEvent.isComposing) return;
  const target = event.target as HTMLElement;
  if (target.closest("input, textarea, select, [contenteditable=true]")) return;
  const current = target.closest<HTMLElement>("[data-list-row]");
  if (!current) return;
  const rows = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("[data-list-row]"));
  const index = rows.indexOf(current);
  const next = event.key === "ArrowDown" ? Math.min(index + 1, rows.length - 1)
    : event.key === "ArrowUp" ? Math.max(0, index - 1)
    : event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : -1;
  if (next >= 0 && rows[next]) { event.preventDefault(); rows[next].focus(); }
}
