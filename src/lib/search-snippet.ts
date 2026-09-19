/** Turn a short Markdown excerpt into readable search-result copy. */
export function plainSearchSnippet(markdown: string): string {
  return markdown
    .replace(/^\uFEFF?(?:[ \t]*\r?\n)*#\s+[^\r\n]*(?:\r?\n|$)/, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/!\[[^\]]*(?:\][^\s]*)?$/g, " ")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\[\[([^\]|]+)\|([^\]]*)$/g, "$2")
    .replace(/\[\[([^\]]*)$/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*$/g, "$1")
    .replace(/\]\]/g, "")
    .replace(/(^|\n)\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+\.\s+)/g, "$1")
    .replace(/[*`~]/g, "")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
