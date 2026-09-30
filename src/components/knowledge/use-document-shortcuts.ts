"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useWorkspaceAuthorization } from "@/components/shell/use-workspace-authorization";
import { migrateLocalFavorites, enqueueFavoriteWrite, pendingFavoriteWrites } from "@/lib/favorite-sync";
import { useToast } from "@/components/ui/toast";
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
  const { access } = useWorkspaceAuthorization();
  const personal = access.workspace.type === "PERSONAL";
  const toast = useToast();
  const generation = useRef(0);
  const storageKey = `kh:document-shortcuts:${workspaceId}`;
  const [shortcuts, setShortcuts] = useState<DocumentShortcuts>(emptyDocumentShortcuts);
  // `update` must not depend on the current value, or every caller would have
  // to re-create its effects whenever a star moved.
  const current = useRef(shortcuts);
  current.current = shortcuts;

  useEffect(() => {
    // Read in an effect, not in the initializer: the server renders this too,
    // and `window.localStorage` throws outright where a browser blocks it.
    const cached = parseDocumentShortcuts(readStored("local", storageKey));
    current.current = cached;
    setShortcuts(cached);
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<Broadcast>).detail;
      if (detail?.key === storageKey) {
        if (JSON.stringify(detail.value.favorites) !== JSON.stringify(current.current.favorites)) generation.current++;
        current.current = detail.value; setShortcuts(detail.value);
      }
    };
    window.addEventListener(CHANGED, onChange);
    let live = true;
    const refresh = async () => {
      if (!personal) return;
      const requestGeneration = generation.current;
      try {
        await migrateLocalFavorites(workspaceId);
        await pendingFavoriteWrites(workspaceId).catch(() => {});
        const response = await fetch(`/api/workspaces/${workspaceId}/personal`, { cache: "no-store" });
        if (!response.ok) throw new Error();
        const items = await response.json() as { key: string; sourceId?: string }[];
        if (!live || requestGeneration !== generation.current) return;
        const next = { ...current.current, favorites: items.filter(i => i.key.startsWith("favorite:") && i.sourceId).map(i => `${i.sourceId}:${i.key.split(":")[1]}`) };
        current.current = next;
        setShortcuts(next);
        writeStored("local", storageKey, JSON.stringify(next));
      } catch { if (live) toast({ message: "Favorites could not sync. Showing this device’s saved list.", tone: "danger" }); }
    };
    void refresh();
    window.addEventListener("focus", refresh);
    return () => { live = false; window.removeEventListener(CHANGED, onChange); window.removeEventListener("focus", refresh); };
  }, [storageKey, workspaceId, personal, toast]);

  const update = useCallback(
    (change: (previous: DocumentShortcuts) => DocumentShortcuts) => {
      const before = current.current;
      const next = change(before);
      if (JSON.stringify(next.favorites) !== JSON.stringify(before.favorites)) generation.current++;
      current.current = next;
      setShortcuts(next);
      writeStored("local", storageKey, JSON.stringify(next));
      window.dispatchEvent(new CustomEvent<Broadcast>(CHANGED, { detail: { key: storageKey, value: next } }));
      if (personal) {
        const changed = [...new Set([...before.favorites, ...next.favorites])].filter(key => before.favorites.includes(key) !== next.favorites.includes(key));
        for (const key of changed) {
          const selected = next.favorites.includes(key);
          void enqueueFavoriteWrite(workspaceId, async () => {
            const itemKey = `favorite:${key.split(":")[1]}`;
            const endpoint = `/api/workspaces/${workspaceId}/personal`;
            const response = await fetch(`${endpoint}?key=${encodeURIComponent(itemKey)}`, { cache: "no-store" });
            if (!response.ok) throw new Error();
            const item = await response.json() as { version: number };
            const saved = await fetch(endpoint, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: itemKey, value: selected ? { favorite: true } : null, version: item.version }) });
            if (!saved.ok) throw new Error();
          }).catch(() => {
            const favorites = current.current.favorites.filter(k => k !== key);
            if (!selected) favorites.push(key);
            const reverted = { ...current.current, favorites };
            current.current = reverted; setShortcuts(reverted);
            writeStored("local", storageKey, JSON.stringify(reverted));
            window.dispatchEvent(new CustomEvent<Broadcast>(CHANGED, { detail: { key: storageKey, value: reverted } }));
            toast({ message: "Favorite was not saved. Please try again.", tone: "danger" });
          });
        }
      }
    },
    [storageKey, workspaceId, personal, toast],
  );

  return { shortcuts, update };
}
