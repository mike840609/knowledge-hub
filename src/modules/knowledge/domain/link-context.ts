/** How much of a line is shown as the context of a backlink. */
export const LINK_CONTEXT_MAX_LENGTH = 160;

/**
 * The line of a Markdown body a link sits on, reduced to what a reader would
 * read: link syntax down to its text, list, quote and heading markers gone,
 * whitespace collapsed, cut to a length that fits a list row. `null` when the
 * line does not exist or is empty once reduced.
 */
export function linkContext(markdown: string, line: number): string | null {
  if (!Number.isInteger(line) || line < 1) return null;
  const raw = markdown.replace(/\r\n/g, "\n").split("\n")[line - 1];
  if (raw === undefined) return null;
  const text = raw
    // [[Target#Heading|Alias]] → Alias, else Target (with its heading)
    .replace(/\[\[([^[\]\n]+?)\]\]/g, (_, body: string) => {
      const pipe = body.indexOf("|");
      if (pipe !== -1 && body.slice(pipe + 1).trim() !== "") return body.slice(pipe + 1).trim();
      const left = pipe === -1 ? body : body.slice(0, pipe);
      return left.replace("#", " › ").trim();
    })
    // [text](url) and ![alt](url) → text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(?:>\s?)+/, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, "")
    .replace(/^\s{0,3}#{1,6}\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text === "") return null;
  const points = Array.from(text);
  return points.length <= LINK_CONTEXT_MAX_LENGTH ? text : `${points.slice(0, LINK_CONTEXT_MAX_LENGTH - 1).join("").trimEnd()}…`;
}
