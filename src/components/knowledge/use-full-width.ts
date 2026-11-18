"use client";

import { useSyncExternalStore } from "react";
import { readStored, writeStored } from "@/components/shell/use-persisted-state";

/**
 * Full width: the reader's own arrangement of a document page (2026-11-20 page-chrome spec), kept in this browser. One store for
 * every surface that draws a document pane and for the header's checked menu item, so no page of a kind that cannot toggle it sits at a
 * different width than the rest. Read synchronously on the client (the first server render is the narrow one), so a page opened
 * by a link in the app is drawn at its width at once.
 */
const KEY = "kh.document-full-width";
const EVENT = "kh:full-width";
// Where storage is blocked the choice still lasts for this page.
let memory: boolean | null = null;
const read = () => memory ?? readStored("local", KEY) === "true";

function subscribe(listener: () => void) {
  window.addEventListener(EVENT, listener);
  window.addEventListener("storage", listener);
  return () => { window.removeEventListener(EVENT, listener); window.removeEventListener("storage", listener); };
}

export function useFullWidth(): boolean {
  return useSyncExternalStore(subscribe, read, () => false);
}

export function toggleFullWidth() {
  const next = !read();
  writeStored("local", KEY, String(next));
  // What is stored is what every tab reads (a `storage` event from another tab must be heard); the page keeps the choice
  // itself only where storage refused it.
  memory = readStored("local", KEY) === String(next) ? null : next;
  window.dispatchEvent(new Event(EVENT));
}
