import { Plugin, type Command } from "@milkdown/kit/prose/state";
import { addColumnAfter, addRowAfter, deleteColumn, deleteRow, deleteTable, isInTable } from "@milkdown/kit/prose/tables";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";

/** Controls follow the selected cell; they live outside ProseMirror's editable table. */
export function tableActions() {
  return $prose(() => new Plugin({
    view(view: EditorView) {
      const controls = document.createElement("div");
      controls.className = "kh-table-actions";
      controls.hidden = true;
      controls.setAttribute("role", "group");
      controls.setAttribute("aria-label", "Table actions");
      const actions: [string, string, Command][] = [
        ["+ Row", "Add row below", addRowAfter],
        ["+ Column", "Add column right", addColumnAfter],
        ["Delete row", "Delete row", deleteRow],
        ["Delete column", "Delete column", deleteColumn],
        ["Delete table", "Delete table", deleteTable],
      ];
      const cleanup = actions.map(([label, ariaLabel, command]) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.setAttribute("aria-label", ariaLabel);
        const onMouseDown = (event: MouseEvent) => event.preventDefault();
        const onClick = () => {
          if (!view.editable || !command(view.state)) return;
          command(view.state, transaction => view.dispatch(transaction.scrollIntoView()));
          view.focus();
          position();
        };
        button.addEventListener("mousedown", onMouseDown);
        button.addEventListener("click", onClick);
        controls.appendChild(button);
        return () => {
          button.removeEventListener("mousedown", onMouseDown);
          button.removeEventListener("click", onClick);
        };
      });
      document.body.appendChild(controls);

      function position() {
        if (!view.editable || (!view.hasFocus() && !controls.contains(document.activeElement)) || !isInTable(view.state)) {
          controls.hidden = true;
          return;
        }
        const { $from } = view.state.selection;
        let tablePos: number | null = null;
        for (let depth = $from.depth; depth > 0; depth -= 1) {
          if ($from.node(depth).type.name === "table") {
            tablePos = $from.before(depth);
            break;
          }
        }
        const table = tablePos === null ? null : view.nodeDOM(tablePos) as HTMLElement | null;
        if (!table) { controls.hidden = true; return; }
        const rect = table.getBoundingClientRect();
        controls.hidden = false;
        controls.style.left = `${Math.max(8, Math.min(rect.right - controls.offsetWidth, window.innerWidth - controls.offsetWidth - 8))}px`;
        controls.style.top = `${Math.max(8, rect.top - controls.offsetHeight - 4)}px`;
      }

      const onFocus = () => requestAnimationFrame(position);
      controls.addEventListener("focusout", onFocus);
      view.dom.addEventListener("focusin", onFocus);
      view.dom.addEventListener("focusout", onFocus);
      window.addEventListener("scroll", position, true);
      window.addEventListener("resize", position);
      position();
      return {
        update: position,
        destroy() {
          cleanup.forEach(remove => remove());
          controls.removeEventListener("focusout", onFocus);
          view.dom.removeEventListener("focusin", onFocus);
          view.dom.removeEventListener("focusout", onFocus);
          window.removeEventListener("scroll", position, true);
          window.removeEventListener("resize", position);
          controls.remove();
        },
      };
    },
  }));
}
