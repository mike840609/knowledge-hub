import type { LabelHTMLAttributes } from "react";

/**
 * A field's name (contract §15). Two layouts, because a label does one of two jobs:
 *
 * - stacked, the default: the name above a field in a form. One step under body and medium, in the
 *   secondary text colour, so it reads as a name and not as a value or as prose.
 * - `inline`: a caption beside a control in a toolbar ("Sort sources", "Event type"), where the
 *   control is the thing being read and its name is chrome.
 *
 * A label that wraps its field hands the field its weight; `fieldClasses` resets that, so what is
 * typed is never medium. A label that names a checkbox or radio row is the row, and is not this.
 */
export function Label({
  inline = false,
  className = "",
  ...props
}: LabelHTMLAttributes<HTMLLabelElement> & { inline?: boolean }) {
  const layout = inline
    ? "inline-flex items-center gap-2 text-caption text-kh-text-muted"
    : "block text-body-sm font-medium text-kh-text-secondary";
  return <label className={`${layout} ${className}`} {...props} />;
}
