import { remarkStringifyOptionsCtx } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import { InputRule } from "@milkdown/kit/prose/inputrules";
import { Fragment, Slice, type Mark, type Node as ProseNode, type NodeType } from "@milkdown/kit/prose/model";
import { Plugin } from "@milkdown/kit/prose/state";
import { $inputRule, $node, $prose, $remark } from "@milkdown/kit/utils";
import type { State } from "mdast-util-to-markdown";
import { findWikiLinks, parseWikiLinkParts } from "@/modules/knowledge/domain/document-links";
import { shownText } from "../remark-knowledge-links";
import { remarkWikiLinks } from "./remark-wikilinks";

/**
 * A `[[wikilink]]` in the rendered editor: one node that holds the link as it reads (`raw`, brackets
 * included) and writes it back exactly so. As text the editor would write it back escaped
 * (`\[\[x]]`), which is no link — and the link index, the graph and every backlink would lose it
 * the next time the document was saved from here.
 *
 * Only `raw` is stored. What the link points at and what it shows are worked out from it
 * (`parseWikiLinkParts`), so there is no second copy to disagree with it.
 */
const ATTRIBUTE = "data-kh-wiki-raw";

const wikiLinkRemark = $remark("khWikiLink", () => remarkWikiLinks);

export const wikiLinkNode = $node("wiki_link", () => ({
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  attrs: { raw: { default: "" } },
  parseDOM: [{ tag: `span[${ATTRIBUTE}]`, getAttrs: (dom) => ({ raw: (dom as HTMLElement).getAttribute(ATTRIBUTE) ?? "" }) }],
  toDOM: (node) => {
    const raw = String(node.attrs.raw);
    return ["span", { class: "kh-wikilink", [ATTRIBUTE]: raw, title: raw }, shownText(parseWikiLinkParts(raw.slice(2, -2)))];
  },
  parseMarkdown: {
    match: (node) => node.type === "wikiLink",
    runner: (state, node, type) => {
      state.addNode(type, { raw: String(node.value) });
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "wiki_link",
    runner: (state, node) => {
      // A node of our own, written out by the `wikiLink` handler of `configureWikiLinkStringify`, as it holds it.
      state.addNode("wikiLink", undefined, String(node.attrs.raw));
    },
  },
}));

/** A piece of text that is a wikilink (`raw`), or text that is not. */
export type WikiLinkPiece = string | { raw: string };

/**
 * `[[…]]` in plain text — typed, or pasted from somewhere that carries no Markdown structure — cut
 * out of it. The same `findWikiLinks` decides what a link is, except that plain text has no source
 * to consult for escapes, so a backslash right before the brackets stands for the escape: a person
 * who pastes Markdown they wrote as `\[\[x\]\]` meant it as text.
 */
export function splitWikiLinkText(text: string): WikiLinkPiece[] {
  const pieces: WikiLinkPiece[] = [];
  let cursor = 0;
  for (const match of findWikiLinks({ value: text }, "")) {
    if (text[match.index - 1] === "\\") continue;
    if (match.index > cursor) pieces.push(text.slice(cursor, match.index));
    pieces.push({ raw: text.slice(match.index, match.index + match.length) });
    cursor = match.index + match.length;
  }
  if (cursor < text.length) pieces.push(text.slice(cursor));
  return pieces;
}

/** Text that is being shown, or is already inside a link, is not where a wikilink starts. */
const keepsAsText = (mark: Mark) => mark.type.spec.code === true || mark.type.name === "link";

/** Typing the closing `]]` of `[[…]]` makes it a node. */
const wikiLinkInputRule = $inputRule(
  (ctx) =>
    new InputRule(/(?<![!\\])\[\[[^[\]\n]+\]\]$/, (state, match, start, end) => {
      const raw = match[0];
      if (findWikiLinks({ value: raw }, "").length !== 1) return null;
      if (state.doc.resolve(start).marks().some(keepsAsText)) return null;
      return state.tr.replaceWith(start, end, wikiLinkNode.type(ctx).create({ raw }));
    }),
);

function convertPasted(fragment: Fragment, link: NodeType, inCode: boolean): Fragment {
  const out: ProseNode[] = [];
  fragment.forEach((node) => {
    if (!node.isText) {
      out.push(node.copy(convertPasted(node.content, link, inCode || node.type.spec.code === true)));
    } else if (inCode || node.marks.some(keepsAsText)) {
      out.push(node);
    } else {
      for (const piece of splitWikiLinkText(node.text ?? "")) {
        out.push(typeof piece === "string" ? node.type.schema.text(piece, node.marks) : link.create({ raw: piece.raw }, null, node.marks));
      }
    }
  });
  return Fragment.fromArray(out);
}

/**
 * Pasted text that holds `[[…]]` gets its links made into nodes. The editor has no Markdown paste
 * parser — text pastes as text — so without this a pasted `[[x]]` would be written back escaped like
 * any other. Copy and paste inside the editor already carries the node (`parseDOM`).
 */
const wikiLinkPaste = $prose(
  (ctx) =>
    new Plugin({
      props: {
        transformPasted: (slice, view) => {
          // The slice does not say where it lands: text pasted into a code block arrives without a
          // code block around it, so the place of the paste is asked for here.
          // Marks in force at the caret: the stored ones when there are some (the end of a code span is not
          // inside it unless someone turned the mark on), else those of the text it sits in.
          const { $from } = view.state.selection;
          const marks = view.state.storedMarks ?? $from.marks();
          if ($from.parent.type.spec.code === true || marks.some(keepsAsText)) return slice;
          return new Slice(convertPasted(slice.content, wikiLinkNode.type(ctx), false), slice.openStart, slice.openEnd);
        },
      },
    }),
);

/** Everything the editor needs to hold a wikilink as a node. `configureWikiLinkStringify` is the other half. */
export const wikiLinkPlugins = [...wikiLinkRemark, wikiLinkNode, wikiLinkInputRule, wikiLinkPaste];

/**
 * What the serialiser needs besides the node: a `wikiLink` written out as it was held, and Milkdown's
 * `text` handler kept from returning a literal `[[` unescaped.
 *
 * Applied with `ctx.update(remarkStringifyOptionsCtx, …)` while the editor is configured — a remark
 * plugin cannot do it, because `handlers` in the options win over an extension's.
 */
export function configureWikiLinkStringify(ctx: Ctx): void {
  ctx.update(remarkStringifyOptionsCtx, (previous) => {
    const previousText = previous.handlers?.text;
    return {
      ...previous,
      handlers: {
        ...previous.handlers,
        wikiLink: (node: { value: string }, _parent: unknown, state: State) => {
          const value = String(node.value);
          // A pipe in a table cell ends the cell unless it is escaped; the text keeps it plain.
          return state.stack.includes("tableCell") ? value.replace(/\|/g, "\\|") : value;
        },
        text: (node, parent, state, info) => {
          const value = node.value;
          // Milkdown returns text that ends in a space and has no `*`, `_` or `\` as it is, without
          // escaping anything — so a `[[` the author escaped, written before a wikilink, would come
          // back as a link. Escape the text and put the trailing space back as it was.
          if (value.includes("[[") && /\s$/.test(value)) {
            const trimmed = value.replace(/\s+$/, "");
            return state.safe(trimmed, { ...info, encode: [], after: value.charAt(trimmed.length) }) + value.slice(trimmed.length);
          }
          return previousText ? previousText(node, parent, state, info) : state.safe(value, info);
        },
      },
    };
  });
}
