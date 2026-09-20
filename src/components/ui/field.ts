import { controlHeight, type ControlSize } from "./control";

/**
 * The shape shared by every form field: `Input`, `Select` and `Textarea`.
 *
 * `border-strong` rather than `border` is the point of this module. A field
 * fills with the canvas colour, so its border is the only thing that says a
 * control is there, and WCAG 1.4.11 asks for 3:1 on such a boundary. Every
 * field that was hand-rolled instead of imported got `border` and failed it.
 */
const fieldBase =
  "kh-focus-ring rounded-md border border-kh-border-strong bg-kh-bg text-kh-text transition-colors placeholder:text-kh-text-muted focus:border-kh-focus disabled:cursor-not-allowed disabled:opacity-50";

const fieldSizeClasses: Record<ControlSize, string> = {
  sm: `${controlHeight.sm} px-2 text-body-sm`,
  md: `${controlHeight.md} px-3 text-body`,
  lg: `${controlHeight.lg} px-3 text-body`,
};

/** Multi-line fields take their height from `rows`, so only padding scales. */
const multilineSizeClasses: Record<ControlSize, string> = {
  sm: "px-2 py-1 text-body-sm",
  md: "px-3 py-1.5 text-body",
  lg: "px-3 py-2 text-body",
};

export function fieldClasses({
  size = "md",
  multiline = false,
  className = "",
}: { size?: ControlSize; multiline?: boolean; className?: string } = {}): string {
  return `${fieldBase} ${multiline ? multilineSizeClasses[size] : fieldSizeClasses[size]} ${className}`;
}
