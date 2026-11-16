export type FormKeyEvent = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  isComposing: boolean;
  keyCode: number;
  /** The physical key, where known. */
  code?: string;
  /** Where the key was pressed: Mod-Shift-7 is a list key only in the rendered editor. */
  target?: EventTarget | null;
};

export type FormKeyIntent = "save" | "toggle-mode" | "cancel" | null;

/**
 * What a key pressed inside a document form asks for. Keyboard shortcuts spec
 * §5; composer spec §11.6. ⌘/Ctrl / switches between the rendered editor and
 * the Markdown source. Esc never discards changes: it leaves only a form
 * nothing has been typed into.
 */
export function formKeyIntent(
  event: FormKeyEvent,
  state: { dirty: boolean; busy: boolean; canToggleMode: boolean },
): FormKeyIntent {
  // An input method uses Enter and Esc to finish or abandon a composition.
  if (event.isComposing || event.keyCode === 229) return null;
  const command = event.metaKey || event.ctrlKey;
  if (command && event.key === "Enter") return "save";
  if (command && !event.altKey && event.key === "/" && !isListKey(event)) return state.canToggleMode ? "toggle-mode" : null;
  if (event.key !== "Escape") return null;
  return !state.dirty && !state.busy ? "cancel" : null;
}

/**
 * Mod-Shift-7 is the numbered list (Notion-parity spec, decision 5). Where Shift-7 types "/" (German,
 * Swiss, Nordic layouts) it also reads as ⌘/: inside the rendered editor the list keeps it. Elsewhere
 * (the Markdown source, the title) there is no list, and ⌘/ still toggles back. Other Shift-"/"
 * layouts always toggle.
 */
export function isListKey(event: { shiftKey: boolean; code?: string; target?: EventTarget | null }): boolean {
  return event.shiftKey && event.code !== undefined && /^(?:Digit|Numpad)\d$/.test(event.code)
    && typeof Element !== "undefined" && event.target instanceof Element && event.target.closest(".ProseMirror") !== null;
}
