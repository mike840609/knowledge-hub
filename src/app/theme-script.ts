/**
 * Applies the reader's stored theme before first paint, defaulting to light.
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
  `var d=document.documentElement;try{d.dataset.theme=localStorage.getItem("kh:theme")==="dark"?"dark":"light"}catch(e){d.dataset.theme="light"}`;
