/** Plain-text context excerpt for the matched latest revision (never HTML). */
const MAX_VISIBLE = 200;

/** Cut at a word boundary and make the truncation visible. */
function bound(chars: string[], start: number, limit: number): string {
  const hardEnd = Math.min(chars.length, start + limit);
  let end = hardEnd;
  if (hardEnd < chars.length) {
    for (let index = hardEnd - 1; index > start; index--) {
      if (/\s/.test(chars[index])) { end = index; break; }
    }
  }
  return chars.slice(start, end).join("") + (end < chars.length ? "…" : "");
}

export function buildTaskSearchPreview(
  summary: string,
  searchBody: string,
  terms: readonly string[],
): string {
  if (terms.length === 0) return bound(Array.from(summary), 0, MAX_VISIBLE);
  const findTerm = (source: string) => {
    const normalized = source.toLocaleLowerCase();
    return terms.map((term) => normalized.indexOf(term.toLocaleLowerCase()))
      .filter((at) => at >= 0).sort((a, b) => a - b)[0] ?? -1;
  };
  // Keep summary context when it contains a match, otherwise take the
  // first matching Findings/Decisions/Changes line from searchBody.
  const hitInSummary = findTerm(summary);
  const source = hitInSummary >= 0 ? summary : searchBody;
  const hit = hitInSummary >= 0 ? hitInSummary : findTerm(searchBody);
  if (hit < 0) return bound(Array.from(summary), 0, MAX_VISIBLE);
  const chars = Array.from(source);
  const charAt = Array.from(source.slice(0, hit)).length;
  const backoff = Math.max(0, charAt - 45);
  const window = chars.slice(backoff, charAt);
  // Only snap forward when the window actually backed off; a match near the
  // start must keep the opening words and must not claim a false ellipsis.
  const spaceIndex = backoff > 0 ? window.findIndex((char) => /\s/.test(char)) : -1;
  const start = spaceIndex >= 0 ? backoff + spaceIndex + 1 : backoff;
  const prefix = start > 0 ? "…" : "";
  return prefix + bound(chars, start, MAX_VISIBLE - prefix.length);
}
