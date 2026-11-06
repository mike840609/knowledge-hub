"use client";

import { useEffect } from "react";

/** Native GET fallback uses UTC; JS submissions with a newly selected date
 * must send the browser offset immediately, not flash UTC results first.
 * Existing explicit offsets remain authoritative.
 */
export function TaskSearchDateOffsetSubmit({
  formId, hasExplicitOffset,
}: { formId: string; hasExplicitOffset: boolean }) {
  useEffect(() => {
    if (hasExplicitOffset) return;
    const form = document.getElementById(formId);
    if (!(form instanceof HTMLFormElement)) return;
    const submit = () => {
      const from = form.querySelector<HTMLInputElement>('input[name="from"]')?.value;
      const to = form.querySelector<HTMLInputElement>('input[name="to"]')?.value;
      const existing = form.querySelector<HTMLInputElement>('input[name="offset"]');
      if (!from && !to) {
        existing?.remove();
        return;
      }
      if (existing) return;
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = "offset";
      input.value = String(-new Date().getTimezoneOffset());
      form.appendChild(input);
    };
    form.addEventListener("submit", submit);
    return () => form.removeEventListener("submit", submit);
  }, [formId, hasExplicitOffset]);
  return null;
}
