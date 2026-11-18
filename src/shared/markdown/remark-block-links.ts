import type { Nodes, Root } from "mdast";
import type {} from "mdast-util-to-hast";
import { isLineBreakHtml } from "./remark-known-html";

const ID = /^kh-block-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const MARKER = /^<!-- (kh-block-[a-f0-9-]+) -->$/;

export function isBlockId(value: unknown): value is string {
  return typeof value === "string" && ID.test(value);
}

export const blockLinkMarker = (id: string) => `<!-- ${id} -->`;

function markerId(node: Nodes | undefined): string | null {
  if (node?.type !== "html") return null;
  const id = MARKER.exec(node.value)?.[1];
  return isBlockId(id) ? id : null;
}

/** Metadata is adjacent to a paragraph or fence, and inline for an item so it keeps the list tight. */
export function applyBlockLinks(tree: Root): void {
  const seen = new Set<string>();
  function attach(node: Nodes, id: string) {
    if (seen.has(id)) return;
    seen.add(id);
    node.data = { ...node.data, hProperties: { ...node.data?.hProperties, id } };
  }
  function walk(node: Nodes) {
    if (!("children" in node)) return;
    for (let index = 0; index < node.children.length; index++) {
      const child = node.children[index];
      const id = markerId(child);
      const next = node.children[index + 1];
      if (id && (next?.type === "paragraph" || next?.type === "code")) {
        node.children.splice(index, 1);
        attach(next, id);
        walk(next);
        continue;
      }
      if (child.type === "listItem") {
        const paragraph = child.children[0];
        const id = paragraph?.type === "paragraph" ? markerId(paragraph.children.at(-1)) : null;
        if (id && paragraph.type === "paragraph") {
          paragraph.children.pop();
          const placeholder = paragraph.children[0];
          if (paragraph.children.length === 1 && placeholder.type === "html" && isLineBreakHtml(placeholder.value)) paragraph.children.pop();
          attach(child, id);
        }
      }
      walk(child);
    }
  }
  walk(tree);
}

export const remarkBlockLinks = () => applyBlockLinks;
