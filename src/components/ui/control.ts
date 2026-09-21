/**
 * The one control-height ladder (24 / 32 / 40), matching the reference.
 *
 * Buttons, inputs and selects all sit on it so that a form row lines up
 * without anyone measuring. It lives in its own module because the moment it
 * was spelled out twice — `min-h-10` in `Input`, `h-10` in `Button` — the two
 * drifted, and `search-form` grew a third height (44px) on top of them.
 *
 * `sm` sits exactly on the WCAG 2.5.8 minimum target of 24px, so it is for
 * dense chrome and nothing else. `md` is the default for both buttons and
 * fields, so an unconfigured form lines up. `lg` is opted into for a whole
 * row at once — the search page is the only one that does.
 */
export type ControlSize = "sm" | "md" | "lg";

export const controlHeight: Record<ControlSize, string> = {
  sm: "h-6",
  md: "h-8",
  lg: "h-10",
};

/** Square counterpart, for icon-only controls. */
export const controlWidth: Record<ControlSize, string> = {
  sm: "w-6",
  md: "w-8",
  lg: "w-10",
};
