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

/** The parts of a KeyboardEvent `matchesShortcut` reads. */
export type ShortcutEventLike = Pick<KeyEventLike, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "isComposing" | "repeat" | "keyCode">;

/**
 * Whether a key press is a registry `shortcut` that carries a modifier ("Meta+\ Control+\": either
 * alternative). The modifiers must be exactly those named, so ⌘\ is not ⌘⇧\ (`|`) and not ⌘⌥\; the
 * key is compared by what it types (`event.key`), not by where it sits, as everywhere else here.
 *
 * Not for a single key: that is `isSingleKeyShortcut`, which also says where such a key may not act.
 * A key that no field types (`\` with ⌘) has no such place to stay out of, so this asks only whether
 * it was pressed — not mid-composition in an input method, and not as a held-down repeat.
 */
export function matchesShortcut(event: ShortcutEventLike, shortcut: string): boolean {
  if (event.isComposing || event.keyCode === 229 || event.repeat) return false;
  return shortcut.split(" ").some((alternative) => {
    const parts = alternative.split("+");
    const key = parts.pop();
    if (!key || parts.length === 0) return false;
    return (
      event.key.toLowerCase() === key.toLowerCase() &&
      event.metaKey === parts.includes("Meta") &&
      event.ctrlKey === parts.includes("Control") &&
      event.altKey === parts.includes("Alt") &&
      event.shiftKey === parts.includes("Shift")
    );
  });
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
