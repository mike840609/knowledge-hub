const NO_CUT = { start: false, end: false };

/**
 * A run of non-space ASCII at a cut edge is a word or Markdown token sliced in half ("ems", "k](http").
 * CJK text has no spaces, so the run stops at the first non-ASCII character and a character cut is kept.
 */
const PARTIAL_LEADING = /^[\x21-\x7E]+\s*/;
const PARTIAL_TRAILING = /\s*[\x21-\x7E]+$/;

/** Turn a short Markdown excerpt into readable search-result copy, marking where it was cut from a longer body. */
export function plainSearchSnippet(markdown: string, clipped: { start: boolean; end: boolean } = NO_CUT): string {
  const body = clipped.start ? markdown.replace(PARTIAL_LEADING, "") : markdown;
  let text = body
    .replace(/^﻿?(?:[ \t]*\r?\n)*#\s+[^\r\n]*(?:\r?\n|$)/, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/!\[[^\]]*(?:\][^\s]*)?$/g, " ")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\[\[([^\]|]+)\|([^\]]*)\]?$/g, "$2")
    .replace(/\[\[([^\]]*)\]?$/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*$/g, "$1")
    .replace(/\]\]/g, "")
    .replace(/(^|\n)\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+\.\s+)/g, "$1")
    .replace(/[*`~]/g, "")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (clipped.end) text = text.replace(PARTIAL_TRAILING, "");
  if (!text) return "";
  return `${clipped.start ? "…" : ""}${text}${clipped.end ? "…" : ""}`;
}
