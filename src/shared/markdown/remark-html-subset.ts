import type { Nodes, Parents, Root, RootContent } from "mdast";
import type {} from "mdast-util-to-hast";
import { visit } from "unist-util-visit";
import { INLINE_HTML_TAG } from "./remark-known-html";

type Tag = { name: string; close: boolean; make?: (inner: RootContent[]) => RootContent };

// Each is the whole of an `html` node, written bare. An attribute, a space, another tag — any of
// it — and the node is not one of these, and stays the text it was written as.
const SUMMARY = "<summary>([^<>]*)</summary>";
const DETAILS_OPEN = new RegExp(`^<details( open)?>\\s*(?:${SUMMARY})?$`, "i");
const DETAILS_CLOSE = /^<\/details>$/i;
const SUMMARY_ALONE = new RegExp(`^${SUMMARY}$`, "i");

/** The parents whose children are blocks. The `<div>` this file makes for a `<details>`'s body is one more. */
const FLOW = new Set<Nodes["type"]>(["root", "blockquote", "listItem", "footnoteDefinition"]);

/** An element of ours: `mdast-util-to-hast` makes one of any node that names its tag. */
function element(tagName: string, children: RootContent[], properties: Record<string, boolean> = {}): RootContent {
  return { type: "khElement", data: { hName: tagName, hProperties: properties }, children } as unknown as RootContent;
}

function summary(text: string): RootContent {
  return element("summary", [{ type: "text", value: text }]);
}

function inlineTag(node: Nodes): Tag | null {
  const match = node.type === "html" ? INLINE_HTML_TAG.exec(node.value) : null;
  if (!match) return null;
  const name = match[2].toLowerCase();
  return { name, close: match[1] === "/", make: (inner) => element(name, inner) };
}

function detailsTag(node: Nodes): Tag | null {
  if (node.type !== "html") return null;
  const html = node.value.trim();
  if (DETAILS_CLOSE.test(html)) return { name: "details", close: true };
  const open = DETAILS_OPEN.exec(html);
  if (!open) return null;
  return {
    name: "details",
    close: false,
    make: (inner) => {
      // The summary may be on the opening line, or the block right after it.
      const alone = open[2] === undefined && inner[0]?.type === "html" ? SUMMARY_ALONE.exec(inner[0].value.trim()) : null;
      // Without one of its own it is given one: the browser's would be drawn its way, not the product's.
      const title = (open[2] ?? alone?.[1] ?? "").trim() || "Details";
      const body = element("div", alone ? inner.slice(1) : inner);
      return element("details", [summary(title), body], open[1] ? { open: true } : {});
    },
  };
}

/**
 * Pairs the opening and closing tags among one parent's children and puts an element of ours
 * around what is between them. A closing tag takes the nearest opening one of its name; an opening
 * tag left without one — and a closing tag that found none — is not touched, so it is still shown
 * as text.
 */
function pair(parent: Parents, read: (node: Nodes) => Tag | null): void {
  const children = parent.children as RootContent[];
  const open: { tag: Tag; at: number }[] = [];
  for (let index = 0; index < children.length; index += 1) {
    const tag = read(children[index]);
    if (!tag) continue;
    if (!tag.close) {
      open.push({ tag, at: index });
      continue;
    }
    const found = open.map((entry) => entry.tag.name).lastIndexOf(tag.name);
    if (found === -1) continue;
    const { tag: opening, at } = open[found];
    open.length = found;
    children.splice(at, index - at + 1, opening.make!(children.slice(at + 1, index)));
    index = at;
  }
}

/**
 * The HTML the reader shows as what it means, beyond `<br>` and comments (`remark-known-html.ts`):
 * `<u>`, `<sub>`, `<sup>`, `<kbd>` and `<mark>` around the content of one paragraph, and
 * `<details>` with an optional `<summary>` around blocks
 * (docs/superpowers/specs/2026-10-12-reader-html-subset-design.md).
 *
 * It never passes HTML on. It recognises a tag written exactly, and makes the element itself —
 * one of seven names, with no attribute but a `<details>`'s `open`. What it does not recognise it
 * leaves alone, and the renderer shows that as text, as it always has. So the worst it can do with
 * something it was not written for is fail to draw it.
 */
export function remarkHtmlSubset() {
  return (tree: Root) => {
    visit(tree, (node) => {
      if (!("children" in node)) return;
      // A `<details>` holds blocks and sits among blocks; the inline tags hold a line's content and sit in one.
      pair(node, FLOW.has(node.type) || node.data?.hName === "div" ? detailsTag : inlineTag);
    });
  };
}
