/** Plain-text context excerpt for the matched latest revision (never HTML). */
export function buildTaskSearchPreview(
  summary: string,
  searchBody: string,
  terms: readonly string[],
): string {
  const maxVisible = 200;
  if (terms.length === 0) {
    const chars = Array.from(summary);
    return chars.slice(0, maxVisible).join("") + (chars.length > maxVisible ? "…" : "");
  }
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
  if (hit < 0) {
    const chars = Array.from(summary);
    return chars.slice(0, maxVisible).join("") + (chars.length > maxVisible ? "…" : "");
  }
  const chars = Array.from(source);
  const charAt = Array.from(source.slice(0, hit)).length;
  const backoff = Math.max(0, charAt - 45);
  const window = chars.slice(backoff, charAt);
  const spaceIndex = window.findIndex((char) => /\s/.test(char));
  const start = spaceIndex >= 0 ? backoff + spaceIndex + 1 : backoff;
  const prefix = start > 0 ? "…" : "";
  const suffix = start + maxVisible < chars.length ? "…" : "";
  const excerpt = chars.slice(start, start + maxVisible - prefix.length - suffix.length).join("");
  return prefix + excerpt + suffix;
}
