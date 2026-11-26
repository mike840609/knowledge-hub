import { Plugin, PluginKey, Selection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { selectedBlockPos } from "./block-actions";
import { blockRangeOf, chooseRange, extendRangeTo, restoreRange } from "./block-range";
import { sequenceOf } from "./block-sequence";

/**
 * Choosing a range with the mouse (docs/superpowers/specs/2026-11-26-mouse-block-range-design.md): Shift-click on a block's
 * text, and a marquee drawn from the editor's margin. Both end in `chooseRange`, so the range, its fill, its announcement and
 * every range operation are the ones the keyboard makes. A press on text, or a drag of a text selection, is ProseMirror's.
 */
export type BlockBox = { pos: number; top: number; bottom: number };

/** Moving less than this is a click. */
const DRAG_THRESHOLD = 4;
/** Within this of the pane's top or bottom, a drag scrolls it. */
const EDGE = 40;

/**
 * The range a marquee over the vertical span `startY`…`endY` chooses among `boxes` (a sequence, in document order): the
 * blocks it meets. The anchor is the first one touched in the drag's direction. Null when it meets none; a single
 * block has anchor equal to head.
 */
export function marqueeRange(boxes: readonly BlockBox[], startY: number, endY: number): { anchor: number; head: number } | null {
  const low = Math.min(startY, endY);
  const high = Math.max(startY, endY);
  const touched = boxes.filter((box) => box.bottom >= low && box.top <= high);
  if (!touched.length) return null;
  const first = touched[0].pos;
  const last = touched[touched.length - 1].pos;
  return endY >= startY ? { anchor: first, head: last } : { anchor: last, head: first };
}

/** The block of `within`'s sequence holding `pos`, else the innermost block of its own sequence. */
function blockAround(view: EditorView, pos: number, within: number | null): number | null {
  const { doc } = view.state;
  if (within !== null) {
    const own = sequenceOf(doc, within).find((block) => pos >= block.pos && pos <= block.pos + block.node.nodeSize);
    if (own) return own.pos;
  }
  const $pos = doc.resolve(pos);
  for (let depth = $pos.depth; depth >= 1; depth--) {
    if ($pos.node(depth).type.name === "list_item") {
      const at = $pos.before(depth);
      if (sequenceOf(doc, at).some((block) => block.pos === at)) return at;
    }
  }
  if ($pos.depth < 1) return null;
  return /_list$/.test($pos.node(1).type.name) ? null : $pos.before(1);
}

function scroller(view: EditorView): HTMLElement | null {
  for (let node: HTMLElement | null = view.dom.parentElement; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && node.scrollHeight > node.clientHeight) return node;
  }
  return null;
}

export const blockPointer = $prose(() => {
  let pointerType = "mouse";
  let stop: (() => void) | null = null;

  function startMarquee(view: EditorView, down: MouseEvent) {
    const before = { selection: view.state.selection, range: blockRangeOf(view.state) };
    const pane = scroller(view);
    const top = () => pane?.scrollTop ?? window.scrollY;
    // The start is kept against the content, so scrolling while dragging does not move it.
    const startX = down.clientX;
    const startY = down.clientY + top();
    let x = down.clientX;
    let y = down.clientY;
    let dragging = false;
    let last = "";
    let frame = 0;
    let box: HTMLElement | null = null;
    view.focus();

    const boxes = (): BlockBox[] => sequenceOf(view.state.doc, 0).flatMap((block) => {
      const rect = (view.nodeDOM(block.pos) as HTMLElement | null)?.getBoundingClientRect?.();
      return rect ? [{ pos: block.pos, top: rect.top + top(), bottom: rect.bottom + top() }] : [];
    });
    let done = false;
    const apply = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      if (!dragging || done) return;
      const startNow = startY - top();
      if (!box) { box = document.createElement("div"); box.className = "kh-block-marquee"; document.body.appendChild(box); }
      box.style.left = `${Math.min(startX, x)}px`; box.style.top = `${Math.min(startNow, y)}px`;
      box.style.width = `${Math.abs(x - startX)}px`; box.style.height = `${Math.abs(y - startNow)}px`;
      const hit = marqueeRange(boxes(), startY, y + top());
      const id = hit ? `${hit.anchor}:${hit.head}` : "";
      if (id === last) return;
      last = id;
      if (hit) chooseRange(view, hit.anchor, hit.head);
      else restoreRange(view, before.selection, before.range);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(apply); };
    const edge = () => {
      if (!dragging) return;
      const bounds = pane?.getBoundingClientRect() ?? { top: 0, bottom: window.innerHeight };
      const step = y < bounds.top + EDGE ? -12 : y > bounds.bottom - EDGE ? 12 : 0;
      if (step) { if (pane) pane.scrollTop += step; else window.scrollBy(0, step); schedule(); }
    };
    const move = (event: MouseEvent) => {
      x = event.clientX; y = event.clientY;
      if (!dragging && Math.hypot(x - startX, y - (startY - top())) < DRAG_THRESHOLD) return;
      dragging = true;
      apply();
      edge();
    };
    const scrolled = () => { if (dragging) { schedule(); edge(); } };
    const finish = (cancelled: boolean) => {
      done = true;
      if (frame) cancelAnimationFrame(frame);
      document.removeEventListener("mousemove", move, true); document.removeEventListener("mouseup", up, true);
      document.removeEventListener("keydown", key, true); (pane ?? window).removeEventListener("scroll", scrolled);
      box?.remove(); box = null; stop = null;
      if (cancelled && dragging) restoreRange(view, before.selection, before.range);
    };
    const up = (event: MouseEvent) => {
      const wasDrag = dragging;
      x = event.clientX; y = event.clientY;
      if (wasDrag) apply();
      finish(false);
      if (!wasDrag) {
        // A click: the caret goes to the nearest text on that line, as the browser's own press would have put it.
        try {
          const rect = view.dom.getBoundingClientRect();
          const inset = Number.parseFloat(getComputedStyle(view.dom).paddingLeft) || 0;
          const at = view.posAtCoords({ left: Math.max(x, rect.left + inset + 1), top: y });
          if (at) view.dispatch(view.state.tr.setSelection(Selection.near(view.state.doc.resolve(at.pos))));
        } catch { /* no layout to ask */ }
      }
      view.focus();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault(); event.stopImmediatePropagation();
      finish(true);
    };
    document.addEventListener("mousemove", move, true); document.addEventListener("mouseup", up, true);
    document.addEventListener("keydown", key, true); (pane ?? window).addEventListener("scroll", scrolled);
    stop = () => finish(false);
  }

  return new Plugin({
    key: new PluginKey("khBlockPointer"),
    props: {
      handleDOMEvents: {
        pointerdown: (_view, event) => { pointerType = (event as PointerEvent).pointerType || "mouse"; return false; },
        mousedown(view, event) {
          const touch = pointerType === "touch";
          pointerType = "mouse";
          if (!view.editable || touch || event.button !== 0 || event.ctrlKey || event.altKey || event.metaKey) return false;
          const target = event.target as Node | null;
          if (event.shiftKey) {
            // Shift-click extends a chosen block; with only a caret it is ProseMirror's text selection (decision 3).
            const chosen = selectedBlockPos(view.state);
            if (chosen === null || !target || !view.dom.contains(target)) return false;
            let pos: number | null = null;
            try {
              pos = target === view.dom
                ? (view.posAtCoords({ left: view.dom.getBoundingClientRect().left + (Number.parseFloat(getComputedStyle(view.dom).paddingLeft) || 0) + 1, top: event.clientY })?.pos ?? null)
                : view.posAtDOM(target, 0);
            } catch { pos = null; }
            const block = pos === null ? null : blockAround(view, pos, chosen);
            if (block === null) return false;
            event.preventDefault();
            extendRangeTo(view, block, false);
            view.focus();
            return true;
          }
          // Only a press on the editor's own surface, not on a block in it: the gutter, between blocks, below the last.
          if (target !== view.dom) return false;
          event.preventDefault();
          stop?.();
          startMarquee(view, event);
          return true;
        },
      },
    },
    view: () => ({ destroy() { stop?.(); } }),
  });
});
