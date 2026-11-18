import { closeHistory } from "@milkdown/kit/prose/history";
import { Plugin, Selection, type Command, type EditorState } from "@milkdown/kit/prose/state";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { addColumnAfter, addColumnBefore, addRowAfter, addRowBefore, deleteColumn, deleteRow, isInTable } from "@milkdown/kit/prose/tables";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { icon } from "./block-gutter";

interface CellLocation { table: ProseNode; tablePos: number; row: number; column: number; cellPos: number }

/** The table cell containing `pos` (or the cell node at `pos`), and where it sits. GFM rows have one cell per column. */
function locateCell(doc: ProseNode, pos: number): CellLocation | null {
  if (pos < 0 || pos > doc.content.size) return null;
  const $pos = doc.resolve(pos);
  let cellDepth = -1;
  for (let depth = $pos.depth; depth >= 1; depth--) {
    const name = $pos.node(depth).type.name;
    if (name === "table_cell" || name === "table_header") { cellDepth = depth; break; }
  }
  let cellPos: number;
  let rowDepth: number;
  if (cellDepth >= 0) { cellPos = $pos.before(cellDepth); rowDepth = cellDepth - 1; }
  else {
    const at = doc.nodeAt(pos);
    if (!at || (at.type.name !== "table_cell" && at.type.name !== "table_header")) return null;
    cellPos = pos; rowDepth = $pos.depth;
  }
  if (rowDepth < 2 || !/^table_(header_)?row$/.test($pos.node(rowDepth).type.name) || $pos.node(rowDepth - 1).type.name !== "table") return null;
  return { table: $pos.node(rowDepth - 1), tablePos: $pos.before(rowDepth - 1), row: $pos.index(rowDepth - 1), column: $pos.index(rowDepth), cellPos };
}

/** The column's alignment, as the first (header) row carries it: "" for Markdown's default. */
function columnAlignment(cell: CellLocation): string {
  return String(cell.table.firstChild?.maybeChild(cell.column)?.attrs.alignment ?? "");
}

/**
 * Sets every cell in the column, so the drawn table and the delimiter row agree. GFM stores the
 * alignment once per column, in the header row; the reader and the writer read it from there.
 */
function setColumnAlignment(view: EditorView, cellPos: number, alignment: string | null): void {
  const current = locateCell(view.state.doc, cellPos);
  if (!current || !view.editable) return;
  const transaction = view.state.tr;
  current.table.forEach((row, offset) => {
    let pos = current.tablePos + 1 + offset + 1;
    for (let index = 0; index < row.childCount; index++) {
      const cell = row.child(index);
      if (index === current.column && cell.attrs.alignment !== alignment) {
        transaction.setNodeMarkup(pos, undefined, { ...cell.attrs, alignment });
      }
      pos += cell.nodeSize;
    }
  });
  if (transaction.docChanged) view.dispatch(closeHistory(transaction));
}

/** The first ancestor that scrolls sideways, if any: a grip whose cell is scrolled out of it must not float over the page. */
function scrollRegion(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowX;
    if (overflow === "auto" || overflow === "scroll" || overflow === "hidden") return node;
  }
  return null;
}

const outside = (rect: DOMRect, region: DOMRect) =>
  rect.right < region.left || rect.left > region.right || rect.bottom < region.top || rect.top > region.bottom;

/** Grips beside a row and above a column open menus for it; they live outside ProseMirror's editable table. */
export function tableActions() {
  let focusRowGrip: (() => boolean) | undefined;
  return $prose(() => new Plugin({
    props: {
      handleKeyDown(view, event) {
        if (event.key !== "F10" || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing) return false;
        if (!view.editable || !isInTable(view.state)) return false;
        const handled = focusRowGrip?.() ?? false;
        if (handled) event.stopPropagation();
        return handled;
      },
    },
    view(view: EditorView) {
      let hovered: number | null = null;
      let pointerInside = false;
      let destroyed = false;
      const rowGrip = document.createElement("button");
      const colGrip = document.createElement("button");
      const menu = document.createElement("div");
      for (const [grip, className] of [[rowGrip, "kh-table-grip"], [colGrip, "kh-table-col-grip"]] as const) {
        grip.type = "button"; grip.className = className; grip.hidden = true;
        grip.setAttribute("aria-haspopup", "menu"); grip.setAttribute("aria-expanded", "false");
        grip.appendChild(icon("grip"));
      }
      menu.className = "kh-block-move-menu"; menu.hidden = true; menu.setAttribute("role", "menu");
      let menuGrip: HTMLButtonElement | null = null;
      // Two bars in the strip just below and just right of the table; DOM order is the Tab order after the grips.
      const addRowBar = document.createElement("button");
      const addColumnBar = document.createElement("button");
      for (const [bar, label] of [[addRowBar, "Add row"], [addColumnBar, "Add column"]] as const) {
        bar.type = "button"; bar.className = "kh-table-add"; bar.hidden = true; bar.setAttribute("aria-label", label); bar.title = label;
        bar.appendChild(icon("plus"));
      }
      const controls = [rowGrip, colGrip, addRowBar, addColumnBar];
      document.body.append(rowGrip, colGrip, addRowBar, addColumnBar, menu);
      const inControls = (node: Node | null) => !!node && (controls.some(control => control.contains(node)) || menu.contains(node));

      /** The cell controls act on: the one under the pointer, else the one holding the caret. */
      function targetCell(): CellLocation | null {
        if (hovered !== null) { const cell = locateCell(view.state.doc, hovered); if (cell) return cell; }
        const { $from } = view.state.selection;
        return locateCell(view.state.doc, $from.pos);
      }

      /** Runs `command` with the caret in the target cell, as one undo step. */
      function run(command: Command, cellPos: number) {
        if (!view.editable) return;
        const cell = locateCell(view.state.doc, cellPos);
        if (!cell) return;
        const select = view.state.tr.setSelection(Selection.near(view.state.doc.resolve(cellPos + 1)));
        view.dispatch(closeHistory(select));
        command(view.state, transaction => view.dispatch(closeHistory(transaction).scrollIntoView()));
        hovered = null;
      }

      /** The cell of `row` (default: the last) at `column` (default: the last), as a position inside the table. */
      function cellPosAt(table: ProseNode, tablePos: number, row: number, column?: number): number {
        let pos = tablePos + 1;
        for (let index = 0; index < row; index++) pos += table.child(index).nodeSize;
        const rowNode = table.child(row);
        pos += 1;
        const stop = column ?? rowNode.childCount - 1;
        for (let index = 0; index < stop; index++) pos += rowNode.child(index).nodeSize;
        return pos;
      }
      function addRow() {
        const target = targetCell();
        if (!target || !view.editable) return;
        run(addRowAfter, cellPosAt(target.table, target.tablePos, target.table.childCount - 1, 0));
        const table = view.state.doc.nodeAt(target.tablePos);
        if (table) view.dispatch(view.state.tr.setSelection(Selection.near(view.state.doc.resolve(cellPosAt(table, target.tablePos, table.childCount - 1, 0) + 1))));
        view.focus(); position();
      }
      function addColumn() {
        const target = targetCell();
        if (!target || !view.editable) return;
        const row = target.row;
        run(addColumnAfter, cellPosAt(target.table, target.tablePos, row));
        const table = view.state.doc.nodeAt(target.tablePos);
        if (table) view.dispatch(view.state.tr.setSelection(Selection.near(view.state.doc.resolve(cellPosAt(table, target.tablePos, row) + 1))));
        view.focus(); position();
      }

      function menuItem(label: string, onRun: () => void, role: "menuitem" | "menuitemradio" = "menuitem", checked?: boolean) {
        const button = document.createElement("button");
        button.type = "button"; button.setAttribute("role", role); button.textContent = label;
        if (role === "menuitemradio") button.setAttribute("aria-checked", String(checked === true));
        button.addEventListener("mousedown", event => { if (event.button === 0) event.preventDefault(); });
        button.addEventListener("click", () => { closeMenu(); onRun(); view.focus(); position(); });
        return button;
      }
      function rule() {
        const separator = document.createElement("div");
        separator.setAttribute("role", "separator"); separator.className = "kh-block-menu-separator";
        return separator;
      }

      function closeMenu() {
        menu.hidden = true; menu.replaceChildren();
        menuGrip?.setAttribute("aria-expanded", "false"); menuGrip = null;
      }

      function openMenu(grip: HTMLButtonElement, kind: "row" | "column") {
        const target = targetCell();
        if (!target || !view.editable) return;
        const at = target.cellPos;
        const items: HTMLElement[] = [];
        if (kind === "row") {
          menu.setAttribute("aria-label", `Row ${target.row + 1} actions`);
          if (target.row > 0) items.push(menuItem("Insert row above", () => run(addRowBefore, at)));
          items.push(menuItem("Insert row below", () => run(addRowAfter, at)), rule(), menuItem("Delete row", () => run(deleteRow, at)));
        } else {
          menu.setAttribute("aria-label", `Column ${target.column + 1} actions`);
          const current = columnAlignment(target);
          items.push(menuItem("Insert column left", () => run(addColumnBefore, at)), menuItem("Insert column right", () => run(addColumnAfter, at)), rule());
          for (const [value, label] of [["", "Default"], ["left", "Left"], ["center", "Center"], ["right", "Right"]]) {
            items.push(menuItem(label, () => setColumnAlignment(view, at, value || null), "menuitemradio", current === value));
          }
          items.push(rule(), menuItem("Delete column", () => run(deleteColumn, at)));
        }
        menu.replaceChildren(...items);
        menu.hidden = false;
        menuGrip = grip; grip.setAttribute("aria-expanded", "true");
        const rect = grip.getBoundingClientRect();
        menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8))}px`;
        menu.style.top = `${rect.bottom + 4}px`;
        (menu.querySelector("[role^=menuitem]") as HTMLElement | null)?.focus();
      }

      function toggle(grip: HTMLButtonElement, kind: "row" | "column") {
        if (menuGrip === grip) { closeMenu(); view.focus(); } else { closeMenu(); openMenu(grip, kind); }
      }
      const gripListeners: Array<() => void> = [];
      for (const [grip, kind] of [[rowGrip, "row"], [colGrip, "column"]] as const) {
        const onClick = () => toggle(grip, kind);
        const onDown = (event: MouseEvent) => { if (event.button === 0) event.preventDefault(); };
        const onKey = (event: KeyboardEvent) => {
          if (event.key === "ArrowDown" && menuGrip !== grip) { event.preventDefault(); closeMenu(); openMenu(grip, kind); }
          else if (event.key === "Escape") { event.preventDefault(); closeMenu(); view.focus(); }
        };
        const onEnter = () => { pointerInside = true; };
        grip.addEventListener("click", onClick); grip.addEventListener("mousedown", onDown);
        grip.addEventListener("keydown", onKey); grip.addEventListener("pointerenter", onEnter);
        gripListeners.push(() => {
          grip.removeEventListener("click", onClick); grip.removeEventListener("mousedown", onDown);
          grip.removeEventListener("keydown", onKey); grip.removeEventListener("pointerenter", onEnter);
        });
      }
      for (const [bar, act] of [[addRowBar, addRow], [addColumnBar, addColumn]] as const) {
        const onDown = (event: MouseEvent) => { if (event.button === 0) event.preventDefault(); };
        const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); view.focus(); } };
        const onEnter = () => { pointerInside = true; };
        bar.addEventListener("click", act); bar.addEventListener("mousedown", onDown);
        bar.addEventListener("keydown", onKey); bar.addEventListener("pointerenter", onEnter);
        gripListeners.push(() => {
          bar.removeEventListener("click", act); bar.removeEventListener("mousedown", onDown);
          bar.removeEventListener("keydown", onKey); bar.removeEventListener("pointerenter", onEnter);
        });
      }
      const onMenuKey = (event: KeyboardEvent) => {
        const entries = [...menu.querySelectorAll<HTMLElement>("[role^=menuitem]")];
        const index = entries.indexOf(document.activeElement as HTMLElement);
        if (event.key === "Escape") { event.preventDefault(); closeMenu(); view.focus(); position(); }
        else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          entries[(index + (event.key === "ArrowDown" ? 1 : entries.length - 1)) % entries.length]?.focus();
        } else if (event.key === "Tab") closeMenu();
      };
      menu.addEventListener("keydown", onMenuKey);
      const onDocumentDown = (event: MouseEvent) => {
        const node = event.target as Node;
        if (!menu.hidden && !inControls(node)) closeMenu();
      };
      document.addEventListener("mousedown", onDocumentDown, true);

      function position() {
        if (destroyed) return;
        const target = view.editable ? targetCell() : null;
        const tableDom = target ? view.nodeDOM(target.tablePos) as HTMLElement | null : null;
        const active = document.activeElement;
        const controlsFocused = inControls(active);
        const caretIn = !!target && (hovered === null) && (view.hasFocus() || controlsFocused);
        const show = !!target && !!tableDom && (hovered !== null || caretIn || controlsFocused || pointerInside);
        if (!show || !target || !tableDom) {
          for (const control of controls) control.hidden = true;
          if (!menu.hidden && !controlsFocused) closeMenu();
          return;
        }
        rowGrip.setAttribute("aria-label", `Row ${target.row + 1} actions`);
        colGrip.setAttribute("aria-label", `Column ${target.column + 1} actions`);
        const region = scrollRegion(tableDom)?.getBoundingClientRect() ?? null;
        const rowDom = view.nodeDOM(target.tablePos + 1 + rowOffset(target)) as HTMLElement | null;
        const headerPos = target.tablePos + 2 + columnOffset(target);
        const headerDom = view.nodeDOM(headerPos) as HTMLElement | null;
        const rowRect = (rowDom ?? tableDom).getBoundingClientRect();
        const headerRect = (headerDom ?? tableDom).getBoundingClientRect();
        const editorRect = view.dom.getBoundingClientRect();
        rowGrip.hidden = !!region && outside(rowRect, region);
        colGrip.hidden = !!region && outside(headerRect, region);
        rowGrip.style.left = `${editorRect.left + (56 - 24) / 2}px`;
        rowGrip.style.top = `${rowRect.top + rowRect.height / 2 - 12}px`;
        colGrip.style.left = `${headerRect.left + headerRect.width / 2 - 12}px`;
        colGrip.style.top = `${headerRect.top}px`;
        // The bars span the table's visible box, in the strip directly below and directly right of it.
        const tableRect = tableDom.getBoundingClientRect();
        const clip = region ?? tableRect;
        const left = Math.max(tableRect.left, clip.left), right = Math.min(tableRect.right, clip.right);
        const top = Math.max(tableRect.top, clip.top), bottom = Math.min(tableRect.bottom, clip.bottom);
        const gone = !!region && outside(tableRect, region);
        addRowBar.hidden = gone; addColumnBar.hidden = gone;
        addRowBar.style.left = `${left}px`; addRowBar.style.top = `${bottom}px`; addRowBar.style.width = `${Math.max(0, right - left)}px`;
        addColumnBar.style.left = `${right}px`; addColumnBar.style.top = `${top}px`; addColumnBar.style.height = `${Math.max(0, bottom - top)}px`;
        if (!menu.hidden && menuGrip && menuGrip.hidden) closeMenu();
      }
      function rowOffset(target: CellLocation) {
        let offset = 0;
        for (let index = 0; index < target.row; index++) offset += target.table.child(index).nodeSize;
        return offset;
      }
      function columnOffset(target: CellLocation) {
        const header = target.table.firstChild;
        let offset = 0;
        for (let index = 0; index < target.column && header; index++) offset += header.child(index).nodeSize;
        return offset;
      }

      const onPointerMove = (event: PointerEvent) => {
        pointerInside = true;
        const cell = (event.target as HTMLElement | null)?.closest?.("td, th");
        if (!cell || !view.dom.contains(cell)) return;
        let pos: number;
        try { pos = view.posAtDOM(cell, 0); } catch { return; }
        const located = locateCell(view.state.doc, pos);
        if (!located) return;
        const next = located.cellPos;
        if (next !== hovered && menu.hidden) { hovered = next; position(); }
      };
      const onPointerLeave = (event: PointerEvent) => {
        const to = event.relatedTarget as Node | null;
        if (inControls(to)) return;
        pointerInside = false;
        if (menu.hidden) { hovered = null; position(); }
      };
      const onFocus = () => requestAnimationFrame(position);
      view.dom.addEventListener("pointermove", onPointerMove);
      view.dom.addEventListener("pointerleave", onPointerLeave);
      for (const control of controls) control.addEventListener("pointerleave", onPointerLeave);
      for (const element of [...controls, menu]) element.addEventListener("focusout", onFocus);
      view.dom.addEventListener("focusin", onFocus);
      view.dom.addEventListener("focusout", onFocus);
      window.addEventListener("scroll", position, true);
      window.addEventListener("resize", position);
      focusRowGrip = () => { position(); if (rowGrip.hidden) return false; rowGrip.focus(); return document.activeElement === rowGrip; };
      position();
      return {
        update(updated: EditorView, previous: EditorState) {
          // A hovered cell is a position in the old document; once the document or the caret moves, the caret rules.
          if (hovered !== null && (previous.doc !== updated.state.doc || !previous.selection.eq(updated.state.selection))) hovered = null;
          if (previous.doc !== updated.state.doc) closeMenu();
          position();
        },
        destroy() {
          destroyed = true;
          focusRowGrip = undefined;
          gripListeners.forEach(remove => remove());
          menu.removeEventListener("keydown", onMenuKey);
          document.removeEventListener("mousedown", onDocumentDown, true);
          view.dom.removeEventListener("pointermove", onPointerMove);
          view.dom.removeEventListener("pointerleave", onPointerLeave);
          view.dom.removeEventListener("focusin", onFocus);
          view.dom.removeEventListener("focusout", onFocus);
          window.removeEventListener("scroll", position, true);
          window.removeEventListener("resize", position);
          for (const control of controls) control.remove();
          menu.remove();
        },
      };
    },
  }));
}
