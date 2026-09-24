/**
 * Whether a key press may act as a single-key shortcut (`C`, `E`, `/`), and
 * how a registry `shortcut` reads on screen.
 *
 * A single key is also a character, so the rule is mostly about when it is
 * *not* a shortcut: while someone is typing into a field, composing with an
 * input method (a Chinese reader typing a letter mid-composition), or working
 * inside a dialog or menu that owns its own keys. See the keyboard-shortcuts
 * design, §3.3.
 */

/** The parts of a KeyboardEvent this reads; a plain object in tests. */
export type KeyEventLike = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isComposing: boolean;
  repeat: boolean;
  /** 229 is what an input method reports where `isComposing` is not set. */
  keyCode?: number;
  target: EventTarget | { closest?: (selector: string) => unknown } | null;
};

const EDITABLE = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
const OWNS_ITS_KEYS = '[role="dialog"], [role="menu"], [role="listbox"]';

export function isSingleKeyShortcut(event: KeyEventLike): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  if (event.isComposing || event.keyCode === 229) return false;
  if (event.repeat) return false;
  // `/` needs Shift on some layouts (Shift+7 in German); a letter never does.
  if (event.shiftKey && event.key !== "/") return false;
  const target = event.target as { closest?: (selector: string) => unknown } | null;
  if (typeof target?.closest === "function") {
    if (target.closest(EDITABLE) || target.closest(OWNS_ITS_KEYS)) return false;
  }
  return true;
}

/**
 * A registry `shortcut` is spelled for `aria-keyshortcuts` ("Meta+I Control+I").
 * On screen it shows its first alternative, the way the UI already writes ⌘K.
 */
export function shortcutLabel(shortcut: string): string {
  const [first = ""] = shortcut.split(" ");
  return first
    .split("+")
    .map((part) => (part === "Meta" ? "⌘" : part === "Control" ? "Ctrl " : part))
    .join("");
}
