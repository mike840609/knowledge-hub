/**
 * Phase 4 spec §6.1 / §6.4: query parsing, LIKE escaping and snippet
 * highlighting are pure functions and never touch the database.
 */
export const SEARCH_MAX_QUERY_LENGTH = 200;
export const SEARCH_MAX_TERMS = 5;
export const SEARCH_MAX_TERM_LENGTH = 64;

export type ParsedSearchQuery = { terms: string[]; tooLong: boolean };

/** Terms are ANDed by the caller; JavaScript's `\s` already covers U+3000. */
export function parseSearchQuery(raw: string): ParsedSearchQuery {
  if (raw.length > SEARCH_MAX_QUERY_LENGTH) return { terms: [], tooLong: true };
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const piece of raw.split(/\s+/)) {
    if (piece === "") continue;
    const term = piece.slice(0, SEARCH_MAX_TERM_LENGTH);
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
    if (terms.length === SEARCH_MAX_TERMS) break;
  }
  return { terms, tooLong: false };
}

/**
 * `!` is the SQL ESCAPE character (spec §6.1), so a literal `!` must be
 * escaped too. A single pass over the character class keeps that ordering
 * correct — escaping `%`/`_` first would double-escape the markers.
 */
export function toLikePattern(term: string): string {
  return `%${term.replace(/[!%_]/g, (character) => `!${character}`)}%`;
}

export type SnippetSegment = { text: string; match: boolean };

/**
 * Case-insensitive highlight. Full-width forms are deliberately NOT folded
 * here: MariaDB's utf8mb4_unicode_ci matches them, JavaScript does not, so a
 * full-width hit can stay unmarked (spec §6.4 known limitation).
 */
export function highlightSnippet(snippet: string, terms: readonly string[]): SnippetSegment[] {
  const needles = terms.filter((term) => term.length > 0).map((term) => term.toLowerCase());
  if (needles.length === 0) return [{ text: snippet, match: false }];
  const haystack = snippet.toLowerCase();
  const segments: SnippetSegment[] = [];
  let index = 0;
  while (index < snippet.length) {
    let bestAt = -1;
    let bestLength = 0;
    for (const needle of needles) {
      const at = haystack.indexOf(needle, index);
      if (at === -1) continue;
      if (bestAt === -1 || at < bestAt || (at === bestAt && needle.length > bestLength)) {
        bestAt = at;
        bestLength = needle.length;
      }
    }
    if (bestAt === -1) {
      segments.push({ text: snippet.slice(index), match: false });
      break;
    }
    if (bestAt > index) segments.push({ text: snippet.slice(index, bestAt), match: false });
    segments.push({ text: snippet.slice(bestAt, bestAt + bestLength), match: true });
    index = bestAt + bestLength;
  }
  return segments.filter((segment) => segment.text.length > 0);
}
