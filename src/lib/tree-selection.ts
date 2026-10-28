/** The rows a shift-click covers, inclusive, in the order the tree shows them. */
export function selectionRange(ids: readonly string[], from: string, to: string): string[] {
  const start = ids.indexOf(from);
  const end = ids.indexOf(to);
  if (start < 0 || end < 0) return [to];
  return ids.slice(Math.min(start, end), Math.max(start, end) + 1);
}
