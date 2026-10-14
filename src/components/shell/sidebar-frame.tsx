"use client";

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { PanelLeftOpen } from "lucide-react";
import { NAV_TOGGLE_SHORTCUT } from "@/components/actions/action-registry";
import { buttonClasses } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { NAV_WIDTH, clampNavWidth, isNavWidth, nextNavWidth } from "./nav-width";
import { usePersistedJson } from "./use-persisted-state";

const PEEK_LEAVE_MS = 300;

/**
 * The wide window's sidebar column. Collapsed is width 0 — the content stays mounted (and `inert`) so the
 * tree keeps what was expanded and scrolled — and an expand button floats on the pages' top line. While
 * collapsed, a pointer at the window's left edge peeks it over the page; the keyboard's way in is ⌘\ or
 * the button, which do everything peeking does. The right edge resizes it.
 */
export function SidebarFrame({ collapsed, onExpand, children }: { collapsed: boolean; onExpand: () => void; children: ReactNode }) {
  const [storedWidth, setStoredWidth] = usePersistedJson("kh:nav-width", NAV_WIDTH.default, isNavWidth);
  // Width while dragging lives here and is written once on release, not to storage every frame.
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const [peeking, setPeeking] = useState(false);
  const asideRef = useRef<HTMLElement>(null);
  const leaveTimer = useRef<number | null>(null);
  const width = dragWidth ?? storedWidth;
  const hidden = collapsed && !peeking;

  useEffect(() => {
    if (!collapsed) setPeeking(false);
  }, [collapsed]);

  useEffect(() => {
    if (!peeking) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) setPeeking(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [peeking]);

  useEffect(() => () => {
    if (leaveTimer.current !== null) window.clearTimeout(leaveTimer.current);
  }, []);

  function startPeek() {
    if (leaveTimer.current !== null) window.clearTimeout(leaveTimer.current);
    if (collapsed && window.matchMedia("(hover: hover)").matches) setPeeking(true);
  }

  function endPeek() {
    if (leaveTimer.current !== null) window.clearTimeout(leaveTimer.current);
    leaveTimer.current = window.setTimeout(() => {
      // A menu opened from the sidebar draws outside it; going to it is not leaving.
      if (asideRef.current?.querySelector("[data-popup-open]")) return;
      setPeeking(false);
    }, PEEK_LEAVE_MS);
  }

  function onHandlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = width;
    let latest = startWidth;
    const move = (moved: PointerEvent) => {
      latest = clampNavWidth(startWidth + moved.clientX - startX);
      setDragWidth(latest);
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      setStoredWidth(latest);
      setDragWidth(null);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  }

  function onHandleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const next = nextNavWidth(width, event.key);
    if (next === null) return;
    event.preventDefault();
    setStoredWidth(next);
  }

  const position = peeking ? "fixed inset-y-0 left-0 z-40 hidden border-r shadow-popover lg:block" : hidden ? "relative hidden lg:block" : "relative hidden border-r lg:block";
  return (
    <>
      <aside
        ref={asideRef}
        aria-label="Navigation"
        inert={hidden}
        data-peeking={peeking ? "" : undefined}
        onPointerEnter={startPeek}
        onPointerLeave={peeking ? endPeek : undefined}
        style={{ width: hidden ? 0 : width }}
        className={`shrink-0 overflow-hidden border-kh-border ${position} ${dragWidth === null ? "transition-[width] duration-160 ease-out" : ""}`}
      >
        <div className="h-full" style={{ width }}>{children}</div>
        {!collapsed ? (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize navigation"
            aria-valuemin={NAV_WIDTH.min}
            aria-valuemax={NAV_WIDTH.max}
            aria-valuenow={width}
            tabIndex={0}
            onPointerDown={onHandlePointerDown}
            onKeyDown={onHandleKeyDown}
            onDoubleClick={() => setStoredWidth(NAV_WIDTH.default)}
            className="absolute inset-y-0 right-0 w-1 cursor-col-resize touch-none hover:bg-kh-border-strong focus-visible:bg-kh-border-strong focus-visible:outline-none"
          />
        ) : null}
      </aside>
      {collapsed ? (
        <>
          <div aria-hidden="true" onPointerEnter={startPeek} onPointerLeave={endPeek} className="fixed inset-y-0 left-0 z-30 hidden w-2 lg:block" />
          <div className="fixed left-2 top-2 z-30 hidden lg:block">
            <Tooltip label="Expand navigation" shortcut={NAV_TOGGLE_SHORTCUT} side="right">
              <button type="button" onClick={onExpand} onPointerEnter={startPeek} onPointerLeave={endPeek} aria-label="Expand navigation" aria-keyshortcuts={NAV_TOGGLE_SHORTCUT} className={buttonClasses({ variant: "ghost", icon: true })}>
                <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
              </button>
            </Tooltip>
          </div>
        </>
      ) : null}
    </>
  );
}
