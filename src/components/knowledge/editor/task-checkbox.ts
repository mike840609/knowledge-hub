import { closeHistory } from "@milkdown/kit/prose/history";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";

const key = new PluginKey<DecorationSet>("khTaskCheckboxes");

/** A to-do item is a `list_item` whose `checked` attribute is not null. */
function isTask(node: ProseNode): boolean {
  return node.type.name === "list_item" && node.attrs.checked != null;
}

function toggle(view: EditorView, pos: number, checked: boolean): void {
  if (!view.editable) return;
  const item = view.state.doc.nodeAt(pos);
  if (!item || !isTask(item)) return;
  const next = { ...item.attrs, checked: !checked };
  // One undo step, like Notion's tick, rather than one per transaction the browser adds.
  view.dispatch(closeHistory(view.state.tr.setNodeMarkup(pos, undefined, next)).scrollIntoView());
  view.focus();
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
  return $prose(() => new Plugin<DecorationSet>({
    key,
    state: {
      init: (_, state) => build(state.doc),
      apply(transaction, previous, _old, state) {
        return transaction.docChanged ? build(state.doc) : previous;
      },
    },
    props: { decorations: (state) => key.getState(state) ?? null },
  }));
}

function build(doc: ProseNode): DecorationSet {
  const widgets: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!isTask(node)) return true;
    const checked = node.attrs.checked === true;
    widgets.push(Decoration.widget(pos + 1, (view) => control(view, pos, checked), {
      side: -1,
      // The box's look and name both depend on the state, so a change replaces the widget.
      key: `kh-task-${pos}-${checked ? "x" : " "}`,
    }));
    return true;
  });
  return DecorationSet.create(doc, widgets);
}

function control(view: EditorView, pos: number, checked: boolean): HTMLElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "kh-task-toggle kh-focus-ring";
  button.setAttribute("role", "checkbox");
  button.setAttribute("aria-checked", String(checked));
  button.setAttribute("aria-label", checked ? "Mark task incomplete" : "Mark task complete");
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
