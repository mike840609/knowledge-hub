/** Plain-text context excerpt for the matched latest revision (never HTML). */
export function buildTaskSearchPreview(
  summary: string,
  searchBody: string,
  terms: readonly string[],
): string {
  const maxVisible = 200;
  if (terms.length === 0) return Array.from(summary).slice(0, maxVisible).join("");
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
  if (hit < 0) return Array.from(summary).slice(0, maxVisible).join("");
  const chars = Array.from(source);
  const charAt = Array.from(source.slice(0, hit)).length;
  const start = Math.max(0, charAt - 45);
  const excerpt = chars.slice(start, start + maxVisible).join("");
  // A textual ellipsis makes it obvious when the excerpt starts mid-field.
  return (start > 0 ? "…" + Array.from(excerpt).slice(0, maxVisible - 1).join("") : excerpt);
}
