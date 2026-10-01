"use client";

import { Tooltip as BaseTooltip } from "@base-ui-components/react/tooltip";
import type { ReactElement, ReactNode } from "react";
import { shortcutLabel } from "@/lib/shortcut-keys";
import { Kbd } from "./kbd";

/**
 * A name, and the key that does the same thing, for a control that has no
 * visible label.
 *
 * Icon-only controls used to explain themselves through the native `title`
 * attribute, with the shortcut spelled into the string. That tooltip waits
 * about a second, cannot be styled, and never appears for a keyboard user or on
 * touch. This one opens on hover and on keyboard focus, and takes the shortcut
 * from the same registry value that binds the key (`Action.shortcut`), so what
 * the tooltip says and what the key does cannot disagree (design language §10).
 *
 * It is a hint, not a name: the control keeps its own `aria-label`. Truncated
 * text keeps the native `title`, which is the right tool for "here is the rest
 * of this string".
 *
 * Surface: `lg` radius and `popover` elevation, as every floating surface
 * (§5, §6). Only controls that are not themselves a menu trigger use it — a
 * tooltip over a button whose menu is open would sit on the menu.
 */
export function Tooltip({
  label,
  shortcut,
  keys,
  side = "bottom",
  children,
}: {
  label: ReactNode;
  /** A registry `shortcut` ("Meta+I Control+I", "E"); shown as its first alternative. */
  shortcut?: string;
  /** A key as it reads on the keycap, for one that is not a registry shortcut (the graph's `+`, `−`, `0`). */
  keys?: string;
  side?: "top" | "right" | "bottom" | "left";
  /** The control itself: one element that takes a ref and props. */
  children: ReactElement<Record<string, unknown>>;
}) {
  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger render={children} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner side={side} sideOffset={6} className="z-[80]">
          <BaseTooltip.Popup
            className={
              "pointer-events-none flex items-center gap-2 rounded-lg border border-kh-border bg-kh-bg-raised px-2 py-1 " +
              "text-caption text-kh-text shadow-popover " +
              "transition-[opacity,transform] duration-120 ease-out " +
              "data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0 " +
              "data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0"
            }
          >
            <span>{label}</span>
            {shortcut || keys ? <Kbd>{shortcut ? shortcutLabel(shortcut) : keys}</Kbd> : null}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}

/**
 * Makes a run of neighbouring tooltips open together: once one has shown, the
 * next opens at once instead of waiting again. Mounted once, by the app shell.
 */
export const TooltipProvider = BaseTooltip.Provider;
