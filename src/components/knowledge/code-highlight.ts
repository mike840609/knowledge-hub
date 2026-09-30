import type { Element, Root, RootContent } from "hast";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import groovy from "highlight.js/lib/languages/groovy";
import protobuf from "highlight.js/lib/languages/protobuf";
import { common } from "lowlight";
import rehypeHighlight from "rehype-highlight";
import type { PluggableList } from "unified";
import { visit } from "unist-util-visit";

/**
 * The languages a fenced block can be coloured as: lowlight's `common` set and three more the
 * platform's own files are written in. Each is imported on its own from highlight.js rather than
 * taking lowlight's `all` — that is 192 grammars in the bundle for the sake of three.
 *
 * Anything else is left as plain text, not guessed at: the renderer runs with `detect: false`.
 * Daily-driver spec §5, which lists what `common` holds.
 */
export const HIGHLIGHT_LANGUAGES = { ...common, dockerfile, groovy, protobuf };

/**
 * A block longer than this is not coloured. Highlighting is linear in the text at best and a
 * grammar's worst case is not, so a pasted log or a minified bundle must not decide how long a
 * page takes. It counts the text handed to the highlighter — the code as written and the newline
 * Markdown puts at its end — in characters, since characters and not bytes are what it walks.
 */
export const MAX_HIGHLIGHT_CHARS = 20_000;

function textLength(node: Element | RootContent): number {
  if (node.type === "text") return node.value.length;
  if (node.type !== "element") return 0;
  let total = 0;
  for (const child of node.children) total += textLength(child);
  return total;
}

/**
 * Marks an oversized block `no-highlight`, which is how `rehype-highlight` is told to pass one
 * over. It has to run before that plugin, on the code as written: after it, the block is spans.
 */
function rehypeSkipLargeCode() {
  return (tree: Root) => {
    visit(tree, "element", (node, _index, parent) => {
      if (node.tagName !== "code" || parent?.type !== "element" || parent.tagName !== "pre") return;
      if (textLength(node) <= MAX_HIGHLIGHT_CHARS) return;
      const className = Array.isArray(node.properties.className) ? node.properties.className : [];
      node.properties.className = [...className, "no-highlight"];
    });
  };
}

/** `rehypePlugins` for `react-markdown`, in the order they must run. Output is hast, never HTML text. */
export const codeHighlightPlugins: PluggableList = [rehypeSkipLargeCode, [rehypeHighlight, { detect: false, languages: HIGHLIGHT_LANGUAGES }]];
