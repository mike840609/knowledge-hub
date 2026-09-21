/**
 * The tab shape, shared by the two things that need it.
 *
 * `ui/tabs.tsx` wraps Base UI's tabs, which swap panels inside one page and
 * mark the current tab with a `data-selected` attribute. Route-based
 * navigation cannot use that — each tab is a link to its own URL, and the
 * current one is decided by the pathname, not by component state. The two
 * therefore cannot share a component, which is why the settings navigation
 * had no tab styling at all and no active state.
 *
 * They can share the look, and this is where it lives so that changing a tab
 * changes both. The alternative — restating the class string in the link
 * version — is the drift this codebase has already paid for twice.
 */
const TAB_BASE = "kh-focus-ring -mb-px border-b-2 px-3 py-2 text-body-sm font-medium transition-colors";
const TAB_IDLE = "border-transparent text-kh-text-muted hover:text-kh-text";
const TAB_ACTIVE = "border-kh-primary text-kh-selected-text";

export const tabListClasses = "flex items-center gap-1 border-b border-kh-border";

/** For a link tab, where the caller knows which one is current. */
export function tabClasses(active: boolean, className = ""): string {
  return `${TAB_BASE} ${active ? TAB_ACTIVE : TAB_IDLE} ${className}`;
}

/** For Base UI, which marks the current tab with an attribute instead. */
export const selectableTabClasses =
  `${TAB_BASE} ${TAB_IDLE} data-[selected]:border-kh-primary data-[selected]:text-kh-selected-text`;
