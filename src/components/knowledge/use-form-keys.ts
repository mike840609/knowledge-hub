"use client";

import type { KeyboardEvent } from "react";

/**
 * ⌘Enter / Ctrl+Enter saves and Esc cancels, inside a document form. Keyboard
 * shortcuts design §5.
 *
 * Saving goes through the form's own submit button and only when that button
 * is enabled: `requestSubmit()` ignores a disabled button, so checking it here
 * is what keeps "not hydrated yet", "saving", "access unconfirmed" and "no
 * title" (all already on the button) from being restated.
 *
 * Esc leaves only an unchanged form. With changes it does nothing, so no key
 * discards a draft; Cancel is the one way to.
 */
export function useFormKeys({ dirty, busy, onCancel }: { dirty: boolean; busy: boolean; onCancel: () => void }) {
  return (event: KeyboardEvent<HTMLFormElement>) => {
    // An input method uses Enter and Esc to finish or abandon a composition.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      const submit = event.currentTarget.querySelector<HTMLButtonElement>('button[type="submit"]');
      if (!submit || submit.disabled) return;
      event.preventDefault();
      event.currentTarget.requestSubmit(submit);
      return;
    }
    if (event.key === "Escape" && !dirty && !busy) {
      event.preventDefault();
      onCancel();
    }
  };
}
