import { closeHistory } from "@milkdown/kit/prose/history";
import { Plugin, type Command } from "@milkdown/kit/prose/state";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { addColumnAfter, addRowAfter, deleteColumn, deleteRow, deleteTable, isInTable } from "@milkdown/kit/prose/tables";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";

/** The cell the caret is in, and the column it belongs to. GFM rows have one cell per column. */
function currentColumn(view: EditorView): { table: ProseNode; tablePos: number; column: number } | null {
  const { $from } = view.state.selection;
  let cellDepth = -1;
  let tableDepth = -1;
  for (let depth = $from.depth; depth >= 1; depth--) {
    const name = $from.node(depth).type.name;
    if (name === "table_cell" || name === "table_header") cellDepth = depth;
    if (name === "table") { tableDepth = depth; break; }
  }
  if (cellDepth < 0 || tableDepth < 0) return null;
  return { table: $from.node(tableDepth), tablePos: $from.before(tableDepth), column: $from.index(cellDepth - 1) };
}

/** The column's alignment, as the first (header) row carries it: "" for Markdown's default. */
function columnAlignment(view: EditorView): string {
  const current = currentColumn(view);
  const header = current?.table.firstChild;
  return String(header?.maybeChild(current!.column)?.attrs.alignment ?? "");
}

/**
 * Sets every cell in the column, so the drawn table and the delimiter row agree. GFM stores the
 * alignment once per column, in the header row; the reader and the writer read it from there.
 */
function setColumnAlignment(view: EditorView, alignment: string | null): void {
  const current = currentColumn(view);
  if (!current || !view.editable) return;
  const transaction = view.state.tr;
  current.table.forEach((row, offset) => {
    let cellPos = current.tablePos + 1 + offset + 1;
    for (let index = 0; index < row.childCount; index++) {
      const cell = row.child(index);
      if (index === current.column && cell.attrs.alignment !== alignment) {
        transaction.setNodeMarkup(cellPos, undefined, { ...cell.attrs, alignment });
      }
      cellPos += cell.nodeSize;
    }
  });
  if (transaction.docChanged) view.dispatch(closeHistory(transaction));
}

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
      const alignment = document.createElement("select");
      alignment.setAttribute("aria-label", "Column alignment");
      for (const [value, label] of [["", "Align default"], ["left", "Align left"], ["center", "Align center"], ["right", "Align right"]]) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        alignment.appendChild(option);
      }
      const onAlignment = () => {
        setColumnAlignment(view, alignment.value || null);
        view.focus();
        position();
      };
      alignment.addEventListener("change", onAlignment);
      controls.appendChild(alignment);
      cleanup.push(() => alignment.removeEventListener("change", onAlignment));
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
        alignment.value = columnAlignment(view);
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
