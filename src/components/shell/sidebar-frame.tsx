"use client";

import type { ReactNode } from "react";
import { PanelLeftOpen } from "lucide-react";
import { NAV_TOGGLE_SHORTCUT } from "@/components/actions/action-registry";
import { buttonClasses } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { NAV_WIDTH } from "./nav-width";

/**
 * The wide window's sidebar column. Collapsed is width 0 — the content stays mounted (and `inert`) so the
 * tree keeps what was expanded and scrolled — and an expand button floats on the pages' top line.
 */
export function SidebarFrame({ collapsed, onExpand, children }: { collapsed: boolean; onExpand: () => void; children: ReactNode }) {
  const width = NAV_WIDTH.default;
  return (
    <>
      <aside
        aria-label="Navigation"
        inert={collapsed}
        style={{ width: collapsed ? 0 : width }}
        className={`relative hidden shrink-0 overflow-hidden border-kh-border transition-[width] duration-160 ease-out lg:block ${collapsed ? "" : "border-r"}`}
      >
        <div className="h-full" style={{ width }}>{children}</div>
      </aside>
      {collapsed ? (
        <div className="fixed left-2 top-2 z-30 hidden lg:block">
          <Tooltip label="Expand navigation" shortcut={NAV_TOGGLE_SHORTCUT} side="right">
            <button type="button" onClick={onExpand} aria-label="Expand navigation" aria-keyshortcuts={NAV_TOGGLE_SHORTCUT} className={buttonClasses({ variant: "ghost", icon: true })}>
              <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
            </button>
          </Tooltip>
        </div>
      ) : null}
    </>
  );
}
