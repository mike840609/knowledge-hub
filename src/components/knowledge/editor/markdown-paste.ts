import { parserCtx } from "@milkdown/kit/core";
import { InputRule } from "@milkdown/kit/prose/inputrules";
import { Slice, type Mark } from "@milkdown/kit/prose/model";
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
          if (!MARKDOWN_SIGN.test(text) || codeAt(state) || inCell) return false;
          const doc = ctx.get(parserCtx)(text);
          if (!doc || typeof doc === "string" || doc.content.size === 0) return false;
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
    new InputRule(new RegExp(String.raw`(?:^|[\s(])(${URL_TAIL})([.,;:!?'")\]}]*)\s$`), (state, match, _start, typedAt) => {
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

/** `[text](url)` typed: the text, linked (decision 4). `![alt](src)` stays as typed: an image is not made here. */
const markdownLinkRule = $inputRule(
  () =>
    new InputRule(/(?<![!\\[])\[([^\][\n\ufffc]+)\]\(([^()\s\ufffc]+)\)$/, (state, match, start, end) => {
      const link = state.schema.marks.link;
      if (!link || codeAt(state) || !state.selection.$from.parent.type.allowsMarkType(link)) return null;
      const marks = state.doc.resolve(start).marks().filter((mark) => mark.type !== link);
      return state.tr.replaceWith(start, end, state.schema.text(match[1], [...marks, link.create({ href: match[2] })])).setStoredMarks(marks);
    }),
);

export const markdownPastePlugins = [markdownPaste, autolinkRule, markdownLinkRule];
