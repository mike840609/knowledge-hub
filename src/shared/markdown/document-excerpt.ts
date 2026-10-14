import type { Nodes } from "mdast";
import { parseMarkdown } from "./parse";

/** Plain text only: HTML, destinations and code blocks do not belong in a reading preview. */
export function documentExcerpt(markdown: string): string {
  function text(node: Nodes): string {
    if (node.type === "html" || node.type === "code" || node.type === "definition" || node.type === "footnoteDefinition") return "";
    if (node.type === "text" || node.type === "inlineCode") return node.value;
    if (node.type === "image" || node.type === "imageReference") return node.alt ?? "";
    if (node.type === "break") return " ";
    if ("children" in node) return node.children.map(text).join(node.type === "paragraph" || node.type === "heading" || node.type === "link" || node.type === "strong" || node.type === "emphasis" || node.type === "delete" ? "" : " ");
    return "";
  }
  // The opening is enough for 280 characters, and parsing a whole document for each preview is not.
  const excerpt = [...text(parseMarkdown(markdown.slice(0, 16_384))).replace(/\s+/g, " ").trim()];
  return excerpt.length > 280 ? `${excerpt.slice(0, 279).join("")}…` : excerpt.join("");
}
