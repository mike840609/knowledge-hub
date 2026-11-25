import { closeHistory } from "@milkdown/kit/prose/history";
import { Plugin, Selection, type Command, type EditorState, type Transaction } from "@milkdown/kit/prose/state";
import { Fragment, type Node as ProseNode } from "@milkdown/kit/prose/model";
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
 * How many columns the table has. Rows can disagree for a moment — a header row emptied by a deletion, or a
 * table loaded with uneven rows — and the menu must keep offering the actions the table still allows.
 */
function columnCount(table: ProseNode): number {
  let count = 0;
  table.forEach((row) => { count = Math.max(count, row.childCount); });
  return count;
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
  if (transaction.docChanged) { view.dispatch(closeHistory(transaction)); settle(view); }
}

/** Ends the history event an action just made, so text typed right after it is its own undo step. */
function settle(view: EditorView): void {
  view.dispatch(closeHistory(view.state.tr));
}

/** A column the table just gained starts with Markdown's default alignment, not the schema's "left". */
function clearColumnAlignment(transaction: Transaction, tablePos: number, column: number): void {
  const table = transaction.doc.nodeAt(tablePos);
  if (!table || table.type.name !== "table") return;
  table.forEach((row, offset) => {
    if (column >= row.childCount) return;
    let pos = tablePos + 1 + offset + 1;
    for (let index = 0; index < column; index++) pos += row.child(index).nodeSize;
    const cell = row.child(column);
    if (cell.attrs.alignment != null) transaction.setNodeMarkup(pos, undefined, { ...cell.attrs, alignment: null });
  });
}

/** How far a press on a grip travels before it is a drag and no longer a click. */
const DRAG_THRESHOLD = 4;

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
      function run(command: Command, cellPos: number, newColumn?: number) {
        if (!view.editable) return;
        const cell = locateCell(view.state.doc, cellPos);
        if (!cell) return;
        const select = view.state.tr.setSelection(Selection.near(view.state.doc.resolve(cellPos + 1)));
        view.dispatch(closeHistory(select));
        command(view.state, transaction => {
          if (newColumn !== undefined) clearColumnAlignment(transaction, cell.tablePos, newColumn);
          view.dispatch(closeHistory(transaction).scrollIntoView());
        });
        if (command === deleteRow || command === deleteColumn) {
          // Choose the cell in the table that remains, after any table fix has run: the same row and column
          // where they survive, else the nearest. The deleted cell itself cannot be mapped.
          const table = view.state.doc.nodeAt(cell.tablePos);
          if (table) {
            const row = Math.min(cell.row, table.childCount - 1);
            const rowNode = table.child(row);
            if (rowNode.childCount > 0) {
              const column = Math.min(cell.column, rowNode.childCount - 1);
              const selection = Selection.near(view.state.doc.resolve(cellPosAt(table, cell.tablePos, row, column) + 1));
              view.dispatch(closeHistory(view.state.tr.setSelection(selection)).scrollIntoView());
            }
          }
        }
        hovered = null;
        settle(view);
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
        if (table) { view.dispatch(view.state.tr.setSelection(Selection.near(view.state.doc.resolve(cellPosAt(table, target.tablePos, table.childCount - 1, 0) + 1)))); settle(view); }
        view.focus(); position();
      }
      function addColumn() {
        const target = targetCell();
        if (!target || !view.editable) return;
        // The bar adds a column at the end; the writer stays in the row their caret was in, even when the
        // pointer (which is what showed the bar) is over another row.
        const caret = locateCell(view.state.doc, view.state.selection.$from.pos);
        const row = caret?.tablePos === target.tablePos ? caret.row : target.row;
        run(addColumnAfter, cellPosAt(target.table, target.tablePos, row), target.table.child(row).childCount);
        const table = view.state.doc.nodeAt(target.tablePos);
        if (table) { view.dispatch(view.state.tr.setSelection(Selection.near(view.state.doc.resolve(cellPosAt(table, target.tablePos, row) + 1)))); settle(view); }
        view.focus(); position();
      }

      /**
       * Delete the header row as GFM can: a table always has one, so the first body row becomes the header
       * instead of leaving a header row with no cells (which no column action could then act on).
       */
      function deleteHeaderRow(target: CellLocation) {
        if (!view.editable || target.table.childCount < 2) return;
        const { table, tablePos } = target;
        const header = table.firstChild!;
        const headerCell = view.state.schema.nodes.table_header;
        const cells: ProseNode[] = [];
        table.child(1).forEach((cell) => cells.push(headerCell.create(cell.attrs, cell.content, cell.marks)));
        const rows: ProseNode[] = [header.type.create(header.attrs, Fragment.fromArray(cells))];
        for (let index = 2; index < table.childCount; index++) rows.push(table.child(index));
        // GFM requires at least one body row. A header-plus-one-row table leaves none after promotion,
        // so keep an empty one rather than dispatch a table the schema refuses.
        if (rows.length === 1) {
          const empty: ProseNode[] = [];
          for (let index = 0; index < rows[0].childCount; index++) empty.push(view.state.schema.nodes.table_cell.createAndFill()!);
          rows.push(view.state.schema.nodes.table_row.create(null, Fragment.fromArray(empty)));
        }
        const next = table.type.create(table.attrs, Fragment.fromArray(rows));
        const tr = view.state.tr.replaceWith(tablePos, tablePos + table.nodeSize, next);
        // The promoted row holds the column the writer was acting on.
        const column = Math.min(target.column, next.firstChild!.childCount - 1);
        tr.setSelection(Selection.near(tr.doc.resolve(cellPosAt(next, tablePos, 0, column) + 1)));
        view.dispatch(closeHistory(tr).scrollIntoView());
        hovered = null;
        settle(view);
      }

      function menuItem(label: string, onRun: () => void, role: "menuitem" | "menuitemradio" = "menuitem", checked?: boolean, disabled = false) {
        const button = document.createElement("button");
        button.type = "button"; button.setAttribute("role", role); button.textContent = label;
        if (disabled) { button.disabled = true; button.setAttribute("aria-disabled", "true"); }
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
          items.push(menuItem("Insert row below", () => run(addRowAfter, at)), rule(), menuItem("Delete row", () => target.row === 0 ? deleteHeaderRow(target) : run(deleteRow, at), "menuitem", undefined, target.table.childCount <= 1));
        } else {
          menu.setAttribute("aria-label", `Column ${target.column + 1} actions`);
          const current = columnAlignment(target);
          items.push(menuItem("Insert column left", () => run(addColumnBefore, at, target.column)), menuItem("Insert column right", () => run(addColumnAfter, at, target.column + 1)), rule());
          for (const [value, label] of [["", "Default"], ["left", "Left"], ["center", "Center"], ["right", "Right"]]) {
            items.push(menuItem(label, () => setColumnAlignment(view, at, value || null), "menuitemradio", current === value));
          }
          items.push(rule(), menuItem("Delete column", () => run(deleteColumn, at), "menuitem", undefined, columnCount(target.table) <= 1));
        }
        menu.replaceChildren(...items);
        menu.hidden = false;
        menuGrip = grip; grip.setAttribute("aria-expanded", "true");
        placeMenu();
        menu.querySelector<HTMLElement>("[role^=menuitem]:not(:disabled)")?.focus();
      }

      /** Under its grip, kept inside the viewport; above the grip when there is no room below. */
      function placeMenu() {
        if (!menuGrip) return;
        const rect = menuGrip.getBoundingClientRect();
        const width = menu.offsetWidth, height = menu.offsetHeight;
        menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
        const below = rect.bottom + 4;
        const top = below + height <= window.innerHeight - 8 ? below : rect.top - 4 - height;
        menu.style.top = `${Math.max(8, top)}px`;
      }

      // Dragging a grip (2026-11-25 table-drag-reorder design): a press that travels past DRAG_THRESHOLD moves its row or column.
      const dropLine = document.createElement("div");
      dropLine.className = "kh-block-drop-line kh-table-drop-line"; dropLine.hidden = true; dropLine.setAttribute("aria-hidden", "true");
      document.body.appendChild(dropLine);
      interface TableDrag {
        kind: "row" | "column"; tablePos: number; from: number; caretColumn: number;
        startX: number; startY: number; active: boolean; cancelled: boolean; boundary: number | null; doc: ProseNode; marked: Element[];
      }
      let drag: TableDrag | null = null;
      let suppressClick = false;

      /** The boundary nearest the pointer: between rows (never above the header) or between columns. */
      function boundaryAt(state: TableDrag, x: number, y: number): { boundary: number; line: DOMRect } | null {
        const table = view.state.doc.nodeAt(state.tablePos);
        const tableDom = view.nodeDOM(state.tablePos) as HTMLElement | null;
        if (!table || !tableDom) return null;
        const tableRect = tableDom.getBoundingClientRect();
        const rects: DOMRect[] = [];
        if (state.kind === "row") {
          for (let index = 0, offset = 0; index < table.childCount; offset += table.child(index).nodeSize, index++) {
            const dom = view.nodeDOM(state.tablePos + 1 + offset) as HTMLElement | null;
            if (!dom) return null;
            rects.push(dom.getBoundingClientRect());
          }
        } else {
          const header = table.child(0);
          for (let index = 0; index < header.childCount; index++) {
            const dom = view.nodeDOM(cellPosAt(table, state.tablePos, 0, index)) as HTMLElement | null;
            if (!dom) return null;
            rects.push(dom.getBoundingClientRect());
          }
        }
        if (rects.length === 0) return null;
        const point = state.kind === "row" ? y : x;
        let boundary = rects.length;
        for (let index = 0; index < rects.length; index++) {
          const mid = state.kind === "row" ? rects[index].top + rects[index].height / 2 : rects[index].left + rects[index].width / 2;
          if (point < mid) { boundary = index; break; }
        }
        // GFM has one header row, and it stays first: nothing lands above it.
        if (state.kind === "row") boundary = Math.max(boundary, 1);
        const edge = boundary < rects.length ? rects[boundary] : rects[rects.length - 1];
        const line = state.kind === "row"
          ? new DOMRect(tableRect.left, boundary < rects.length ? edge.top : edge.bottom, tableRect.width, 2)
          : new DOMRect(boundary < rects.length ? edge.left : edge.right, tableRect.top, 2, tableRect.height);
        return { boundary, line };
      }

      function clearDragVisuals() {
        dropLine.hidden = true;
        document.body.classList.remove("kh-block-is-dragging");
        for (const element of drag?.marked ?? []) element.classList.remove("kh-table-drag-source");
        if (drag) drag.marked = [];
      }
      function cancelDrag() { if (drag) { drag.cancelled = true; drag.boundary = null; clearDragVisuals(); } }

      /** One transaction: the table rebuilt with the row or column moved to `boundary`, the caret in its cell. */
      function moveTo(state: TableDrag, boundary: number) {
        const table = view.state.doc.nodeAt(state.tablePos);
        if (!table || !view.editable) return;
        const to = boundary > state.from ? boundary - 1 : boundary;
        let next: ProseNode;
        if (state.kind === "row") {
          const rows: ProseNode[] = [];
          table.forEach(row => rows.push(row));
          rows.splice(to, 0, rows.splice(state.from, 1)[0]);
          next = table.type.create(table.attrs, Fragment.fromArray(rows));
        } else {
          const rows: ProseNode[] = [];
          table.forEach(row => {
            if (state.from >= row.childCount) { rows.push(row); return; }
            const cells: ProseNode[] = [];
            row.forEach(cell => cells.push(cell));
            cells.splice(Math.min(to, cells.length - 1), 0, cells.splice(state.from, 1)[0]);
            rows.push(row.type.create(row.attrs, Fragment.fromArray(cells), row.marks));
          });
          next = table.type.create(table.attrs, Fragment.fromArray(rows));
        }
        const tr = view.state.tr.replaceWith(state.tablePos, state.tablePos + table.nodeSize, next);
        const row = state.kind === "row" ? to : 0;
        const column = state.kind === "row" ? Math.min(state.caretColumn, next.child(to).childCount - 1) : Math.min(to, next.child(0).childCount - 1);
        tr.setSelection(Selection.near(tr.doc.resolve(cellPosAt(next, state.tablePos, row, column) + 1)));
        view.dispatch(closeHistory(tr).scrollIntoView());
        hovered = null;
        settle(view);
      }

      function endDrag(finish: boolean) {
        const state = drag;
        if (!state) return;
        document.removeEventListener("pointermove", onDragMove, true);
        document.removeEventListener("pointerup", onDragUp, true);
        document.removeEventListener("pointercancel", onDragCancel, true);
        document.removeEventListener("keydown", onDragKey, true);
        clearDragVisuals();
        drag = null;
        if (!state.active) return;
        // The click that follows this release belongs to the drag, not to the grip's menu.
        suppressClick = true;
        setTimeout(() => { suppressClick = false; }, 0);
        const inPlace = state.boundary === null || state.boundary === state.from || state.boundary === state.from + 1;
        if (finish && !state.cancelled && !inPlace && view.state.doc === state.doc) moveTo(state, state.boundary!);
        if (!destroyed) position();
      }
      function onDragMove(event: PointerEvent) {
        const state = drag;
        if (!state) return;
        if (!state.active) {
          if (Math.hypot(event.clientX - state.startX, event.clientY - state.startY) < DRAG_THRESHOLD) return;
          state.active = true;
          closeMenu();
          document.body.classList.add("kh-block-is-dragging");
          const table = view.state.doc.nodeAt(state.tablePos);
          if (table) {
            if (state.kind === "row") {
              let offset = 0;
              for (let index = 0; index < state.from; index++) offset += table.child(index).nodeSize;
              const dom = view.nodeDOM(state.tablePos + 1 + offset) as HTMLElement | null;
              if (dom) state.marked.push(dom);
            } else {
              for (let index = 0; index < table.childCount; index++) {
                if (state.from >= table.child(index).childCount) continue;
                const dom = view.nodeDOM(cellPosAt(table, state.tablePos, index, state.from)) as HTMLElement | null;
                if (dom) state.marked.push(dom);
              }
            }
            for (const element of state.marked) element.classList.add("kh-table-drag-source");
          }
        }
        if (state.cancelled) return;
        event.preventDefault();
        const at = boundaryAt(state, event.clientX, event.clientY);
        const inPlace = !at || at.boundary === state.from || at.boundary === state.from + 1;
        state.boundary = at?.boundary ?? null;
        if (!at || inPlace) { dropLine.hidden = true; return; }
        dropLine.classList.toggle("kh-table-drop-line-column", state.kind === "column");
        dropLine.style.left = `${at.line.left}px`; dropLine.style.top = `${at.line.top}px`;
        dropLine.style.width = `${at.line.width}px`; dropLine.style.height = state.kind === "column" ? `${at.line.height}px` : "";
        dropLine.hidden = false;
      }
      function onDragUp() { endDrag(true); }
      function onDragCancel() { endDrag(false); }
      function onDragKey(event: KeyboardEvent) {
        if (event.key !== "Escape" || !drag?.active) return;
        event.preventDefault(); event.stopPropagation();
        cancelDrag();
      }
      function startDrag(kind: "row" | "column", event: PointerEvent) {
        if (event.button !== 0 || !view.editable || drag) return;
        const target = targetCell();
        // The header row stays the header: its grip opens a menu and nothing more.
        if (!target || (kind === "row" && target.row === 0)) return;
        drag = {
          kind, tablePos: target.tablePos, from: kind === "row" ? target.row : target.column, caretColumn: target.column,
          startX: event.clientX, startY: event.clientY, active: false, cancelled: false, boundary: null, doc: view.state.doc, marked: [],
        };
        document.addEventListener("pointermove", onDragMove, true);
        document.addEventListener("pointerup", onDragUp, true);
        document.addEventListener("pointercancel", onDragCancel, true);
        document.addEventListener("keydown", onDragKey, true);
      }

      function toggle(grip: HTMLButtonElement, kind: "row" | "column") {
        if (menuGrip === grip) { closeMenu(); view.focus(); } else { closeMenu(); openMenu(grip, kind); }
      }
      const gripListeners: Array<() => void> = [];
      for (const [grip, kind] of [[rowGrip, "row"], [colGrip, "column"]] as const) {
        const onClick = () => { if (suppressClick) { suppressClick = false; return; } toggle(grip, kind); };
        const onPointerDown = (event: PointerEvent) => startDrag(kind, event);
        const onDown = (event: MouseEvent) => { if (event.button === 0) event.preventDefault(); };
        const onKey = (event: KeyboardEvent) => {
          if (event.key === "ArrowDown" && menuGrip !== grip) { event.preventDefault(); closeMenu(); openMenu(grip, kind); }
          else if (event.key === "Escape") { event.preventDefault(); closeMenu(); view.focus(); }
        };
        const onEnter = () => { pointerInside = true; };
        grip.addEventListener("click", onClick); grip.addEventListener("mousedown", onDown);
        grip.addEventListener("keydown", onKey); grip.addEventListener("pointerenter", onEnter);
        grip.addEventListener("pointerdown", onPointerDown);
        gripListeners.push(() => {
          grip.removeEventListener("pointerdown", onPointerDown); grip.removeEventListener("click", onClick); grip.removeEventListener("mousedown", onDown);
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
        const entries = [...menu.querySelectorAll<HTMLElement>("[role^=menuitem]:not(:disabled)")];
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
        const hideAll = () => {
          for (const control of controls) control.hidden = true;
          if (!menu.hidden) { const hadFocus = menu.contains(document.activeElement); closeMenu(); if (hadFocus && view.editable) view.focus(); }
        };
        if (!view.editable) { hideAll(); return; }
        const target = targetCell();
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
        // What the reader can see: the document pane (it clips what hangs outside it) within the viewport.
        const pane = tableDom.closest(".kh-document-pane")?.getBoundingClientRect();
        const bounds = {
          left: Math.max(0, pane?.left ?? 0), top: Math.max(0, pane?.top ?? 0),
          right: Math.min(window.innerWidth, pane?.right ?? window.innerWidth), bottom: Math.min(window.innerHeight, pane?.bottom ?? window.innerHeight),
        };
        const boundsRect = new DOMRect(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top);
        const rowDom = view.nodeDOM(target.tablePos + 1 + rowOffset(target)) as HTMLElement | null;
        const cellDom = view.nodeDOM(target.cellPos) as HTMLElement | null;
        const tableRect = tableDom.getBoundingClientRect();
        const rowRect = (rowDom ?? tableDom).getBoundingClientRect();
        const cellRect = (cellDom ?? tableDom).getBoundingClientRect();
        const editorRect = view.dom.getBoundingClientRect();
        const gutterWidth = Number.parseFloat(getComputedStyle(view.dom).paddingLeft) || 56;
        const gone = outside(tableRect, boundsRect);
        // The table's own scrolling box clips a column scrolled sideways; the pane and viewport clip the rest.
        const clip = {
          left: Math.max(tableRect.left, bounds.left), right: Math.min(tableRect.right, bounds.right),
          top: Math.max(tableRect.top, bounds.top), bottom: Math.min(tableRect.bottom, bounds.bottom),
        };
        // Row grip: level with its row in the editor's gutter, but never up in the block gutter's buttons (24px, at the table's top).
        const rowLeft = Math.max(editorRect.left + (gutterWidth - 24) / 2, bounds.left + 4);
        const gutterBottom = tableRect.top + 24 + 4;
        let rowTop = Math.max(rowRect.top + rowRect.height / 2 - 12, gutterBottom);
        let rowLimit = clip.bottom;
        if (rowTop < clip.top || rowTop + 24 > clip.bottom) {
          // When the usual position is clipped, use the visible part of the target row.
          const visibleTop = Math.max(rowRect.top, clip.top, gutterBottom);
          rowLimit = Math.min(rowRect.bottom, clip.bottom);
          rowTop = Math.max(visibleTop, (visibleTop + rowLimit) / 2 - 12);
        }
        rowGrip.hidden = gone || rowRect.bottom < clip.top || rowRect.top > clip.bottom || rowTop + 24 > rowLimit;
        rowGrip.style.left = `${rowLeft}px`;
        rowGrip.style.top = `${rowTop}px`;
        // Column grip: a low handle across the table's top border, half of it in the table's own top margin, which holds no text.
        const colCentre = cellRect.left + cellRect.width / 2;
        const colTop = tableRect.top - 6;
        colGrip.hidden = gone || colCentre < clip.left || colCentre > clip.right || tableRect.top < bounds.top || tableRect.top + 6 > bounds.bottom;
        colGrip.style.left = `${colCentre - 12}px`;
        colGrip.style.top = `${colTop}px`;
        // The bars span the table's visible box, in the strip directly below and directly right of it, kept inside the pane.
        const barLeft = clip.left, barWidth = Math.max(0, clip.right - clip.left);
        const barTop = clip.top, barHeight = Math.max(0, clip.bottom - clip.top);
        const roomBelow = bounds.bottom - tableRect.bottom;
        const roomRight = bounds.right - tableRect.right;
        addRowBar.hidden = gone || roomBelow <= 0;
        addColumnBar.hidden = gone || roomRight <= 0;
        addRowBar.style.left = `${barLeft}px`;
        addRowBar.style.top = `${tableRect.bottom}px`;
        addRowBar.style.maxHeight = `${Math.max(0, roomBelow)}px`;
        addRowBar.style.width = `${barWidth}px`;
        addColumnBar.style.left = `${tableRect.right}px`;
        addColumnBar.style.maxWidth = `${Math.max(0, roomRight)}px`;
        addColumnBar.style.top = `${barTop}px`;
        addColumnBar.style.height = `${barHeight}px`;
        if (!menu.hidden && menuGrip) {
          if (menuGrip.hidden) { const hadFocus = menu.contains(document.activeElement); closeMenu(); if (hadFocus) view.focus(); }
          else placeMenu();
        }
      }
      function rowOffset(target: CellLocation) {
        let offset = 0;
        for (let index = 0; index < target.row; index++) offset += target.table.child(index).nodeSize;
        return offset;
      }

      const onPointerMove = (event: PointerEvent) => {
        pointerInside = true;
        if (drag?.active) return;
        const hit = event.target as HTMLElement | null;
        const cell = hit?.closest?.("td, th");
        if (!cell || !view.dom.contains(cell)) {
          // Over another block (not the editor's own gutter, which lies between a row and its grip), the pointer has left the table.
          if (hovered !== null && menu.hidden && hit && hit !== view.dom && view.dom.contains(hit) && !hit.closest?.(".kh-markdown-table")) { hovered = null; position(); }
          return;
        }
        let pos: number;
        try { pos = view.posAtDOM(cell, 0); } catch { return; }
        const located = locateCell(view.state.doc, pos);
        if (!located) return;
        const next = located.cellPos;
        if (next !== hovered && menu.hidden) { hovered = next; position(); }
      };
      const onPointerLeave = (event: PointerEvent) => {
        const to = event.relatedTarget as Node | null;
        if (inControls(to) || (to as Element | null)?.closest?.(".kh-block-gutter")) return;
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
      focusRowGrip = () => { hovered = null; position(); if (rowGrip.hidden) return false; rowGrip.focus(); return document.activeElement === rowGrip; };
      position();
      return {
        update(updated: EditorView, previous: EditorState) {
          // A hovered cell is a position in the old document; once the document or the caret moves, the caret rules.
          if (hovered !== null && (previous.doc !== updated.state.doc || !previous.selection.eq(updated.state.selection))) hovered = null;
          if (previous.doc !== updated.state.doc) closeMenu();
          if (drag?.active && (updated.state.doc !== drag.doc || !updated.editable)) cancelDrag();
          position();
        },
        destroy() {
          destroyed = true;
          focusRowGrip = undefined;
          endDrag(false);
          dropLine.remove();
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
