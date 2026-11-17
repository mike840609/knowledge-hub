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

export function isNewNoteHref(href: string): boolean {
  return /\/knowledge\/new(?:$|\?(?!.*\bcompose\b))/.test(href);
}

/** Starts keeping keys, beginning with `initial`. Stops by itself after ten seconds. */
export function bufferTyping(initial = ""): void {
  stopListening?.();
  typed = initial;
  entered = false;
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable='true']")) return;
    if (event.key === "Enter") {
      entered = true;
      stopListening?.();
    } else if (event.key === "Backspace") typed = (typed ?? "").slice(0, -1);
    else if (event.key.length === 1 && (typed || event.key !== " ")) typed = (typed ?? "") + event.key;
    else return;
    event.preventDefault();
  };
  window.addEventListener("keydown", onKeyDown, true);
  const timer = setTimeout(() => stopListening?.(), 10_000);
  stopListening = () => {
    window.removeEventListener("keydown", onKeyDown, true);
    clearTimeout(timer);
    stopListening = null;
  };
}

/** The title field has the keys now: what it holds replaces what was kept, and Enter there counts too. */
export function setTyped(value: string, enter = false): void {
  if (typed === null) return;
  typed = value;
  entered ||= enter;
}

/** Stops keeping keys and hands over what was typed ("" for nothing), and whether Enter ended it. */
export function takeTyped(): { text: string; entered: boolean } {
  stopListening?.();
  const taken = { text: typed ?? "", entered };
  typed = null;
  entered = false;
  return taken;
}
