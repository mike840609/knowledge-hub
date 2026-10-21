export type LinkifiedPart = { text: string; href?: string };

const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/gi;
// Sentence punctuation after a pasted link is the sentence's, not the link's.
const TRAILING = /[.,;:!?'"]+$/;

/**
 * Splits plain text into runs and `http(s)` links, for a comment that is shown as text.
 * Only what parses as an http(s) URL becomes a link; everything else stays text, and the
 * caller builds the element itself, so nothing the author wrote is emitted as markup.
 */
export function linkify(text: string): LinkifiedPart[] {
  const parts: LinkifiedPart[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    let candidate = match[0].replace(TRAILING, "");
    // "(see https://x.y/z)" keeps its closing bracket outside, "https://x.y/a_(b)" keeps it inside.
    while (candidate.endsWith(")") && count(candidate, "(") < count(candidate, ")")) candidate = candidate.slice(0, -1).replace(TRAILING, "");
    const href = safeHref(candidate);
    if (!href) continue;
    const start = match.index!;
    if (start > last) parts.push({ text: text.slice(last, start) });
    parts.push({ text: candidate, href });
    last = start + candidate.length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

function count(text: string, character: string): number {
  return text.split(character).length - 1;
}

function safeHref(candidate: string): string | undefined {
  try {
    const url = new URL(candidate);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname ? url.href : undefined;
  } catch {
    return undefined;
  }
}
