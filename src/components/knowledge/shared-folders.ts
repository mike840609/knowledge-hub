"use client";

import { useEffect, useState } from "react";

/** Something about the owner's share links changed (a link made or revoked), so what the tree marks may have. */
export const SHARE_LINKS_CHANGED_EVENT = "kh:share-links-changed";

export function announceShareLinksChanged(): void {
  window.dispatchEvent(new Event(SHARE_LINKS_CHANGED_EVENT));
}

const NONE: ReadonlySet<string> = new Set();

/**
 * The ids of the folders with a link open now, for the tree's marker (folder share spec §8): read once
 * when the workspace loads and again whenever the share dialog says a link was made or revoked. A
 * reminder, not a decision, so a failed read leaves the last answer rather than raising anything.
 */
export function useSharedFolderIds(workspaceId: string, enabled: boolean): ReadonlySet<string> {
  const [ids, setIds] = useState<ReadonlySet<string>>(NONE);
  useEffect(() => {
    if (!enabled) {
      setIds(NONE);
      return;
    }
    let live = true;
    let latest = 0;
    const load = async () => {
      const ticket = ++latest;
      try {
        const response = await fetch(`/api/workspaces/${workspaceId}/shared-folders`, { cache: "no-store" });
        if (!response.ok) return;
        const body = (await response.json()) as { folders?: { folderNodeId: string }[] };
        if (live && ticket === latest && Array.isArray(body.folders)) setIds(new Set(body.folders.map((folder) => folder.folderNodeId)));
      } catch {
        // Keep the last answer.
      }
    };
    // A link can expire while the tab stays open; come back to the answer when the owner returns.
    // `visibilitychange` alone covers that: a tab regaining focus is also visible, so listening to
    // both would read the same answer twice.
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    void load();
    window.addEventListener(SHARE_LINKS_CHANGED_EVENT, load);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      live = false;
      window.removeEventListener(SHARE_LINKS_CHANGED_EVENT, load);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [workspaceId, enabled]);
  return ids;
}
