import type { SelectHTMLAttributes } from "react";
import type { ControlSize } from "./control";
import { fieldClasses } from "./field";

/**
 * A native `<select>` on the field shape. Native rather than a Base UI
 * listbox because the one form that most needs it — the search page — is a
 * plain GET form that works without JavaScript, and because every hand-rolled
 * copy of this element in the codebase was already native. The platform
 * arrow is swapped for the icon set's chevron by `.kh-select` in globals.css,
 * drawn with gradients, so no wrapper element and no change in behaviour.
 */
export function Select({
  className = "",
  size = "md",
  ...props
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> & { size?: ControlSize }) {
  return <select className={fieldClasses({ size, className: `kh-select ${className}` })} {...props} />;
}
