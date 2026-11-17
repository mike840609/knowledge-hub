/**
 * Keys typed between pressing Create and the new note's title field taking focus
 * (2026-11-19 creation-flow spec, decision 3). For that moment no field has focus: the new-note page
 * is still loading, or the editor is still mounting. A character typed then would land nowhere, so
 * it is kept here and becomes the start of the title.
 *
 * ponytail: plain characters and Backspace only. An IME composes into a focused field and never
 * reaches here; the title field takes over as soon as it has focus.
 */
let typed: string | null = null;
/** Enter was pressed: the title is done and writing goes on in the body. */
let entered = false;
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

/** Starts keeping keys, beginning with `initial`. After ten seconds untaken, it stops and forgets them. */
export function bufferTyping(initial = "", keepFocus = false): void {
  stopListening?.();
  clearTimeout(expiry);
  typed = initial;
  entered = false;
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target instanceof HTMLElement && (event.target.isContentEditable || event.target.closest("input, textarea, select"))) return;
    if (event.key === "Enter") {
      entered = true;
      stopListening?.();
    } else if (event.key === "Backspace") typed = (typed ?? "").slice(0, -1);
    else if (event.key.length === 1 && (typed || event.key !== " ")) typed = (typed ?? "") + event.key;
    else return;
    event.preventDefault();
  };
  window.addEventListener("keydown", onKeyDown, true);
  // A field still focused here (the palette's search while it closes) would take the keys instead. The
  // starter's own title keeps focus: it feeds `setTyped` itself, and an IME composes only into a focused field.
  if (!keepFocus && typeof document !== "undefined" && document.activeElement instanceof HTMLElement) document.activeElement.blur();
  // Untaken by then, the note was left: a later starter must not pick these keys up.
  expiry = setTimeout(() => { stopListening?.(); typed = null; entered = false; }, 10_000);
  stopListening = () => {
    window.removeEventListener("keydown", onKeyDown, true);
    stopListening = null;
  };
}

/** The title field has the keys now: what it holds replaces what was kept, and Enter there ends the title. */
export function setTyped(value: string, enter = false): void {
  if (typed === null) return;
  typed = value;
  if (!enter) return;
  entered = true;
  stopListening?.();
}

/** Stops keeping keys and hands over what was typed ("" for nothing), and whether Enter ended it. */
export function takeTyped(): { text: string; entered: boolean } {
  stopListening?.();
  clearTimeout(expiry);
  const taken = { text: typed ?? "", entered };
  typed = null;
  entered = false;
  return taken;
}
