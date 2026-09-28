export type FormKeyEvent = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  isComposing: boolean;
  keyCode: number;
};

export type FormKeyIntent = "save" | "toggle-preview" | "exit-preview" | "cancel" | null;

/**
 * What a key pressed inside a document form asks for. Keyboard shortcuts spec
 * §5; composer spec §6 adds preview. Esc never discards changes: in preview it
 * returns to editing, and it leaves only a form nothing has been typed into.
 */
export function formKeyIntent(
  event: FormKeyEvent,
  state: { dirty: boolean; busy: boolean; previewing: boolean; canPreview: boolean },
): FormKeyIntent {
  // An input method uses Enter and Esc to finish or abandon a composition.
  if (event.isComposing || event.keyCode === 229) return null;
  const command = event.metaKey || event.ctrlKey;
  if (command && event.key === "Enter") return "save";
  if (command && event.shiftKey && !event.altKey && event.key.toLowerCase() === "p") {
    return state.canPreview ? "toggle-preview" : null;
  }
  if (event.key !== "Escape") return null;
  if (state.previewing) return "exit-preview";
  return !state.dirty && !state.busy ? "cancel" : null;
}
