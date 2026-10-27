/**
 * Applies the reader's stored theme and rail density before first paint, defaulting to light and compact.
 *
 * It stamps `data-theme` unconditionally rather than only when a choice is
 * stored: the theme is an explicit choice and `prefers-color-scheme` is
 * deliberately not consulted, so without this the document could not say
 * which theme was in force until hydration.
 *
 * Exported because `global-error` replaces the root layout and would
 * otherwise render a dark-mode reader a white page.
 */
export const THEME_PRE_PAINT_SCRIPT =
  `var d=document.documentElement;try{d.dataset.theme=localStorage.getItem("kh:theme")==="dark"?"dark":"light";d.dataset.density=localStorage.getItem("kh:density")==="comfortable"?"comfortable":"compact"}catch(e){d.dataset.theme="light";d.dataset.density="compact"}`;

/**
 * The script's SHA-256, as a Content-Security-Policy source. `global-error` is a client component
 * and cannot be handed the response's nonce, so its copy of the script is allowed by what it is.
 * `tests/unit/content-security-policy.test.ts` fails when the script changes and this does not.
 */
export const THEME_PRE_PAINT_SCRIPT_HASH = "sha256-IrW17cGRdBzRN+rqYGS5OoTmgfUUJ4rSI9gAMzLQVHA=";
