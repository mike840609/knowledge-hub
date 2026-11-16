import { revisionDiff } from "./revision-diff";

/** One side's change to the base: base lines [start, end) became `lines`. */
type Hunk = { start: number; end: number; lines: string[] };

function hunks(base: string, side: string): Hunk[] {
  const result: Hunk[] = [];
  let open: Hunk | null = null;
  let at = 0; // base lines passed so far
  for (const line of revisionDiff(base, side)) {
    if (line.kind === "same") { open = null; at++; continue; }
    if (!open) { open = { start: at, end: at, lines: [] }; result.push(open); }
    if (line.kind === "removed") { open.end++; at++; } else open.lines.push(line.text);
  }
  return result;
}

const same = (a: Hunk, b: Hunk) => a.start === b.start && a.end === b.end && a.lines.join("\n") === b.lines.join("\n");

/**
 * Three-way merge by lines, the way `git merge-file` decides: both sides' changes to the base are kept
 * when they touch different lines, and null is returned when they touch the same or adjacent lines
 * (unless both made the very same change). Null means "ask the writer", never a guess.
 */
export function mergeText(base: string, mine: string, theirs: string): string | null {
  // The editor and the server end a document with or without a newline; that is not an edit.
  const end = /\n+$/u;
  const ending = mine.match(end)?.[0] ?? "";
  const merged = mergeLines(base.replace(end, ""), mine.replace(end, ""), theirs.replace(end, ""));
  return merged === null ? null : merged + ending;
}

function mergeLines(base: string, mine: string, theirs: string): string | null {
  if (mine === theirs || theirs === base) return mine;
  if (mine === base) return theirs;
  const all = [...hunks(base, mine), ...hunks(base, theirs)].sort((a, b) => a.start - b.start || a.end - b.end);
  const kept: Hunk[] = [];
  for (const hunk of all) {
    const previous = kept[kept.length - 1];
    // Touching counts as overlapping: two edits on neighbouring lines are not known to be independent.
    if (previous && hunk.start <= previous.end) {
      if (same(previous, hunk)) continue;
      return null;
    }
    kept.push(hunk);
  }
  const lines = base === "" ? [] : base.split("\n");
  const out: string[] = [];
  let at = 0;
  for (const hunk of kept) {
    out.push(...lines.slice(at, hunk.start), ...hunk.lines);
    at = hunk.end;
  }
  out.push(...lines.slice(at));
  return out.join("\n");
}
