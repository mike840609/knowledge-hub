import type { Root } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

/**
 * The one Markdown parser configuration in the product.
 *
 * `react-markdown` builds its own processor from `remark-parse` plus whatever
 * `remarkPlugins` it is given, and the renderer passes `remark-gfm`. Anything
 * that must agree with what a reader sees — heading anchors, the outline built
 * from them, the links extracted for the link index — parses through this same
 * pair, so the tree it walks has the same shape as the tree that is rendered.
 * A second parser configuration would let an anchor be computed one way in the
 * outline and another in the page, and nothing would notice until a link
 * stopped scrolling.
 */
const processor = unified().use(remarkParse).use(remarkGfm);

export function parseMarkdown(markdown: string): Root {
  return processor.parse(markdown);
}
