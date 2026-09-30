import type { Element, ElementContent, Root, RootContent } from "hast";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import groovy from "highlight.js/lib/languages/groovy";
import protobuf from "highlight.js/lib/languages/protobuf";
import { common, createLowlight } from "lowlight";
import type { PluggableList } from "unified";
import { SKIP, visit } from "unist-util-visit";

/**
 * The languages a fenced block can be coloured as: lowlight's `common` set and three more the
 * platform's own files are written in. Each is imported on its own from highlight.js rather than
 * taking lowlight's `all` — that is 192 grammars in the bundle for the sake of three.
 *
 * Anything else is left as plain text, not guessed at. Daily-driver spec §5, which lists what
 * `common` holds.
 */
export const HIGHLIGHT_LANGUAGES = { ...common, dockerfile, groovy, protobuf };

/**
 * What one block, and one document, may cost. Colouring is linear in the text at best and a
 * grammar's worst case is not, so a pasted log or a minified bundle must not decide how long a
 * page takes — and neither may a document that is nothing but code: measured, colouring costs
 * about 5 ms per KB, so a 1 MB document of fenced code would take seconds longer to render than
 * the same document uncoloured, on every load, and a shared page has no sign-in in front of it.
 *
 * Counted in characters, since characters and not bytes are what the highlighter walks; a block's
 * count is its code and the newline Markdown puts at its end. A block goes over either limit and it
 * is left plain; the blocks after it are judged on their own.
 */
export const MAX_HIGHLIGHT_CHARS = 20_000;
export const MAX_HIGHLIGHT_DOCUMENT_CHARS = 100_000;

/**
 * How deeply the coloured output may nest. Real code comes out a handful of levels deep; `/*`
 * repeated in Rust or Swift, whose block comments nest, comes out as many levels as it has `/*`,
 * and rendering that overflows the stack (seen at 3,000 levels, inside 20,000 characters, and
 * not at 5,000 — it depends on how warm the engine is, which is why the limit is far below any
 * of it). A stack overflow while rendering takes the whole page with it.
 */
export const MAX_HIGHLIGHT_DEPTH = 50;

export type CodeHighlightOptions = {
  languages?: NonNullable<Parameters<typeof createLowlight>[0]>;
  maxBlockChars?: number;
  maxDocumentChars?: number;
  maxDepth?: number;
};

/** The block's text. Walks with a list of its own, not by recursion: it is given trees of any depth. */
function textOf(node: Element): string {
  let text = "";
  const pending: ElementContent[] = [...node.children].reverse();
  while (pending.length > 0) {
    const next = pending.pop()!;
    if (next.type === "text") text += next.value;
    else if (next.type === "element") for (let i = next.children.length - 1; i >= 0; i--) pending.push(next.children[i]);
  }
  return text;
}

/** The deepest element in `children`, counting them as level 1. Not recursive, for the same reason. */
function depthOf(children: readonly RootContent[]): number {
  let deepest = 0;
  const pending: [RootContent, number][] = children.map((child) => [child, 1]);
  while (pending.length > 0) {
    const [next, depth] = pending.pop()!;
    if (next.type !== "element") continue;
    deepest = Math.max(deepest, depth);
    for (const child of next.children) pending.push([child, depth + 1]);
  }
  return deepest;
}

/**
 * The language a fence names, from the `language-x` class Markdown gives its `<code>`; `false` for
 * a block marked `no-highlight`, and `undefined` for one that names nothing.
 */
function languageOf(node: Element): string | false | undefined {
  const classes = Array.isArray(node.properties.className) ? node.properties.className.map(String) : [];
  if (classes.includes("no-highlight") || classes.includes("nohighlight")) return false;
  for (const name of classes) {
    if (name.startsWith("language-")) return name.slice("language-".length);
    if (name.startsWith("lang-")) return name.slice("lang-".length);
  }
  return undefined;
}

/**
 * Colours the fenced blocks that name a language it has, within the limits above. Everything it
 * declines — no language, a language it does not have, too big, too much already, nested too deep,
 * a grammar that throws — it leaves exactly as it found it, as plain text, and none of them is an
 * error: the page still renders. It never guesses a language.
 *
 * This is `rehype-highlight`'s job, written out, because that package cannot be given these limits:
 * it recurses into what it has just produced, so the depth that overflows the stack overflows it
 * first. The output is hast, never HTML text.
 */
export function rehypeCodeHighlight(options: CodeHighlightOptions = {}) {
  const { languages = HIGHLIGHT_LANGUAGES, maxBlockChars = MAX_HIGHLIGHT_CHARS, maxDocumentChars = MAX_HIGHLIGHT_DOCUMENT_CHARS, maxDepth = MAX_HIGHLIGHT_DEPTH } = options;
  const lowlight = createLowlight(languages);

  return (tree: Root) => {
    let spent = 0;
    visit(tree, "element", (node, _index, parent) => {
      if (node.tagName !== "code" || parent?.type !== "element" || parent.tagName !== "pre") return;
      // Whatever happens below, do not walk into the code's children afterwards: they may be far deeper than the tree was.
      const language = languageOf(node);
      if (!language || !lowlight.registered(language)) return SKIP;

      const text = textOf(node);
      if (text.length > maxBlockChars || spent + text.length > maxDocumentChars) return SKIP;
      // Spent when it is tried, not when it succeeds: a block that is then refused for its depth has cost what it cost.
      spent += text.length;

      let coloured: Root;
      try {
        coloured = lowlight.highlight(language, text);
      } catch {
        return SKIP;
      }
      if (depthOf(coloured.children) > maxDepth) return SKIP;

      const classes = Array.isArray(node.properties.className) ? node.properties.className : [];
      node.properties.className = ["hljs", ...classes];
      // Only elements and text: a doctype cannot come out of a highlighter, which the type does not know.
      node.children = coloured.children as ElementContent[];
      return SKIP;
    });
  };
}

/** `rehypePlugins` for `react-markdown`. */
export const codeHighlightPlugins: PluggableList = [rehypeCodeHighlight];
