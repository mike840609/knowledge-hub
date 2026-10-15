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
