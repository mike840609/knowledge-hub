import { closeHistory } from "@milkdown/kit/prose/history";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";

const key = new PluginKey<DecorationSet>("khTaskCheckboxes");

/** A meta the editor sends when `setEditable` changes: decorations built for a mode are rebuilt. */
export const TASK_EDITABLE_CHANGED = "khEditableChanged";

/** A to-do item is a `list_item` whose `checked` attribute is not null. */
function isTask(node: ProseNode): boolean {
  return node.type.name === "list_item" && node.attrs.checked != null;
}

function toggle(view: EditorView, pos: number, checked: boolean): void {
  if (!view.editable) return;
  const item = view.state.doc.nodeAt(pos);
  if (!item || !isTask(item)) return;
  const next = { ...item.attrs, checked: !checked };
  // A keyboard user keeps the control: the widget is replaced (its state changed), so the focus
  // moves to the new one rather than falling back to the editor.
  const keepFocus = document.activeElement instanceof HTMLElement && document.activeElement.classList.contains("kh-task-toggle");
  // One undo step, like Notion's tick, rather than one per transaction the browser adds.
  view.dispatch(closeHistory(view.state.tr.setNodeMarkup(pos, undefined, next)).scrollIntoView());
  if (keepFocus) view.dom.querySelector<HTMLElement>(`[data-kh-task="${pos}"]`)?.focus();
  else view.focus();
}

/**
 * A to-do's box as a control, not decoration. The editor draws the box with `::before`
 * (globals.css), so it has no input to click: this puts an invisible, focusable button over the
 * drawn box. It carries the state and the action name for assistive tech, and the Markdown stays
 * the one source of truth (`- [ ]` / `- [x]`).
 *
 * A widget decoration, not a node view: it changes no Markdown, adds nothing ProseMirror writes,
 * and the decoration set is rebuilt from the document, so a toggle renames the control.
 */
export function taskCheckbox() {
  // The mode the decorations were built for. `setEditable` sends it in a meta, so the widget's
  // DOM (an inert span or a button) is replaced rather than reused.
  let editable = true;
  let generation = 0;
  return $prose(() => new Plugin<DecorationSet>({
    key,
    state: {
      init: (_, state) => build(state.doc, editable, generation),
      apply(transaction, previous, _old, state) {
        const next = transaction.getMeta(TASK_EDITABLE_CHANGED);
        if (next !== undefined) { editable = Boolean(next); generation += 1; }
        return next !== undefined || transaction.docChanged ? build(state.doc, editable, generation) : previous;
      },
    },
    props: { decorations: (state) => key.getState(state) ?? null },
  }));
}

function build(doc: ProseNode, editable: boolean, generation: number): DecorationSet {
  const widgets: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!isTask(node)) return true;
    const checked = node.attrs.checked === true;
    widgets.push(Decoration.widget(pos + 1, (view) => control(view, pos, checked), {
      side: -1,
      // The box's look and name both depend on the state, so a change replaces the widget.
      key: `kh-task-${pos}-${checked ? "x" : " "}-${editable ? "edit" : "read"}-${generation}`,
    }));
    return true;
  });
  return DecorationSet.create(doc, widgets);
}

function control(view: EditorView, pos: number, checked: boolean): HTMLElement {
  // A revision snapshot or a viewer's page is read-only: the drawn box stays, but nothing here
  // claims to be a checkbox that can be pressed.
  if (!view.editable) {
    const inert = document.createElement("span");
    inert.className = "kh-task-toggle";
    inert.setAttribute("aria-hidden", "true");
    return inert;
  }
  const button = document.createElement("button");
  button.type = "button";
  button.className = "kh-task-toggle kh-focus-ring";
  button.setAttribute("role", "checkbox");
  button.setAttribute("aria-checked", String(checked));
  button.setAttribute("aria-label", checked ? "Mark task incomplete" : "Mark task complete");
  button.setAttribute("data-kh-task", String(pos));
  button.tabIndex = 0;
  // A press on the box must not move the caret or select the line behind it.
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", () => toggle(view, pos, checked));
  button.addEventListener("keydown", (event) => {
    if (event.key !== " " && event.key !== "Enter") return;
    event.preventDefault();
    event.stopPropagation();
    toggle(view, pos, checked);
  });
  return button;
}
