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
import type { EditorState } from "@milkdown/kit/prose/state";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { dispatchBlockAction } from "./block-actions";
/** Innermost details opener at or before pos whose body contains pos. */
export function nearestDetailsOpener(state: EditorState, pos: number): { position: number; open: boolean } | null {
  if (pos < 0 || pos > state.doc.content.size) return null;
  const $pos = state.doc.resolve(pos);
  for (let depth = $pos.depth; depth > 0; depth--) {
    if ($pos.node(depth).type.name === "details") return { position: $pos.before(depth), open: Boolean($pos.node(depth).attrs.open) };
  }
  return null;
}
export function inDetails(view: EditorView): boolean {
  return nearestDetailsOpener(view.state, view.state.selection.$from.pos) !== null;
}
/** Replaces the current paragraph or heading with a details disclosure; caret lands in the new empty body. One undo step. */
export function convertBlockToDetails(view: EditorView): boolean {
  if (!view.editable) return false;
  const { state } = view;
  if (!(state.selection instanceof TextSelection)) return false;
  const { $from } = state.selection;
  const parent = $from.parent;
  if (parent.type.name !== "paragraph" && parent.type.name !== "heading") return false;
  return insertDetailsSkeleton(view, $from.before(), $from.after(), parent.textContent);
}
/** Inserts an open disclosure so the body receiving the caret is visible. */
export function insertDetailsSkeleton(view: EditorView, from: number, to: number, summaryValue: string): boolean {
  if (!view.editable) return false;
  const { details, details_summary, details_body, paragraph } = view.state.schema.nodes;
  const title = details_summary.create(null, summaryValue ? view.state.schema.text(summaryValue) : undefined);
  const node = details.create({ open: true }, [title, details_body.create(null, paragraph.create())]);
  const tr = view.state.tr.replaceWith(from, to, node);
  dispatchBlockAction(view, tr, from + 1 + title.nodeSize + 2);
  return true;
}
/** Rewrites the nearest opener at pos, or false when the caret is not in a toggle. */
export function flipNearestDetails(view: EditorView, pos: number): boolean {
  if (!view.editable) return false;
  const found = nearestDetailsOpener(view.state, pos);
  if (!found) return false;
  const tr = view.state.tr.setNodeMarkup(found.position, undefined, { open: !found.open });
  dispatchBlockAction(view, tr, found.open ? found.position + 2 : view.state.selection.from);
  return true;
}
/** Dissolves the toggle at detailsPos, keeping every word: a non-empty summary becomes a
 * paragraph, then the body blocks follow. Backspace and forward Delete cannot cross the
 * toggle's defining boundary, so without this the caret is stuck and the toggle undeletable. */
function dissolveDetails(view: EditorView, detailsPos: number, caretPos: number): boolean {
  const node = view.state.doc.nodeAt(detailsPos);
  if (!node || node.type.name !== "details") return false;
  const summary = node.firstChild!;
  const body = node.lastChild!;
  const { paragraph } = view.state.schema.nodes;
  const blocks = summary.textContent ? [paragraph.create(null, view.state.schema.text(summary.textContent))] : [];
  body.forEach(child => { blocks.push(child); });
  dispatchBlockAction(view, view.state.tr.replaceWith(detailsPos, detailsPos + node.nodeSize, blocks), caretPos);
  return true;
}
/** Backspace where the editor cannot move: the start of a summary, or the start of the first
 * textblock of a body, can never join upward through the toggle. Dissolve it instead. */
export function handleDetailsBackspace(view: EditorView): boolean {
  if (!view.editable) return false;
  const { selection } = view.state;
  if (!(selection instanceof TextSelection) || !selection.empty) return false;
  const { $from } = selection;
  if ($from.parentOffset !== 0) return false;
  const parent = $from.parent;
  if (parent.type.name === "details_summary") {
    const detailsPos = $from.before($from.depth - 1);
    return dissolveDetails(view, detailsPos, detailsPos + 1);
  }
  if (!parent.isTextblock) return false;
  if ($from.node($from.depth - 1)?.type.name !== "details_body" || $from.index($from.depth - 1) !== 0) return false;
  const detailsPos = $from.before($from.depth - 2);
  return dissolveDetails(view, detailsPos, detailsPos + 1);
}
/** Forward Delete where the editor cannot move: the end of a summary can never pull the body
 * up into it. Dissolve the toggle instead, leaving the caret where the summary ended. */
export function handleDetailsForwardDelete(view: EditorView): boolean {
  if (!view.editable) return false;
  const { selection } = view.state;
  if (!(selection instanceof TextSelection) || !selection.empty) return false;
  const { $from } = selection;
  const parent = $from.parent;
  if (parent.type.name !== "details_summary" || $from.parentOffset !== parent.content.size) return false;
  const detailsPos = $from.before($from.depth - 1);
  return dissolveDetails(view, detailsPos, detailsPos + 1 + parent.content.size);
}
/** Plain Backspace/Delete that the toggle would otherwise swallow. */
export function handleDetailsDeleteKey(view: EditorView, key: string): boolean {
  if (key === "Backspace") return handleDetailsBackspace(view);
  if (key === "Delete") return handleDetailsForwardDelete(view);
  return false;
}
