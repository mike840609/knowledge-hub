export type FormKeyEvent = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  isComposing: boolean;
  keyCode: number;
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
  if (command && !event.altKey && event.key === "/") return state.canToggleMode ? "toggle-mode" : null;
  if (event.key !== "Escape") return null;
  return !state.dirty && !state.busy ? "cancel" : null;
}
