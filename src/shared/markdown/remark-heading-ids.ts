import type { Root } from "mdast";
import type {} from "mdast-util-to-hast";
import { collectHeadings } from "./outline";

/**
 * Stamps each heading with the `id` the outline links to. It runs inside
 * react-markdown's pipeline, on the tree that is about to be rendered, and
 * asks `collectHeadings` for the slugs — the same call the outline makes on
 * its own parse of the same text.
 */
export function remarkHeadingIds() {
  return (tree: Root) => {
    for (const { node, slug } of collectHeadings(tree)) {
      node.data = { ...node.data, hProperties: { ...node.data?.hProperties, id: slug } };
    }
  };
}
