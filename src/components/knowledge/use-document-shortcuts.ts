"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  emptyDocumentShortcuts,
  parseDocumentShortcuts,
  type DocumentShortcuts,
} from "@/lib/document-shortcuts";
import { readStored, writeStored } from "@/components/shell/use-persisted-state";

/**
 * Favourites and recents, shared by everything that can change them.
 *
 * They used to be read, written and parsed inside the sidebar, which was fine
 * while the sidebar was the only thing that could star a document. The palette
 * and the row menu can now too, and three copies of the same `localStorage`
 * key would have meant a star that only appears after a reload.
 *
 * The broadcast carries the new value rather than a "something changed" ping,
 * so a browser that refuses storage still keeps every mounted view in step for
 * the session — it just does not remember it afterwards. Re-reading storage on
 * the ping would have silently reverted the toggle in exactly that case.
 */
const CHANGED = "kh:document-shortcuts";

type Broadcast = { key: string; value: DocumentShortcuts };

export function documentShortcutKey(sourceId: string, documentId: string): string {
  return `${sourceId}:${documentId}`;
}

export function useDocumentShortcuts(workspaceId: string): {
  shortcuts: DocumentShortcuts;
  update: (change: (previous: DocumentShortcuts) => DocumentShortcuts) => void;
} {
  const storageKey = `kh:document-shortcuts:${workspaceId}`;
  const [shortcuts, setShortcuts] = useState<DocumentShortcuts>(emptyDocumentShortcuts);
  // `update` must not depend on the current value, or every caller would have
  // to re-create its effects whenever a star moved.
  const current = useRef(shortcuts);
  current.current = shortcuts;

  useEffect(() => {
    // Read in an effect, not in the initializer: the server renders this too,
    // and `window.localStorage` throws outright where a browser blocks it.
    setShortcuts(parseDocumentShortcuts(readStored("local", storageKey)));
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<Broadcast>).detail;
      if (detail?.key === storageKey) setShortcuts(detail.value);
    };
    window.addEventListener(CHANGED, onChange);
    return () => window.removeEventListener(CHANGED, onChange);
  }, [storageKey]);

  const update = useCallback(
    (change: (previous: DocumentShortcuts) => DocumentShortcuts) => {
      const next = change(current.current);
      current.current = next;
      setShortcuts(next);
      writeStored("local", storageKey, JSON.stringify(next));
      window.dispatchEvent(
        new CustomEvent<Broadcast>(CHANGED, { detail: { key: storageKey, value: next } }),
      );
    },
    [storageKey],
  );

  return { shortcuts, update };
}
