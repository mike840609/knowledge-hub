"use client";

import { Menu as BaseMenu } from "@base-ui-components/react/menu";
import { Check, ChevronRight } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

/**
 * Menus, built on the same library that already owns Dialog, Tabs and Button.
 *
 * The contract requires arrow-key navigation on every list of rows, and menus
 * are lists of rows. Hand-rolled `<details>` menus could not offer it, which
 * is why this primitive exists rather than another disclosure element.
 *
 * Surfaces follow the contract: `lg` is the menu radius — `xl` is reserved for
 * modals and the command palette — and `popover` is the elevation.
 */

const POPUP =
  "z-50 min-w-[var(--anchor-width)] rounded-lg border border-kh-border bg-kh-bg p-1 shadow-popover outline-none " +
  "transition-[opacity,transform] duration-120 ease-out " +
  "data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0 " +
  "data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0";

/** Rows sit on the control height so a menu reads as part of the same system. */
const ROW =
  "kh-focus-ring flex min-h-8 w-full cursor-default select-none items-center gap-2 rounded-md px-2 text-body text-kh-text " +
  "data-[highlighted]:bg-kh-bg-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-50";

export const MenuRoot = BaseMenu.Root;
export const MenuTrigger = BaseMenu.Trigger;
export const MenuGroup = BaseMenu.Group;
export const MenuSub = BaseMenu.SubmenuRoot;

export function MenuContent({
  children,
  className = "",
  align = "start",
  sideOffset = 6,
  ...props
}: ComponentProps<typeof BaseMenu.Positioner> & { children: ReactNode; className?: string }) {
  return (
    <BaseMenu.Portal>
      <BaseMenu.Positioner align={align} sideOffset={sideOffset} {...props}>
        <BaseMenu.Popup className={`${POPUP} ${className}`}>{children}</BaseMenu.Popup>
      </BaseMenu.Positioner>
    </BaseMenu.Portal>
  );
}

export function MenuItem({ className = "", ...props }: ComponentProps<typeof BaseMenu.Item>) {
  return <BaseMenu.Item className={`${ROW} ${className}`} {...props} />;
}

export function MenuGroupLabel({ className = "", ...props }: ComponentProps<typeof BaseMenu.GroupLabel>) {
  return (
    <BaseMenu.GroupLabel
      className={`px-2 pb-1 pt-2 text-caption font-semibold text-kh-text-muted ${className}`}
      {...props}
    />
  );
}

export function MenuSeparator({ className = "", ...props }: ComponentProps<typeof BaseMenu.Separator>) {
  return <BaseMenu.Separator className={`my-1 h-px bg-kh-border ${className}`} {...props} />;
}

export function MenuRadioGroup(props: ComponentProps<typeof BaseMenu.RadioGroup>) {
  return <BaseMenu.RadioGroup {...props} />;
}

/**
 * The indicator occupies its slot whether or not it is showing, so the labels
 * stay aligned.
 *
 * `closeOnClick` defaults to `true` here, against the library's own default of
 * `false` for checkbox and radio items. §10 says choosing an option closes the
 * menu, with one exception, so the primitive states the rule and the exception
 * opts out — rather than every ordinary caller having to opt in and the rule
 * holding only where someone remembered. `Show archived` is what this cost:
 * it left the menu sitting over a view that had navigated away underneath.
 */
export function MenuRadioItem({
  className = "",
  children,
  closeOnClick = true,
  ...props
}: ComponentProps<typeof BaseMenu.RadioItem> & { children: ReactNode }) {
  return (
    <BaseMenu.RadioItem className={`${ROW} ${className}`} closeOnClick={closeOnClick} {...props}>
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">
        <BaseMenu.RadioItemIndicator>
          <Check className="h-4 w-4 text-kh-selected-text" aria-hidden="true" />
        </BaseMenu.RadioItemIndicator>
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </BaseMenu.RadioItem>
  );
}

export function MenuCheckboxItem({
  className = "",
  children,
  closeOnClick = true,
  ...props
}: ComponentProps<typeof BaseMenu.CheckboxItem> & { children: ReactNode }) {
  return (
    <BaseMenu.CheckboxItem className={`${ROW} ${className}`} closeOnClick={closeOnClick} {...props}>
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">
        <BaseMenu.CheckboxItemIndicator>
          <Check className="h-4 w-4 text-kh-selected-text" aria-hidden="true" />
        </BaseMenu.CheckboxItemIndicator>
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </BaseMenu.CheckboxItem>
  );
}

/** A nested list, for a section long enough that it should not sit open. */
export function MenuSubTrigger({
  className = "",
  children,
  ...props
}: ComponentProps<typeof BaseMenu.SubmenuTrigger> & { children: ReactNode }) {
  return (
    <BaseMenu.SubmenuTrigger className={`${ROW} ${className}`} {...props}>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <ChevronRight className="h-4 w-4 shrink-0 text-kh-text-muted" aria-hidden="true" />
    </BaseMenu.SubmenuTrigger>
  );
}
