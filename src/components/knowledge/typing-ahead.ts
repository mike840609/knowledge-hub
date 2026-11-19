/**
 * Keep writing through route transitions, when neither the starter's fields nor the editor has
 * focus. The starter's native fields take over while the create request is pending, including IME.
 */
export type NewNoteDraft = { text: string; body: string; entered: boolean };

let draft: NewNoteDraft | null = null;
let stopListening: (() => void) | null = null;
let expiry: ReturnType<typeof setTimeout> | undefined;

/** Keys are being kept: a dialog closing now should not hand focus back to a field (they would land there). */
export function isBuffering(): boolean {
  return stopListening !== null;
}

/** A click that opens in this tab; a modified one opens elsewhere and leaves this tab's keys alone. */
export function plainClick(event: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

export function isNewNoteHref(href: string): boolean {
  return /\/knowledge\/new(?:$|\?(?!.*\bcompose\b))/.test(href);
}

/** The returned draft survives the listener's expiry when it is already on its way to an editor. */
export function bufferTyping({ text = "", body = "", entered = false, keepFocus = false }: Partial<NewNoteDraft> & { keepFocus?: boolean } = {}): NewNoteDraft {
  takeTyped();
  const writing = { text, body, entered };
  draft = writing;
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target instanceof HTMLElement && (event.target.isContentEditable || event.target.closest("input, textarea, select"))) return;
    const field = writing.entered ? "body" : "text";
    if (event.key === "Enter") {
      if (writing.entered) writing.body += "\n";
      else writing.entered = true;
    } else if (event.key === "Backspace") writing[field] = writing[field].replace(/.$/su, "");
    else if (Array.from(event.key).length === 1 && (writing.entered || writing.text || event.key !== " ")) {
      if (writing.entered || writing.text.length + event.key.length <= 512) writing[field] += event.key;
    }
    else return;
    event.preventDefault();
  };
  window.addEventListener("keydown", onKeyDown, true);
  // A field still focused here (the palette's search while it closes) would take the keys instead. The
  // starter's own fields keep focus so they can continue accepting input until the editor opens.
  if (!keepFocus && typeof document !== "undefined" && document.activeElement instanceof HTMLElement) document.activeElement.blur();
  // Untaken by then, the note was left: a later starter must not pick these keys up.
  expiry = setTimeout(takeTyped, 10_000);
  stopListening = () => {
    window.removeEventListener("keydown", onKeyDown, true);
    stopListening = null;
  };
  return writing;
}

/** Stop listening for this handover without disturbing any later create action. */
export function finishTyping(writing: NewNoteDraft): void {
  if (draft === writing) takeTyped();
}

/** Stops keeping keys and hands over what was typed before the starter took focus. */
export function takeTyped(): NewNoteDraft {
  stopListening?.();
  clearTimeout(expiry);
  const taken = draft ?? { text: "", body: "", entered: false };
  draft = null;
  return taken;
}
