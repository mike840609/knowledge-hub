import type { Nodes, Root } from "mdast";
import type {} from "mdast-util-to-hast";

/** On the element a block is drawn as: where that block is in the document's Markdown. */
export const REVIEW_PATH = "data-review-path";
/** On a list item: where its paragraph is. A tight list draws the paragraph as the item itself. */
export const REVIEW_ITEM_PARAGRAPH = "data-review-para";

/** A block's path — child indexes from the root — as an attribute value. */
export const reviewPathKey = (path: readonly number[]) => path.join(".");

const STAMPED = new Set(["paragraph", "heading", "tableCell", "code"]);

function stamp(node: Nodes, name: string, path: number[]) {
  node.data = { ...node.data, hProperties: { ...node.data?.hProperties, [name]: reviewPathKey(path) } };
}

/**
 * Says, on each block a comment can be attached to, where it is in the Markdown, so a selection in
 * the page is read against that block and no other. Without it the page's blocks could only be
 * paired with the Markdown's by counting, and whatever the reader draws differently — a callout's
 * marker, a task's checkbox, the footnotes moved to the foot — put the count out for the whole
 * document.
 *
 * It must run before any plugin that adds, removes or moves a node: the path is the block's place
 * in the document as it was parsed, which is what the server works the same path out from.
 */
export function remarkReviewPaths() {
  return (tree: Root) => {
    const walk = (node: Nodes, path: number[]) => {
      if (STAMPED.has(node.type)) stamp(node, REVIEW_PATH, path);
      if (node.type === "listItem" && node.children[0]?.type === "paragraph") stamp(node, REVIEW_ITEM_PARAGRAPH, [...path, 0]);
      if ("children" in node) node.children.forEach((child, index) => walk(child as Nodes, [...path, index]));
    };
    walk(tree, []);
  };
}
