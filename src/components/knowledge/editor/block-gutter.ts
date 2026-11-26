import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet, type EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { isInTable } from "@milkdown/kit/prose/tables";
import { HeadingSlugger } from "@/shared/markdown/heading-slug";
import { isBlockId } from "@/shared/markdown/remark-block-links";
import { closeHistory } from "@milkdown/kit/prose/history";
import { openBlockList } from "./slash-commands";
import { blockKind, canTurnInto, headingText, deleteBlock, dispatchBlockAction, duplicateBlock, insertBlockBelow, moveBlock, selectedBlockPos, siblingBlocks, topLevelBlocks, turnBlockInto, type BlockKind, type EditorBlock } from "./block-actions";
import { extendRangeTo, keepRange, rangeBlocks, setBlockRange } from "./block-range";
import { deleteBlocks, duplicateBlocks, moveBlocks, sequenceOf, turnBlocks } from "./block-sequence";

export function icon(kind: "plus" | "grip"): SVGSVGElement {
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
/**
 * The `id` the reader gives the heading at `pos`: slugs are handed out in reading order across the whole document
 * (`HeadingSlugger`, the one place they are assigned), so a repeated title gets the same `-1` here as there.
 */
export function headingSlugAt(view: EditorView, pos: number): string | null {
  const slugger = new HeadingSlugger();
  let found: string | null = null;
  view.state.doc.descendants((node, at) => {
    if (node.type.name === "heading") {
      const slug = slugger.slug(headingText(node));
      if (at === pos) found = slug;
      return false;
    }
    return found === null;
  });
  return found;
}

/**
 * Whether the pane leaves the gutter room (2026-11-21 block-unit spec, decision 7): at least 56px between the editor's
 * text left edge and the left edge of its nearest clipping ancestor (the viewport's, 0, where none clips).
 */
export function gutterFits(dom: HTMLElement): boolean {
  let clipLeft = 0;
  for (let node = dom.parentElement; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowX;
    if (overflow && overflow !== "visible") { clipLeft = node.getBoundingClientRect().left; break; }
  }
  const textLeft = dom.getBoundingClientRect().left + (Number.parseFloat(getComputedStyle(dom).paddingLeft) || 0);
  return textLeft - clipLeft >= 56;
}

/** Turn into's entries, in order: the grip menu's and the selection toolbar's (2026-11-21 list-commands spec, decision 5). */
export const TURN_OPTIONS: readonly [BlockKind, string][] = [
  ["paragraph", "Text"],
  ["h1", "Heading 1"],
  ["h2", "Heading 2"],
  ["h3", "Heading 3"],
  ["bullet", "Bulleted list"],
  ["ordered", "Numbered list"],
  ["task", "To-do list"],
  ["quote", "Quote"],
  ["code", "Code"],
  ["toggle", "Toggle"],
  ["callout", "Callout"],
];

/**
 * One Turn into entry for `blocks`, in both menus: checked when every block already is `kind`; enabled where every
 * block can take it, a block already of that kind taking it as it is; disabled when every block already is it.
 */
export function turnEntry(blocks: readonly EditorBlock[], kind: BlockKind): { checked: boolean; disabled: boolean } {
  const checked = blocks.length > 0 && blocks.every((block) => blockKind(block.node) === kind);
  const disabled = !blocks.length || checked || !blocks.every((block) => blockKind(block.node) === kind || canTurnInto(block.node, kind));
  return { checked, disabled };
}

export function blockGutter(comment?: { available: (view: EditorView, pos: number) => boolean; run: (view: EditorView, pos: number) => void }, linkTo?: () => string | undefined) {
  // The blocks being dragged: one, or every block of the range (2026-11-21 block-unit spec, decision 6).
  const dragKey = new PluginKey<number[] | null>("khDraggedBlock");
  let focusControls: (() => boolean) | undefined;
  return $prose(() => new Plugin<number[] | null>({
    key: dragKey,
    state: {
      init: () => null,
      apply(transaction, previous) {
        const positions = transaction.getMeta(dragKey) as number[] | null | undefined;
        return positions !== undefined ? positions : transaction.docChanged ? null : previous;
      },
    },
    props: {
      decorations(state) {
        const positions = dragKey.getState(state);
        if (!positions) return null;
        const decorations = positions.flatMap((pos) => {
          const node = state.doc.nodeAt(pos);
          return node ? [Decoration.node(pos, pos + node.nodeSize, { class: "kh-block-drag-source" })] : [];
        });
        return decorations.length ? DecorationSet.create(state.doc, decorations) : null;
      },
      attributes: { class: "kh-editor-blocks", "aria-keyshortcuts": "Alt+F10", "aria-description": "Press Alt+F10 for block actions." },
      handleKeyDown(view, event) {
        if (event.key === "F10" && event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.isComposing) {
          // In a table cell the table's own controls take Alt+F10 (the row grip), whatever the plugin order.
          if (view.editable && isInTable(view.state)) return false;
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
      const add = document.createElement("button"); add.type = "button"; add.setAttribute("aria-label", "Add block below"); add.title = "Add block below (Alt+F10 for block actions)"; add.appendChild(icon("plus"));
      const grip = document.createElement("button"); grip.type = "button"; grip.draggable = true; grip.setAttribute("aria-label", "Move block"); grip.title = "Drag to move. Click for block actions."; grip.setAttribute("aria-haspopup", "menu"); grip.setAttribute("aria-expanded", "false"); grip.appendChild(icon("grip"));
      toolbar.append(add, grip);
      const menu = document.createElement("div"); menu.className = "kh-block-move-menu"; menu.hidden = true; menu.setAttribute("role", "menu"); menu.setAttribute("aria-label", "Block actions");
      let menuMode: "main" | "turn" = "main";
      const blocksNow = () => active === null ? topLevelBlocks(view.state.doc) : siblingBlocks(view.state.doc, active);
      const activeIndex = () => blocksNow().findIndex((block) => block.pos === active);
      const activeNode = () => (active === null ? null : view.state.doc.nodeAt(active));
      /**
       * The range's blocks when the controls' block is one of them: the menu and drag then act on the range
       * (2026-11-21 block-unit spec, decision 5). Otherwise null, and they act on that block alone.
       */
      const groupNow = () => { const blocks = rangeBlocks(view.state); return blocks && blocks.some((block) => block.pos === active) ? blocks : null; };
      /** The sequence holding the block at `pos`, when it is a block of one (a whole list taken as one node is not). */
      const sequenceAt = (pos: number) => { const sequence = sequenceOf(view.state.doc, pos); return sequence.some((block) => block.pos === pos) ? sequence : null; };
      function menuButton(label: string, run: () => void): HTMLButtonElement {
        const button = document.createElement("button");
        button.type = "button"; button.setAttribute("role", "menuitem"); button.textContent = label;
        button.addEventListener("mousedown", event => { if (event.button === 0) event.preventDefault(); });
        button.addEventListener("click", run);
        return button;
      }
      function separator(): HTMLElement {
        const rule = document.createElement("div"); rule.setAttribute("role", "separator"); rule.className = "kh-block-menu-separator";
        return rule;
      }
      function renderMain(): HTMLElement {
        menuMode = "main";
        menu.replaceChildren();
        const group = groupNow();
        menu.setAttribute("aria-label", group ? `Block actions, ${group.length} blocks` : "Block actions");
        const turn = menuButton("Turn into", () => { renderTurn(); position(); focusFirst(); });
        turn.setAttribute("aria-haspopup", "menu"); turn.setAttribute("aria-expanded", "false");
        const duplicate = menuButton("Duplicate", () => {
          const blocks = groupNow();
          if (blocks) {
            if (!view.editable) return;
            const { state } = view;
            const { tr, copies } = duplicateBlocks(state, blocks);
            // The copies become the range, in its direction.
            keepRange(view, state, tr, copies);
            view.focus();
            live.textContent = `${blocks.length} blocks duplicated`;
          } else {
            if (active === null || !duplicateBlock(view, active)) return;
            live.textContent = "Block duplicated";
          }
          closeMenu();
        });
        const remove = menuButton("Delete", () => {
          const blocks = groupNow();
          if (blocks) {
            if (!view.editable) return;
            setBlockRange(view, deleteBlocks(view.state, blocks), null);
            view.focus();
            live.textContent = `${blocks.length} blocks deleted`;
          } else {
            if (active === null || !deleteBlock(view, active)) return;
            live.textContent = "Block deleted";
          }
          closeMenu();
        });
        const up = menuButton("Move up", () => moveBy(-1));
        const down = menuButton("Move down", () => moveBy(1));
        up.disabled = !canMove(-1);
        down.disabled = !canMove(1);
        const commentAction = !group && comment && active !== null && comment.available(view, active) ? menuButton("Comment", () => {
          const pos = active;
          closeMenu();
          if (pos !== null && comment.available(view, pos)) comment.run(view, pos);
        }) : null;
        const heading = !group && activeNode()?.type.name === "heading" ? menuButton("Copy link to heading", () => {
          const slug = active === null ? null : headingSlugAt(view, active);
          closeMenu();
          if (slug !== null) copyLink(window.location.pathname, slug);
        }) : null;
        const node = activeNode();
        // A read-only copy cannot mint an id, but an id the Markdown already has is still a link to copy.
        const blockLink = !group && node && Object.hasOwn(node.attrs, "blockId") && node.content.size && linkTo?.() && (isBlockId(node.attrs.blockId) || view.editable)
          ? menuButton("Copy link to block", copyBlockLink) : null;
        menu.append(turn, duplicate, remove);
        const link = heading ?? blockLink;
        if (link) menu.append(link);
        if (commentAction) menu.append(commentAction);
        menu.append(separator(), up, down);
        return turn;
      }
      function copyLink(path: string, fragment: string): boolean {
        live.textContent = "";
        const failed = () => { live.textContent = "Couldn't copy the link"; };
        if (!navigator.clipboard) { failed(); return false; }
        const href = new URL(path, window.location.origin);
        href.hash = encodeURIComponent(fragment);
        void navigator.clipboard.writeText(href.href).then(() => { live.textContent = "Link copied"; }, failed);
        return true;
      }
      function copyBlockLink() {
        const pos = active;
        const node = activeNode();
        const path = linkTo?.();
        closeMenu();
        grip.focus();
        if (pos === null || !node || !path) return;
        if (isBlockId(node.attrs.blockId)) { copyLink(path, node.attrs.blockId); return; }
        if (!view.editable) return;
        if (!navigator.clipboard || !globalThis.crypto?.randomUUID) {
          live.textContent = "Couldn't copy the link";
          return;
        }
        const id = `kh-block-${crypto.randomUUID()}`;
        if (!copyLink(path, id)) return;
        const tr = view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, blockId: id });
        view.dispatch(closeHistory(tr));
        view.dispatch(closeHistory(view.state.tr));
      }
      function renderTurn(): void {
        menuMode = "turn";
        menu.replaceChildren();
        const group = groupNow();
        menu.setAttribute("aria-label", group ? `Turn ${group.length} blocks into` : "Turn block into");
        const node = activeNode();
        const back = menuButton("Back", () => { const first = renderMain(); position(); first.focus(); });
        back.setAttribute("aria-label", "Back to block actions");
        menu.append(back, separator());
        for (const [kind, label] of TURN_OPTIONS) {
          const button = menuButton(label, () => {
            const blocks = groupNow();
            if (blocks) {
              if (!view.editable) return;
              // One transaction for every block, one undo step; the range ends, as the turn keys end it.
              const tr = turnBlocks(view.state, blocks, kind);
              if (!tr) return;
              setBlockRange(view, tr, null);
              view.focus();
              live.textContent = `${blocks.length} blocks turned into ${label.toLowerCase()}`;
            } else {
              if (active === null || !turnBlockInto(view, active, kind)) return;
              live.textContent = `Block turned into ${label.toLowerCase()}`;
            }
            closeMenu();
          });
          // The range's blocks, or the controls' block alone: one predicate for both, shared with the selection toolbar.
          const { checked, disabled } = turnEntry(group ?? (node && active !== null ? [{ pos: active, node }] : []), kind);
          button.disabled = disabled;
          if (checked) button.setAttribute("aria-current", "true");
          menu.append(button);
        }
      }
      function focusFirst(): void {
        const first = menu.querySelector<HTMLButtonElement>("button:not(:disabled)");
        first?.focus();
      }
      const line = document.createElement("div"); line.className = "kh-block-drop-line"; line.hidden = true; line.setAttribute("aria-hidden", "true");
      const live = document.createElement("div"); live.className = "sr-only"; live.setAttribute("aria-live", "polite");
      document.body.append(toolbar, menu, line, live);
      let active: number | null = null;
      // `sequence` is null for a block that is no block of a sequence (a whole list taken as one node): it moves among its siblings.
      let dragging: { blocks: EditorBlock[]; sequence: EditorBlock[] | null; doc: typeof view.state.doc } | null = null;
      let dropAt: number | null = null;
      let frame = 0;
      let destroyed = false;
      let restoringClippedFocus = false;
      const pane = dom.closest(".kh-document-pane");
      const column = dom.closest<HTMLElement>(".kh-reading-column");
      const boxKey = (rect: DOMRect) => `${rect.left}:${rect.width}`;
      const layoutKey = (editorRect: DOMRect, scroller?: DOMRect) => `${boxKey(editorRect)}:${scroller ? boxKey(scroller) : ""}`;
      let positionedAt = "";
      const blockElement = (pos: number) => view.nodeDOM(pos) as HTMLElement | null;
      const controlsHaveFocus = () => toolbar.contains(document.activeElement) || menu.contains(document.activeElement);
      function closeMenu() { menu.hidden = true; grip.setAttribute("aria-expanded", "false"); }
      function hide() { cancelAnimationFrame(frame); frame = 0; toolbar.hidden = true; closeMenu(); }
      function cancelDrag() {
        dragging = null; dropAt = null; line.hidden = true; dom.classList.remove("kh-block-is-dragging");
        if (!destroyed && dragKey.getState(view.state) != null) view.dispatch(view.state.tr.setMeta(dragKey, null));
      }
      function selectedBlock() {
        const chosen = selectedBlockPos(view.state);
        if (chosen !== null) return chosen;
        const { $from } = view.state.selection;
        // The nearest list item under the caret is the block a writer is pointing at; otherwise
        // the top-level block, as before.
        for (let depth = $from.depth; depth >= 1; depth--) {
          if ($from.node(depth).type.name === "list_item") return $from.before(depth);
        }
        return $from.depth > 0 ? $from.before(1) : $from.pos;
      }
      function position(editorBox?: DOMRect) {
        if (!view.editable || active === null) { hide(); return; }
        const element = blockElement(active);
        if (!element) { hide(); return; }
        const rect = element.getBoundingClientRect();
        const editorRect = editorBox ?? dom.getBoundingClientRect();
        const scroller = pane?.getBoundingClientRect();
        if (rect.top < Math.max(0, scroller?.top ?? 0) || rect.top > Math.min(window.innerHeight, scroller?.bottom ?? window.innerHeight) - 24) {
          const restore = controlsHaveFocus();
          hide();
          if (restore) {
            // ProseMirror restores the caret without scrolling. A coarse pointer must not reopen the clipped controls.
            restoringClippedFocus = true;
            try { view.focus(); } finally { restoringClippedFocus = false; }
          }
          return;
        }
        // The gutter hangs left of the text and may run past the pane, which clips it; the controls stay inside.
        const left = Math.max(Math.max(0, scroller?.left ?? 0) + 4, editorRect.left + 4);
        positionedAt = layoutKey(editorRect, scroller);
        toolbar.style.left = `${left}px`;
        toolbar.style.top = `${rect.top}px`;
        toolbar.hidden = false;
        if (!menu.hidden) {
          menu.style.left = `${Math.min(Math.max(8, left), window.innerWidth - menu.offsetWidth - 8)}px`;
          menu.style.top = `${Math.max(8, Math.min(rect.top + 28, window.innerHeight - menu.offsetHeight - 8))}px`;
        }
      }
      function pointAt(y: number, editorRect: DOMRect) {
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
        // A pointer over a list item is over that item, not over the whole list. Layout answers
        // this where there is layout; jsdom (and a detached editor) has none, so the top-level
        // block above stays the answer there.
        try {
          const gutterWidth = Number.parseFloat(getComputedStyle(dom).paddingLeft) || 56;
          const at = view.posAtCoords({ left: editorRect.left + gutterWidth + 4, top: y });
          if (at) {
            const $at = view.state.doc.resolve(at.pos);
            for (let depth = $at.depth; depth >= 1; depth--) {
              if ($at.node(depth).type.name === "list_item") return $at.before(depth);
            }
          }
        } catch { /* no layout to ask */ }
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
      // Typing, or a button held for a selection, keeps the controls hidden until the pointer moves / is released.
      let typed = false;
      let held = false;
      let fits: boolean | null = null;
      let fitAt = "";
      let lastX = 0;
      let lastY = 0;
      function inHoverTrigger(x: number, rect: DOMRect) {
        // Anywhere on the block's line when the pane gives the gutter room; otherwise the gutter alone. The room is
        // re-measured when the editor's box moves or resizes, and after a window resize or scroll, not on every move
        // (it reads computed styles up the tree).
        const boxAt = boxKey(rect);
        if (fits === null || boxAt !== fitAt) {
          fitAt = boxAt;
          fits = gutterFits(dom);
        }
        if (x < rect.left) return false;
        if (fits) return x < rect.right;
        const gutterWidth = Number.parseFloat(getComputedStyle(dom).paddingLeft) || 56;
        return x < rect.left + gutterWidth;
      }
      const showHoveredBlock = () => {
        frame = 0;
        if (destroyed || dragging || !menu.hidden || !view.editable || held || typed) return;
        const rect = dom.getBoundingClientRect();
        // Layout may change after mousemove, before the frame and before ResizeObserver notices.
        if (!inHoverTrigger(lastX, rect)) {
          if (!controlsHaveFocus() && !(usesTouch() && view.hasFocus())) hide();
          return;
        }
        active = pointAt(lastY, rect);
        position(rect);
      };
      const hover = (event: MouseEvent) => {
        const moved = event.clientX !== lastX || event.clientY !== lastY;
        lastX = event.clientX; lastY = event.clientY;
        if (typed && moved) typed = false;
        if (dragging || !menu.hidden || !view.editable) return;
        if (held || typed || !inHoverTrigger(lastX, dom.getBoundingClientRect())) {
          if (!controlsHaveFocus()) hide();
          return;
        }
        if (!frame) frame = requestAnimationFrame(showHoveredBlock);
      };
      const keydown = (event: KeyboardEvent) => {
        if (["Shift", "Control", "Alt", "Meta"].includes(event.key) || !menu.hidden) return;
        typed = true;
        if (!toolbar.contains(document.activeElement)) hide();
      };
      const mousedown = () => { held = true; if (!toolbar.contains(document.activeElement)) hide(); };
      // A native drag of selected text ends with dragend or drop, never mouseup: either one lets go too.
      const release = () => { held = false; };
      const leave = (event: MouseEvent) => {
        if (event.relatedTarget instanceof Node && (toolbar.contains(event.relatedTarget) || menu.contains(event.relatedTarget))) return;
        if (menu.hidden && !dragging && !toolbar.contains(document.activeElement)) hide();
      };
      const usesTouch = () => window.matchMedia?.("(hover: none) and (pointer: coarse)").matches ?? false;
      const focus = () => { active = selectedBlock(); if (!restoringClippedFocus && usesTouch()) position(); else hide(); };
      const blur = (event: FocusEvent) => {
        if (event.relatedTarget instanceof Node && (toolbar.contains(event.relatedTarget) || menu.contains(event.relatedTarget))) return;
        hide();
      };
      add.addEventListener("mousedown", event => { if (event.button === 0) event.preventDefault(); });
      // As Notion's +: the new line holds a visible "/" with its list open; dismissing it with only the "/" takes it back.
      add.addEventListener("click", () => { if (active !== null && insertBlockBelow(view, active)) openBlockList(view); });
      /**
       * Moves the run `blocks` of `sequence` to `toIndex` of the sequence without them, as the keys do (2026-11-21
       * block-unit spec): a paragraph passes one item, and an item at its list's end leaves the list. A range stays
       * chosen over its new places; a single block keeps the caret in its text, as before.
       */
      function moveRun(blocks: EditorBlock[], toIndex: number) {
        if (!view.editable) return;
        const { state } = view;
        const { tr, moved } = moveBlocks(state, blocks, toIndex);
        if (blocks.length > 1) { keepRange(view, state, tr, moved); view.focus(); }
        else dispatchBlockAction(view, tr, moved[0].pos + 1);
      }
      /** The run that Move up/down would carry, and where, when the controls' block is a block of a sequence. */
      function moveTarget(direction: -1 | 1) {
        if (active === null) return null;
        const sequence = sequenceAt(active);
        if (!sequence) return null;
        const blocks = groupNow() ?? sequence.filter((block) => block.pos === active);
        const toIndex = sequence.findIndex((block) => block.pos === blocks[0].pos) + direction;
        return { blocks, toIndex, possible: toIndex >= 0 && toIndex <= sequence.length - blocks.length };
      }
      function canMove(direction: -1 | 1): boolean {
        const target = moveTarget(direction);
        if (target) return target.possible;
        const blocks = blocksNow();
        const index = activeIndex();
        return index >= 0 && index + direction >= 0 && index + direction < blocks.length;
      }
      function moveBy(direction: -1 | 1) {
        if (active === null) return;
        const target = moveTarget(direction);
        if (target) {
          if (!target.possible) return;
          closeMenu();
          moveRun(target.blocks, target.toIndex);
          live.textContent = target.blocks.length > 1 ? `${target.blocks.length} blocks moved` : direction < 0 ? "Block moved up" : "Block moved down";
          return;
        }
        const blocks = siblingBlocks(view.state.doc, active);
        const index = blocks.findIndex(block => block.pos === active);
        if (index < 0 || index + direction < 0 || index + direction >= blocks.length) return;
        const before = direction < 0 ? blocks[index - 1].pos : blocks[index + 1].pos + blocks[index + 1].node.nodeSize;
        closeMenu();
        if (moveBlock(view, active, before)) live.textContent = direction < 0 ? "Block moved up" : "Block moved down";
      }
      // The grip of a block outside the range ends the range; its menu and drag act on that block alone (decision 5).
      grip.addEventListener("mousedown", (event) => {
        if (event.shiftKey) return; // Shift-click extends the range (2026-11-26 spec), see the click below
        const range = rangeBlocks(view.state);
        if (range && !range.some((block) => block.pos === active)) setBlockRange(view, view.state.tr, null, false);
      });
      grip.addEventListener("click", (event) => {
        // Shift-click: the range runs from the chosen block (or the caret's) to this one; the menu stays shut (2026-11-26 spec).
        if (event.shiftKey && active !== null && view.editable && extendRangeTo(view, active, true)) { closeMenu(); view.focus(); return; }
        if (!menu.hidden) { closeMenu(); return; }
        renderMain();
        menu.hidden = false; grip.setAttribute("aria-expanded", "true"); position();
        focusFirst();
      });
      grip.addEventListener("keydown", event => {
        if (event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault(); moveBy(event.key === "ArrowUp" ? -1 : 1); }
      });
      menu.addEventListener("keydown", event => {
        if (event.key === "Escape") {
          event.preventDefault(); event.stopPropagation();
          if (menuMode === "turn") { const first = renderMain(); position(); first.focus(); }
          else { closeMenu(); grip.focus(); }
          return;
        }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const items = [...menu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
          if (items.length === 0) return;
          const index = items.indexOf(document.activeElement as HTMLButtonElement);
          items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
          return;
        }
        if (event.key === "Tab") { event.preventDefault(); closeMenu(); view.focus(); }
      });
      const outside = (event: PointerEvent) => { if (event.target instanceof Node && !toolbar.contains(event.target) && !menu.contains(event.target)) closeMenu(); };
      grip.addEventListener("dragstart", event => {
        if (!view.editable || active === null || !event.dataTransfer) { event.preventDefault(); return; }
        const node = view.state.doc.nodeAt(active);
        if (!node) { event.preventDefault(); return; }
        // Inside the range the grip drags the range, every block of it tinted (decision 6).
        const blocks = groupNow() ?? [{ pos: active, node }];
        closeMenu(); dragging = { blocks, sequence: sequenceAt(active), doc: view.state.doc };
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("application/x-kh-editor-block", String(active));
        view.dispatch(view.state.tr.setMeta(dragKey, blocks.map((block) => block.pos)));
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
        // The drop line stands at a boundary of the sequence (or, for a block of none, of its siblings): `dropAt` is its index.
        const blocks = dragging.sequence ?? siblingBlocks(view.state.doc, dragging.blocks[0].pos);
        const last = blocks[blocks.length - 1];
        let target = blocks.length;
        let y = last ? (blockElement(last.pos)?.getBoundingClientRect().bottom ?? 0) : 0;
        for (const [index, block] of blocks.entries()) {
          const box = blockElement(block.pos)?.getBoundingClientRect();
          if (!box) continue;
          if (event.clientY < (box.top + box.bottom) / 2) { target = index; y = box.top; break; }
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
        if (target === null || view.state.doc !== source.doc) return;
        if (source.sequence) {
          // Dropped at the sequence's boundary `target`: the place in the sequence without the dragged run, if it moves at all.
          const count = source.blocks.length;
          const first = source.sequence.findIndex((block) => block.pos === source.blocks[0].pos);
          if (target >= first && target <= first + count) return;
          moveRun(source.blocks, target > first ? target - count : target);
          live.textContent = count > 1 ? `${count} blocks moved` : "Block moved";
          return;
        }
        const siblings = siblingBlocks(view.state.doc, source.blocks[0].pos);
        const last = siblings[siblings.length - 1];
        const before = target < siblings.length ? siblings[target].pos : last ? last.pos + last.node.nodeSize : view.state.doc.content.size;
        if (moveBlock(view, source.blocks[0].pos, before)) live.textContent = "Block moved";
      };
      const dragLeave = (event: DragEvent) => { if (!event.relatedTarget) { dropAt = null; line.hidden = true; } };
      dom.addEventListener("mousemove", hover); dom.addEventListener("keydown", keydown); dom.addEventListener("mousedown", mousedown); document.addEventListener("mouseup", release); document.addEventListener("dragend", release); document.addEventListener("drop", release); dom.addEventListener("mouseleave", leave); toolbar.addEventListener("mouseleave", leave);
      dom.addEventListener("focus", focus); dom.addEventListener("blur", blur);
      document.addEventListener("pointerdown", outside);
      document.addEventListener("dragover", dragOver, true); document.addEventListener("drop", drop, true); document.addEventListener("dragend", cancelDrag); document.addEventListener("dragleave", dragLeave);
      const reposition = () => { fits = null; if (!toolbar.hidden) position(); };
      window.addEventListener("scroll", reposition, true); window.addEventListener("resize", reposition);
      const layoutChanged = () => {
        fits = null;
        if (toolbar.hidden) return;
        const changed = positionedAt !== layoutKey(dom.getBoundingClientRect(), pane?.getBoundingClientRect());
        // Clear stale hover controls while keeping the menu and controls reached by keyboard or touch available.
        if (changed && menu.hidden && !toolbar.contains(document.activeElement) && !(usesTouch() && view.hasFocus())) hide();
        else position();
      };
      // The inspector can resize the pane without resizing the window or the capped reading column.
      const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(layoutChanged);
      resizeObserver?.observe(dom);
      if (pane) resizeObserver?.observe(pane);
      // The column's animated start margin and padding can move it again without changing either observed size.
      const columnSettled = (event: TransitionEvent) => {
        if (event.target === column && /^(margin|padding)-(inline-start|left|right)$/.test(event.propertyName)) layoutChanged();
      };
      column?.addEventListener("transitionend", columnSettled);
      return { update(_view, previous) {
        if (dragging && view.state.doc !== dragging.doc) cancelDrag();
        if (!view.editable) { cancelDrag(); hide(); return; }
        if (!view.state.doc.eq(previous.doc) || !view.state.selection.eq(previous.selection)) active = selectedBlock();
        if (!toolbar.hidden || (usesTouch() && view.hasFocus())) position();
      }, destroy() {
        destroyed = true; focusControls = undefined; cancelAnimationFrame(frame); cancelDrag(); toolbar.remove(); menu.remove(); line.remove(); live.remove();
        dom.removeEventListener("mousemove", hover); dom.removeEventListener("keydown", keydown); dom.removeEventListener("mousedown", mousedown); document.removeEventListener("mouseup", release); document.removeEventListener("dragend", release); document.removeEventListener("drop", release); dom.removeEventListener("mouseleave", leave); dom.removeEventListener("focus", focus); dom.removeEventListener("blur", blur);
        document.removeEventListener("pointerdown", outside); document.removeEventListener("dragover", dragOver, true); document.removeEventListener("drop", drop, true); document.removeEventListener("dragend", cancelDrag); document.removeEventListener("dragleave", dragLeave);
        window.removeEventListener("scroll", reposition, true); window.removeEventListener("resize", reposition);
        resizeObserver?.disconnect();
        column?.removeEventListener("transitionend", columnSettled);
      } };
    },
  }));
}
