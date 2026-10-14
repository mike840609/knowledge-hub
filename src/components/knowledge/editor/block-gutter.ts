import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet, type EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { insertBlockBelow, moveBlock, topLevelBlocks } from "./block-actions";

function icon(kind: "plus" | "grip"): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("width", "16"); svg.setAttribute("height", "16"); svg.setAttribute("aria-hidden", "true");
  if (kind === "plus") {
    const path = document.createElementNS(svg.namespaceURI, "path");
    path.setAttribute("d", "M12 5v14M5 12h14"); path.setAttribute("stroke", "currentColor"); path.setAttribute("stroke-width", "2"); path.setAttribute("stroke-linecap", "round"); svg.appendChild(path);
  } else {
    for (const x of [9, 15]) for (const y of [5, 12, 19]) {
      const dot = document.createElementNS(svg.namespaceURI, "circle"); dot.setAttribute("cx", String(x)); dot.setAttribute("cy", String(y)); dot.setAttribute("r", "1.5"); dot.setAttribute("fill", "currentColor"); svg.appendChild(dot);
    }
  }
  return svg;
}

/** A single floating gutter for this editor; controls are never children of the editable document. */
export function blockGutter() {
  const dragKey = new PluginKey<number | null>("khDraggedBlock");
  let focusControls: (() => boolean) | undefined;
  return $prose(() => new Plugin<number | null>({
    key: dragKey,
    state: {
      init: () => null,
      apply(transaction, previous) {
        const position = transaction.getMeta(dragKey) as number | null | undefined;
        return position !== undefined ? position : transaction.docChanged ? null : previous;
      },
    },
    props: {
      decorations(state) {
        const pos = dragKey.getState(state);
        if (pos == null) return null;
        const node = state.doc.nodeAt(pos);
        return node ? DecorationSet.create(state.doc, [Decoration.node(pos, pos + node.nodeSize, { class: "kh-block-drag-source" })]) : null;
      },
      attributes: { class: "kh-editor-blocks", "aria-keyshortcuts": "Alt+F10", "aria-description": "Press Alt+F10 for block actions." },
      handleKeyDown(_view, event) {
        if (event.key === "F10" && event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.isComposing) {
          const handled = focusControls?.() ?? false;
          if (handled) event.stopPropagation();
          return handled;
        }
        return false;
      },
    },
    view(view: EditorView) {
      const dom = view.dom;
      const toolbar = document.createElement("div"); toolbar.className = "kh-block-gutter"; toolbar.hidden = true; toolbar.setAttribute("role", "group"); toolbar.setAttribute("aria-label", "Block actions");
      const add = document.createElement("button"); add.type = "button"; add.setAttribute("aria-label", "Add paragraph below"); add.title = "Add paragraph below (Alt+F10 for block actions)"; add.appendChild(icon("plus"));
      const grip = document.createElement("button"); grip.type = "button"; grip.draggable = true; grip.setAttribute("aria-label", "Move block"); grip.title = "Drag to move. Click for move options."; grip.setAttribute("aria-haspopup", "menu"); grip.setAttribute("aria-expanded", "false"); grip.appendChild(icon("grip"));
      toolbar.append(add, grip);
      const menu = document.createElement("div"); menu.className = "kh-block-move-menu"; menu.hidden = true; menu.setAttribute("role", "menu"); menu.setAttribute("aria-label", "Move block");
      const up = document.createElement("button"); up.type = "button"; up.setAttribute("role", "menuitem"); up.textContent = "Move up";
      const down = document.createElement("button"); down.type = "button"; down.setAttribute("role", "menuitem"); down.textContent = "Move down";
      menu.append(up, down);
      const line = document.createElement("div"); line.className = "kh-block-drop-line"; line.hidden = true; line.setAttribute("aria-hidden", "true");
      const live = document.createElement("div"); live.className = "sr-only"; live.setAttribute("aria-live", "polite");
      document.body.append(toolbar, menu, line, live);
      let active: number | null = null;
      let dragging: { from: number; doc: typeof view.state.doc } | null = null;
      let dropAt: number | null = null;
      let frame = 0;
      let pointerY = 0;
      let destroyed = false;
      const blockElement = (pos: number) => view.nodeDOM(pos) as HTMLElement | null;
      function closeMenu() { menu.hidden = true; grip.setAttribute("aria-expanded", "false"); }
      function hide() { cancelAnimationFrame(frame); frame = 0; toolbar.hidden = true; closeMenu(); }
      function cancelDrag() {
        dragging = null; dropAt = null; line.hidden = true; dom.classList.remove("kh-block-is-dragging");
        if (!destroyed && dragKey.getState(view.state) != null) view.dispatch(view.state.tr.setMeta(dragKey, null));
      }
      function selectedBlock() {
        const { $from } = view.state.selection;
        return $from.depth > 0 ? $from.before(1) : $from.pos;
      }
      function position() {
        if (!view.editable || active === null) { hide(); return; }
        const element = blockElement(active);
        if (!element) { hide(); return; }
        const rect = element.getBoundingClientRect();
        const editorRect = dom.getBoundingClientRect();
        const scroller = dom.closest(".kh-document-pane")?.getBoundingClientRect();
        if (rect.top < Math.max(0, scroller?.top ?? 0) || rect.top > Math.min(window.innerHeight, scroller?.bottom ?? window.innerHeight) - 24) { hide(); return; }
        // The gutter hangs left of the text and may run past the pane, which clips it; the controls stay inside.
        const left = Math.max(Math.max(0, scroller?.left ?? 0) + 4, editorRect.left + 4);
        toolbar.style.left = `${left}px`;
        toolbar.style.top = `${rect.top}px`;
        toolbar.hidden = false;
        if (!menu.hidden) {
          menu.style.left = `${Math.min(Math.max(8, left), window.innerWidth - menu.offsetWidth - 8)}px`;
          menu.style.top = `${Math.max(8, Math.min(rect.top + 28, window.innerHeight - menu.offsetHeight - 8))}px`;
        }
      }
      function pointAt(y: number) {
        const blocks = topLevelBlocks(view.state.doc);
        let closest = blocks[0]?.pos ?? null;
        let distance = Infinity;
        for (const block of blocks) {
          const rect = blockElement(block.pos)?.getBoundingClientRect();
          if (!rect) continue;
          const delta = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
          if (delta < distance) { closest = block.pos; distance = delta; }
          if (delta === 0) break;
        }
        return closest;
      }
      focusControls = () => {
        if (!view.editable) return false;
        cancelAnimationFrame(frame); frame = 0;
        active = selectedBlock();
        blockElement(active)?.scrollIntoView?.({ block: "nearest" });
        position();
        if (toolbar.hidden) return false;
        add.focus();
        return true;
      };
      toolbar.addEventListener("keydown", event => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeMenu(); view.focus(); }
      });
      const hover = (event: MouseEvent) => {
        if (dragging || !menu.hidden || !view.editable) return;
        const rect = dom.getBoundingClientRect();
        const gutterWidth = Number.parseFloat(getComputedStyle(dom).paddingLeft) || 56;
        if (event.clientX < rect.left || event.clientX >= rect.left + gutterWidth) {
          if (!toolbar.contains(document.activeElement)) hide();
          return;
        }
        pointerY = event.clientY;
        if (!frame) frame = requestAnimationFrame(() => { frame = 0; if (!destroyed) { active = pointAt(pointerY); position(); } });
      };
      const leave = (event: MouseEvent) => {
        if (event.relatedTarget instanceof Node && (toolbar.contains(event.relatedTarget) || menu.contains(event.relatedTarget))) return;
        if (menu.hidden && !dragging && !toolbar.contains(document.activeElement)) hide();
      };
      const usesTouch = () => window.matchMedia?.("(hover: none) and (pointer: coarse)").matches ?? false;
      const focus = () => { active = selectedBlock(); if (usesTouch()) position(); else hide(); };
      const blur = (event: FocusEvent) => {
        if (event.relatedTarget instanceof Node && (toolbar.contains(event.relatedTarget) || menu.contains(event.relatedTarget))) return;
        hide();
      };
      add.addEventListener("mousedown", event => { if (event.button === 0) event.preventDefault(); });
      add.addEventListener("click", () => { if (active !== null) insertBlockBelow(view, active); });
      function moveBy(direction: number) {
        if (active === null) return;
        const blocks = topLevelBlocks(view.state.doc);
        const index = blocks.findIndex(block => block.pos === active);
        if (index < 0 || index + direction < 0 || index + direction >= blocks.length) return;
        const before = direction < 0 ? blocks[index - 1].pos : blocks[index + 1].pos + blocks[index + 1].node.nodeSize;
        closeMenu();
        if (moveBlock(view, active, before)) live.textContent = direction < 0 ? "Block moved up" : "Block moved down";
      }
      grip.addEventListener("click", () => {
        if (!menu.hidden) { closeMenu(); return; }
        const blocks = topLevelBlocks(view.state.doc);
        const index = blocks.findIndex(block => block.pos === active);
        up.disabled = index <= 0; down.disabled = index < 0 || index === blocks.length - 1;
        menu.hidden = false; grip.setAttribute("aria-expanded", "true"); position();
        (up.disabled ? down : up).focus();
      });
      grip.addEventListener("keydown", event => {
        if (event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault(); moveBy(event.key === "ArrowUp" ? -1 : 1); }
      });
      up.addEventListener("click", () => moveBy(-1)); down.addEventListener("click", () => moveBy(1));
      menu.addEventListener("keydown", event => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeMenu(); grip.focus(); }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); const next = document.activeElement === up ? down : up; if (!next.disabled) next.focus(); }
        if (event.key === "Tab") { event.preventDefault(); closeMenu(); view.focus(); }
      });
      const outside = (event: PointerEvent) => { if (event.target instanceof Node && !toolbar.contains(event.target) && !menu.contains(event.target)) closeMenu(); };
      grip.addEventListener("dragstart", event => {
        if (!view.editable || active === null || !event.dataTransfer) { event.preventDefault(); return; }
        closeMenu(); dragging = { from: active, doc: view.state.doc };
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("application/x-kh-editor-block", String(active));
        view.dispatch(view.state.tr.setMeta(dragKey, active));
        const element = blockElement(active);
        if (element) {
          event.dataTransfer.setDragImage(element, 0, 0);
        }
        dom.classList.add("kh-block-is-dragging");
      });
      const dragOver = (event: DragEvent) => {
        if (!dragging) return;
        const rect = dom.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) { dropAt = null; line.hidden = true; return; }
        event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
        const blocks = topLevelBlocks(view.state.doc);
        let target = view.state.doc.content.size;
        let y = blockElement(blocks[blocks.length - 1].pos)!.getBoundingClientRect().bottom;
        for (const block of blocks) {
          const box = blockElement(block.pos)!.getBoundingClientRect();
          if (event.clientY < (box.top + box.bottom) / 2) { target = block.pos; y = box.top; break; }
        }
        dropAt = target;
        const gutterWidth = Number.parseFloat(getComputedStyle(dom).paddingLeft) || 56;
        line.style.left = `${rect.left + gutterWidth}px`; line.style.width = `${Math.max(0, rect.width - gutterWidth)}px`; line.style.top = `${y}px`; line.hidden = false;
        const pane = dom.closest<HTMLElement>(".kh-document-pane");
        if (pane) { const box = pane.getBoundingClientRect(); if (event.clientY < box.top + 40) pane.scrollBy(0, -16); else if (event.clientY > box.bottom - 40) pane.scrollBy(0, 16); }
      };
      const drop = (event: DragEvent) => {
        if (!dragging) return;
        const source = dragging;
        const rect = dom.getBoundingClientRect();
        const target = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom ? dropAt : null;
        event.preventDefault(); event.stopPropagation(); cancelDrag();
        if (target !== null && view.state.doc === source.doc && moveBlock(view, source.from, target)) live.textContent = "Block moved";
      };
      const dragLeave = (event: DragEvent) => { if (!event.relatedTarget) { dropAt = null; line.hidden = true; } };
      dom.addEventListener("mousemove", hover); dom.addEventListener("mouseleave", leave); toolbar.addEventListener("mouseleave", leave);
      dom.addEventListener("focus", focus); dom.addEventListener("blur", blur);
      document.addEventListener("pointerdown", outside);
      document.addEventListener("dragover", dragOver, true); document.addEventListener("drop", drop, true); document.addEventListener("dragend", cancelDrag); document.addEventListener("dragleave", dragLeave);
      const reposition = () => { if (!toolbar.hidden) position(); };
      window.addEventListener("scroll", reposition, true); window.addEventListener("resize", reposition);
      return { update(_view, previous) {
        if (dragging && view.state.doc !== dragging.doc) cancelDrag();
        if (!view.editable) { cancelDrag(); hide(); return; }
        if (!view.state.doc.eq(previous.doc) || !view.state.selection.eq(previous.selection)) active = selectedBlock();
        if (!toolbar.hidden || (usesTouch() && view.hasFocus())) position();
      }, destroy() {
        destroyed = true; focusControls = undefined; cancelAnimationFrame(frame); cancelDrag(); toolbar.remove(); menu.remove(); line.remove(); live.remove();
        dom.removeEventListener("mousemove", hover); dom.removeEventListener("mouseleave", leave); dom.removeEventListener("focus", focus); dom.removeEventListener("blur", blur);
        document.removeEventListener("pointerdown", outside); document.removeEventListener("dragover", dragOver, true); document.removeEventListener("drop", drop, true); document.removeEventListener("dragend", cancelDrag); document.removeEventListener("dragleave", dragLeave);
        window.removeEventListener("scroll", reposition, true); window.removeEventListener("resize", reposition);
      } };
    },
  }));
}
