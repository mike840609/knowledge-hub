"use client";

import { Select as BaseSelect } from "@base-ui-components/react/select";
import { Check, ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import type { ControlSize } from "./control";
import { fieldClasses } from "./field";
import { menuPopupClasses, menuRowClasses } from "./menu";

export type SelectMenuOption<Value extends string | number> = {
  value: Value;
  label: ReactNode;
  disabled?: boolean;
};

/**
 * A choice among a few options, in a client component (contract §15).
 *
 * Closed it is a field: the shape, border and height are `fieldClasses`, so it
 * lines up with an `Input` beside it. Open it is a menu: the popup and rows
 * are `ui/menu.tsx`'s, where a native `<select>` hands the list to the
 * platform and leaves the design language at the moment it is used.
 *
 * `Select` stays, and stays native, for a form that must submit without
 * JavaScript. This one has no `name`: it reports through `onValueChange`.
 *
 * The list opens under the field, not over it with the chosen row on top of
 * the trigger (the library's default, after macOS), so it reads as the menus
 * here do. The field and each row carry `data-value`: what is chosen, and what a test picks by.
 */
// ponytail: no filter field; add one (Base UI Combobox) when a list outgrows type-ahead.
export function SelectMenu<Value extends string | number>({
  value,
  onValueChange,
  options,
  size = "md",
  className = "",
  disabled,
  id,
  "aria-label": ariaLabel,
}: {
  value: Value;
  onValueChange: (value: Value) => void;
  options: ReadonlyArray<SelectMenuOption<Value>>;
  size?: ControlSize;
  className?: string;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
}) {
  return (
    <BaseSelect.Root
      items={options}
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        if (next !== null) onValueChange(next as Value);
      }}
    >
      <BaseSelect.Trigger
        id={id}
        aria-label={ariaLabel}
        data-value={value}
        className={fieldClasses({
          size,
          className: `kh-control inline-flex min-w-0 cursor-default select-none items-center justify-between gap-2 text-left data-[popup-open]:border-kh-focus ${className}`,
        })}
      >
        <BaseSelect.Value className="min-w-0 truncate" />
        <BaseSelect.Icon className="flex shrink-0 text-kh-text-muted">
          <ChevronDown className="h-4 w-4" aria-hidden="true" />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner className="z-50" align="start" sideOffset={6} alignItemWithTrigger={false}>
          <BaseSelect.Popup className={`${menuPopupClasses} max-h-[min(20rem,var(--available-height))] overflow-y-auto`}>
            {options.map((option) => (
              <BaseSelect.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                data-value={option.value}
                className={menuRowClasses}
              >
                <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                  <BaseSelect.ItemIndicator>
                    <Check className="h-4 w-4 text-kh-selected-text" aria-hidden="true" />
                  </BaseSelect.ItemIndicator>
                </span>
                <BaseSelect.ItemText className="min-w-0 flex-1 truncate">{option.label}</BaseSelect.ItemText>
              </BaseSelect.Item>
            ))}
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
