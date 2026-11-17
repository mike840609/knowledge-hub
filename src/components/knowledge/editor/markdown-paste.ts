import { parserCtx } from "@milkdown/kit/core";
import { InputRule } from "@milkdown/kit/prose/inputrules";
import { Fragment, Slice, type Mark, type Node as ProseNode, type Schema } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey, type EditorState } from "@milkdown/kit/prose/state";
import { $inputRule, $prose } from "@milkdown/kit/utils";

/**
 * Plain text that reads as Markdown pastes as Markdown (2026-11-19 paste-and-links spec, decision 1).
 * A heading, list, quote, fence or table line, or an inline mark or `[text](url)`, is the sign; text
 * with none of them pastes as ProseMirror pastes text, one paragraph per line. Clipboard HTML keeps
 * its own path (`paste-html.ts`), except VS Code's, whose HTML is styled spans of the Markdown source.
 * The text goes through the editor's own parser, the one a document is opened with, so a `[[wikilink]]`
 * in it becomes the node and is written back as it was read.
 */
export const MARKDOWN_SIGN = /^(?:#{1,6}[ \t]|[-*+][ \t]|\d{1,9}[.)][ \t]|>|```|~~~|\|.*\|[ \t]*$)|\*\*[^*\s][^*\n]*\*\*|~~[^~\s][^~\n]*~~|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\)/m;

function codeAt(state: EditorState): boolean {
  const { $from } = state.selection;
  const marks: readonly Mark[] = state.storedMarks ?? $from.marks();
  return $from.parent.type.spec.code === true || marks.some((mark) => mark.type.spec.code === true || mark.type.name === "inlineCode");
}


/** A web address in running text, as GFM's autolink literal finds one: after a space, a `(` or the start, before trailing punctuation. */
const ADDRESS = /(^|[\s(])(https?:\/\/[^\s<>]*[^\s<>.,;:!?'")\]}])/g;

/** `text` cut at the web addresses in it (2026-11-20 decision 4): each address its own piece, `href` set, a `)` that closes a `(` inside it kept. */
export function splitAddresses(text: string): { text: string; href?: string }[] {
  const pieces: { text: string; href?: string }[] = [];
  let last = 0;
  for (const match of text.matchAll(ADDRESS)) {
    let url = match[2];
    const start = match.index + match[1].length;
    // `https://x.com/Foo_(bar)` keeps its `)`; the one in `(see https://x.com)` does not.
    let end = start + url.length;
    while (text[end] === ")" && url.split("(").length > url.split(")").length) { url += ")"; end += 1; }
    try { new URL(url); } catch { continue; }
    if (start > last) pieces.push({ text: text.slice(last, start) });
    pieces.push({ text: url, href: url });
    last = end;
  }
  if (last < text.length) pieces.push({ text: text.slice(last) });
  return pieces;
}

/** The fragment with every address in plain text linked; code, a link already made, and a wikilink are left as they are. */
function linkAddresses(fragment: Fragment, schema: Schema): Fragment {
  const link = schema.marks.link;
  const nodes: ProseNode[] = [];
  fragment.forEach((node) => {
    if (node.isText) {
      if (!link || node.marks.some((mark) => mark.type === link || mark.type.spec.code === true || mark.type.name === "inlineCode")) { nodes.push(node); return; }
      for (const piece of splitAddresses(node.text!)) nodes.push(schema.text(piece.text, piece.href ? [...node.marks, link.create({ href: piece.href })] : node.marks));
    } else if (node.type.spec.code === true || node.isLeaf) nodes.push(node);
    else nodes.push(node.copy(linkAddresses(node.content, schema)));
  });
  return Fragment.fromArray(nodes);
}

const markdownPaste = $prose(
  (ctx) =>
    new Plugin({
      key: new PluginKey("khMarkdownPaste"),
      props: {
        handlePaste(view, event) {
          const data = event.clipboardData;
          if (!view.editable || !data) return false;
          const fromCode = /"mode"\s*:\s*"markdown"/.test(data.getData("vscode-editor-data"));
          if (data.getData("text/html") && !fromCode) return false;
          const text = data.getData("text/plain");
          const { state } = view;
          // A table cell holds one line of text; a pasted block has nowhere to go in it.
          const inCell = state.selection.$from.node(-1)?.type.spec.tableRole !== undefined;
          if (codeAt(state) || inCell) return false;
          // Plain text with an address in it: one paragraph per line as ProseMirror pastes it, the addresses linked
          // (2026-11-20 decision 4). An address alone is the link toolbar's paste, and keeps that path.
          if (!MARKDOWN_SIGN.test(text)) {
            if (!/https?:\/\//.test(text) || /^\s*https?:\/\/\S+\s*$/.test(text) || !state.schema.marks.link) return false;
            const lines = text.split(/(?:\r\n?|\n)+/).filter((line) => line !== "");
            // As ProseMirror's own text paste does, the text takes the marks in force at the caret.
            const marks = state.storedMarks ?? state.selection.$from.marks();
            const paragraphs = lines.map((line) => state.schema.nodes.paragraph.create(null, linkAddresses(Fragment.from(state.schema.text(line, marks)), state.schema)));
            let slice = new Slice(Fragment.fromArray(paragraphs), 1, 1);
            // Dispatching here skips the editor's own paste hooks, so they are run by hand: the one that makes a
            // pasted `[[x]]` a wikilink node (`wiki-link.ts`) is what keeps its edge when the text also holds an address.
            view.someProp("transformPasted", (transform) => { slice = transform(slice, view, true); return undefined; });
            event.preventDefault();
            view.dispatch(state.tr.replaceSelection(slice).setMeta("uiEvent", "paste").scrollIntoView());
            return true;
          }
          const parsed = ctx.get(parserCtx)(text);
          if (!parsed || typeof parsed === "string" || parsed.content.size === 0) return false;
          // The parser leaves an address in a sentence as text, which is written back `https\://…`: link it.
          const doc = parsed.copy(linkAddresses(parsed.content, state.schema));
          event.preventDefault();
          // A paragraph at either end runs into the line it lands in; any other block (a heading, a list)
          // stays the block it is, splitting that line, and takes the place of an empty one.
          const paragraph = state.schema.nodes.paragraph;
          const slice = new Slice(doc.content, doc.content.firstChild?.type === paragraph ? 1 : 0, doc.content.lastChild?.type === paragraph ? 1 : 0);
          const { $from, empty } = state.selection;
          const tr = empty && $from.parent.isTextblock && $from.parent.content.size === 0 && slice.openStart === 0 && $from.depth > 0
            ? state.tr.replaceRange($from.before(), $from.after(), slice)
            : state.tr.replaceSelection(slice);
          view.dispatch(tr.setMeta("uiEvent", "paste").scrollIntoView());
          return true;
        },
      },
    }),
);

/** A typed or pasted web address ends before trailing punctuation, as GFM's autolink literal does. */
// \ufffc is how an input rule sees an inline node (a wikilink, a line break): never part of a link.
const URL_TAIL = String.raw`https?:\/\/[^\s<>\ufffc]*[^\s<>.,;:!?'")\]}\ufffc]`;

/** `https://…` then a space: the address becomes a link (decision 3), punctuation after it left out. */
const autolinkRule = $inputRule(
  () =>
    new InputRule(new RegExp(String.raw`(?:^|[\s(\ufffc])(${URL_TAIL})([.,;:!?'")\]}]*)\s$`), (state, match, _start, typedAt) => {
      const link = state.schema.marks.link;
      // A space typed over a selection replaces it: the text before the caret is not what was matched.
      if (!link || !state.selection.empty || codeAt(state) || !state.selection.$from.parent.type.allowsMarkType(link)) return null;
      // A `)` closing a `(` inside the address is part of it, as GFM keeps it (`…/Foo_(bar)`).
      let [, url, tail] = match;
      while (tail.startsWith(")") && url.split("(").length > url.split(")").length) { url += ")"; tail = tail.slice(1); }
      // The match ends with the space being typed, which is not in the document yet.
      const end = typedAt - tail.length;
      const from = end - url.length;
      if (state.doc.rangeHasMark(from, end, link)) return null;
      try { new URL(url); } catch { return null; }
      const tr = state.tr.addMark(from, end, link.create({ href: url })).insertText(match[0].slice(-1), typedAt);
      return tr.removeMark(end, typedAt + 1, link).setStoredMarks(state.selection.$from.marks().filter((mark) => mark.type !== link));
    }),
);

/**
 * `[text](url)` typed: the text, linked (2026-11-19 decision 4; the text keeps its formatting, 2026-11-20 decision 3). `![alt](src)` stays as typed: an image is not made here.
 * The text keeps the formatting it was typed with: `[**bold**](url)` is a bold link, not a plain one.
 */
const markdownLinkRule = $inputRule(
  () =>
    new InputRule(/(?<![!\\[])\[([^\][\n\ufffc]+)\]\(([^()\s\ufffc]+)\)$/, (state, match, start, end) => {
      const link = state.schema.marks.link;
      if (!link || codeAt(state) || !state.selection.$from.parent.type.allowsMarkType(link)) return null;
      const marks = state.doc.resolve(start).marks().filter((mark) => mark.type !== link);
      // The document holds `[text](url` (the `)` is being typed): take out `](url` and the `[`, link what is left.
      const textEnd = start + 1 + match[1].length;
      const tr = state.tr.delete(textEnd, end).delete(start, start + 1);
      return tr.addMark(start, start + match[1].length, link.create({ href: match[2] })).setStoredMarks(marks);
    }),
);

export const markdownPastePlugins = [markdownPaste, autolinkRule, markdownLinkRule];
