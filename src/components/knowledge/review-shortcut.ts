import { useEffect, type RefObject } from "react";

export { COMMENT_SHORTCUT } from "@/components/actions/action-registry";

/**
 * Whether a key press is `COMMENT_SHORTCUT` (⌘⌥M / Ctrl+Alt+M; a single letter is never bound): the
 * key that types M, matched by what it types, and by where it sits only when it types no ASCII character. AltGr
 * is not it: Windows reports AltGr as Ctrl+Alt, and AltGr+M types a character on some layouts (µ on
 * German QWERTZ), which must be typed, not taken.
 */
export function isCommentShortcut(event: Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "isComposing" | "repeat" | "keyCode"> & { getModifierState?: (key: string) => boolean }): boolean {
  if (event.isComposing || event.keyCode === 229 || event.repeat) return false;
  if (event.metaKey === event.ctrlKey || !event.altKey || event.shiftKey) return false;
  if (event.getModifierState?.("AltGraph")) return false;
  // The key the reader sees: "m" wherever the layout puts it (on AZERTY its position is `Semicolon`).
  // Only where the key types no ASCII character at all — ⌥M types "µ" on a Mac — is the position asked
  // instead; AZERTY's comma, where QWERTY has M, types "," and so is not it.
  if (/^[\x20-\x7e]$/.test(event.key)) return event.key.toLowerCase() === "m";
  return event.code === "KeyM";
}

/** A field of its own (a reply box, the composer, the Markdown source view, a search box) keeps its keys. */
const FIELD = "input, textarea, select";

/**
 * Runs `comment` when the shortcut is pressed with text selected inside the review document under
 * `readingRef`, and only while `enabled` (a caller who may comment now). Outside the document, in a
 * field, or with nothing selected the key is left alone. The owner's editor handles the key itself
 * (`selection-toolbar.ts`), so a press it has taken (`defaultPrevented`) is not taken again.
 */
export function useCommentShortcut(readingRef: RefObject<HTMLElement | null>, enabled: boolean, comment: () => void) {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !isCommentShortcut(event)) return;
      if (event.target instanceof Element && event.target.closest(FIELD)) return;
      const root = readingRef.current?.querySelector<HTMLElement>("[data-review-document]");
      const selection = window.getSelection();
      if (!root || !selection || selection.isCollapsed || !selection.rangeCount || !root.contains(selection.getRangeAt(0).commonAncestorContainer)) return;
      event.preventDefault();
      comment();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [readingRef, enabled, comment]);
}
