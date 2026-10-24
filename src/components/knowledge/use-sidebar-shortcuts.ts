"use client";
import { useEffect, useState } from 'react';
export type SidebarShortcut = { documentId: string; sourceId: string; label: string; sourceName: string; ownership: 'SOURCE_MANAGED' | 'HUB_MANAGED' };
export function useSidebarShortcuts(workspaceId: string, idsKey: string, includeArchived: boolean, snapshot: unknown) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; documents: SidebarShortcut[]; error: boolean } | null>(null);
  const key = `${workspaceId}:${includeArchived}:${idsKey}`;
  useEffect(() => {
    let live = true; const controller = new AbortController();
    const ids = idsKey ? idsKey.split(',') : [];
    if (!ids.length) { setResult({ key, documents: [], error: false }); return; }
    void (async () => {
      const documents: SidebarShortcut[] = [];
      // Bounded requests preserve Show all for accounts with more than 100 favorites.
      for (let i = 0; i < ids.length; i += 100) {
        const response = await fetch(`/api/workspaces/${workspaceId}/sidebar-shortcuts?ids=${ids.slice(i, i + 100).join(',')}&includeArchived=${includeArchived}`, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error();
        documents.push(...(await response.json()).documents);
      }
      if (live) setResult({ key, documents, error: false });
    })().catch(() => { if (live) setResult({ key, documents: [], error: true }); });
    return () => { live = false; controller.abort(); };
  }, [workspaceId, idsKey, includeArchived, key, snapshot, attempt]);
  return { documents: result?.key === key ? result.documents : [], error: result?.key === key && result.error, retry: () => setAttempt(a => a + 1) };
}
