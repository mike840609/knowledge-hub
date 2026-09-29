"use client";

import type { KeyboardEvent } from "react";
import { formKeyIntent } from "@/lib/form-keys";

/**
 * ⌘Enter saves, ⌘/ switches rendered ⇄ Markdown and Esc cancels, inside a
 * document form. The rules are `formKeyIntent`'s; this only carries them out.
 *
 * Saving goes through the form's own submit button and only when that button
 * is enabled: `requestSubmit()` ignores a disabled button, so checking it here
 * is what keeps "not hydrated yet", "saving", "access unconfirmed" and "no
 * title" (all already on the button) from being restated.
 */
export function useFormKeys({
  dirty,
  busy,
  onCancel,
  mode,
}: {
  dirty: boolean;
  busy: boolean;
  onCancel: () => void;
  mode?: { toggle: () => void };
}) {
  return (event: KeyboardEvent<HTMLFormElement>) => {
    const intent = formKeyIntent(
      {
        key: event.key,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        isComposing: event.nativeEvent.isComposing,
        keyCode: event.keyCode,
      },
      { dirty, busy, canToggleMode: mode !== undefined },
    );
    if (intent === null) return;
    if (intent === "save") {
      const submit = event.currentTarget.querySelector<HTMLButtonElement>('button[type="submit"]');
      if (!submit || submit.disabled) return;
      event.preventDefault();
      event.currentTarget.requestSubmit(submit);
      return;
    }
    event.preventDefault();
    if (intent === "cancel") onCancel();
    else mode?.toggle();
  };
}
