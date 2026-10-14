/** Flips a details opening tag, or null when the value is not exactly one. */
export function flipOpenTag(value: string): string | null {
  const text = value.trim();
  if (/^<details>/i.test(text)) return text.replace(/^<details>/i, "<details open>");
  if (/^<details\s+open>/i.test(text)) return text.replace(/^<details\s+open>/i, "<details>");
  return null;
}
/** Summary text must not contain angle brackets: the subset parser reads them as tags. */
export function escapeSummaryText(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { closeHistory } from "@milkdown/kit/prose/history";
import type { EditorState } from "@milkdown/kit/prose/state";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
const DETAILS_OPEN = /^<details(\s+open)?>/i;
const DETAILS_CLOSE = /^<\/details>$/i;
/** Innermost details opener at or before pos whose body contains pos. */
export function nearestDetailsOpener(state: EditorState, pos: number): { position: number; open: boolean } | null {
  const stack: { position: number; open: boolean }[] = [];
  state.doc.descendants((node: ProseNode, position: number) => {
    if (position > pos) return false;
    if (node.type.name !== "html") return;
    const text = String(node.attrs.value ?? "").trim();
    if (DETAILS_CLOSE.test(text)) {
      if (stack.length > 0) stack.pop();
      return;
    }
    const match = DETAILS_OPEN.exec(text);
    if (match) stack.push({ position, open: match[1] !== undefined });
  });
  return stack.length > 0 ? stack[stack.length - 1] : null;
}
export function inDetails(view: EditorView): boolean {
  return nearestDetailsOpener(view.state, view.state.selection.$from.pos) !== null;
}
/** Replaces the current paragraph or heading with a details disclosure; caret lands in the new empty body. One undo step. */
export function convertBlockToDetails(view: EditorView): boolean {
  const { state } = view;
  if (!(state.selection instanceof TextSelection)) return false;
  const { $from } = state.selection;
  const parent = $from.parent;
  if (parent.type.name !== "paragraph" && parent.type.name !== "heading") return false;
  const summary = escapeSummaryText(parent.textContent);
  return insertDetailsSkeleton(view, $from.start(), $from.end(), summary);
}
/** The four nodes of one disclosure: opener, summary, empty body, closer. */
function detailsNodes(state: EditorState, summaryValue: string): ProseNode[] | null {
  const html = state.schema.nodes.html;
  const paragraph = state.schema.nodes.paragraph;
  if (!html || !paragraph) return null;
  return [
    html.create({ value: "<details>" }),
    html.create({ value: `<summary>${summaryValue}</summary>` }),
    paragraph.create(),
    html.create({ value: "</details>" }),
  ];
}
/** Position inside the first empty paragraph at or after from, if any. */
function firstEmptyBodyAtOrAfter(doc: ProseNode, from: number): number | null {
  let caret: number | null = null;
  doc.descendants((node: ProseNode, position: number) => {
    if (caret !== null) return false;
    if (position < from) return;
    if (node.type.name === "paragraph" && node.content.size === 0) caret = position + 1;
  });
  return caret;
}
/** Replaces [from, to) with a disclosure; caret lands in its body. One undo step. */
export function insertDetailsSkeleton(view: EditorView, from: number, to: number, summaryValue: string): boolean {
  const nodes = detailsNodes(view.state, summaryValue);
  if (!nodes) return false;
  let tr = view.state.tr.replaceWith(from, to, nodes);
  const caret = firstEmptyBodyAtOrAfter(tr.doc, from);
  if (caret === null) return false;
  tr = tr.setSelection(new TextSelection(tr.doc.resolve(caret)));
  view.dispatch(closeHistory(tr.scrollIntoView()));
  return true;
}
/** Rewrites the nearest opener at pos, or false when the caret is not in a toggle. */
export function flipNearestDetails(view: EditorView, pos: number): boolean {
  const found = nearestDetailsOpener(view.state, pos);
  if (!found) return false;
  const html = view.state.schema.nodes.html;
  const node = view.state.doc.nodeAt(found.position);
  if (!node || node.type.name !== "html" || !html) return false;
  const flipped = flipOpenTag(String(node.attrs.value ?? ""));
  if (!flipped) return false;
  view.dispatch(view.state.tr.replaceWith(found.position, found.position + node.nodeSize, html.create({ value: flipped })));
  return true;
}
