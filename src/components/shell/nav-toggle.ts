/**
 * Asking the app shell to collapse or expand its navigation. The shell owns whether the navigation is
 * collapsed (and remembers it), so anything that is not the shell — the palette — asks by event, as the
 * palette asks the document pane for its details.
 */
export const TOGGLE_NAV_EVENT = "kh:toggle-nav";

export function requestNavToggle(): void {
  window.dispatchEvent(new CustomEvent(TOGGLE_NAV_EVENT));
}
