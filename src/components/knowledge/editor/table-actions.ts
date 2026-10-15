import { Plugin } from "@milkdown/kit/prose/state";
import { addColumnAfter, addRowAfter, isInTable } from "@milkdown/kit/prose/tables";
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
      const row = document.createElement("button");
      row.type = "button";
      row.textContent = "+ Row";
      row.setAttribute("aria-label", "Add row below");
      const column = document.createElement("button");
      column.type = "button";
      column.textContent = "+ Column";
      column.setAttribute("aria-label", "Add column right");
      controls.append(row, column);
      document.body.appendChild(controls);

      function position() {
        if (!view.editable || !view.hasFocus() || !isInTable(view.state)) {
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

      function add(kind: "row" | "column") {
        const command = kind === "row" ? addRowAfter : addColumnAfter;
        if (!view.editable || !command(view.state)) return;
        command(view.state, transaction => view.dispatch(transaction.scrollIntoView()));
        view.focus();
        position();
      }
      const onMouseDown = (event: MouseEvent) => event.preventDefault();
      const onRow = () => add("row");
      const onColumn = () => add("column");
      const onFocus = () => requestAnimationFrame(position);
      row.addEventListener("mousedown", onMouseDown);
      column.addEventListener("mousedown", onMouseDown);
      row.addEventListener("click", onRow);
      column.addEventListener("click", onColumn);
      view.dom.addEventListener("focusin", onFocus);
      view.dom.addEventListener("focusout", onFocus);
      window.addEventListener("scroll", position, true);
      window.addEventListener("resize", position);
      position();
      return {
        update: position,
        destroy() {
          row.removeEventListener("mousedown", onMouseDown);
          column.removeEventListener("mousedown", onMouseDown);
          row.removeEventListener("click", onRow);
          column.removeEventListener("click", onColumn);
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
