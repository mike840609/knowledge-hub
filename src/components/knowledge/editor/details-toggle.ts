/** Flips a details opening tag, or null when the value is not exactly one. */
export function flipOpenTag(value: string): string | null {
  const text = value.trim();
  if (/^<details>$/.test(text)) return "<details open>";
  if (/^<details\s+open>$/.test(text)) return "<details>";
  return null;
}
/** Summary text must not contain angle brackets: the subset parser reads them as tags. */
export function escapeSummaryText(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { EditorState } from "@milkdown/kit/prose/state";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
const DETAILS_OPEN = /^<details(\s+open)?>$/i;
const DETAILS_CLOSE = /^<\/details>$/i;
/** Innermost details opener at or before pos whose body contains pos. */
export function nearestDetailsOpener(state: EditorState, pos: number): { position: number; open: boolean } | null {
  const stack: { position: number; open: boolean }[] = [];
  state.doc.descendants((node: ProseNode, position: number) => {
    if (position > pos) return false;
    if (node.type.name !== "html") return;
    const text = String(node.attrs.value ?? "").trim();
    if (DETAILS_CLOSE.test(text)) {
      stack.pop();
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
  const html = state.schema.nodes.html;
  const paragraph = state.schema.nodes.paragraph;
  if (!html || !paragraph) return false;
  const start = $from.start();
  const end = $from.end();
  const summary = escapeSummaryText(parent.textContent);
  let tr = state.tr.replaceWith(start, end, [
    html.create({ value: "<details>" }),
    html.create({ value: `<summary>${summary}</summary>` }),
    paragraph.create(),
    html.create({ value: "</details>" }),
  ]);
  let caret: number | null = null;
  tr.doc.descendants((node: ProseNode, position: number) => {
    if (caret !== null) return false;
    if (position < start) return;
    if (node.type.name === "paragraph" && node.content.size === 0) caret = position + 1;
  });
  if (caret !== null) tr = tr.setSelection(new TextSelection(tr.doc.resolve(caret)));
  view.dispatch(tr.scrollIntoView());
  return true;
}
