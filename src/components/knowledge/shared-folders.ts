"use client";

import { useEffect, useState } from "react";

/** Something about the owner's share links changed, so the markers may have changed. */
export const SHARE_LINKS_CHANGED_EVENT = "kh:share-links-changed";

export function announceShareLinksChanged(): void {
  window.dispatchEvent(new Event(SHARE_LINKS_CHANGED_EVENT));
}

type Targets = { folderIds: ReadonlySet<string>; sourceIds: ReadonlySet<string> };
const NONE: Targets = { folderIds: new Set(), sourceIds: new Set() };
type Entry = {
  value: Targets;
  listeners: Set<(value: Targets) => void>;
  inFlight: Promise<void> | null;
  generation: number;
  lastLoad: number;
  cleanup: () => void;
};
const entries = new Map<string, Entry>();

function subscribe(workspaceId: string, listener: (value: Targets) => void): () => void {
  let entry = entries.get(workspaceId);
  if (!entry) {
    const current: Entry = { value: NONE, listeners: new Set(), inFlight: null, generation: 0, lastLoad: 0, cleanup: () => {} };
    entry = current;
    entries.set(workspaceId, current);
    const load = (force = false) => {
      if (!force && current.inFlight) return;
      const generation = ++current.generation;
      current.lastLoad = Date.now();
      const request = (async () => {
        try {
          const response = await fetch(`/api/workspaces/${workspaceId}/shared-folders`, { cache: "no-store" });
          if (!response.ok) return;
          const body = (await response.json()) as { folders?: { folderNodeId: string }[]; sources?: { sourceId: string }[] };
          if (entries.get(workspaceId) !== current || generation !== current.generation || !Array.isArray(body.folders)) return;
          current.value = { folderIds: new Set(body.folders.map(folder => folder.folderNodeId)), sourceIds: new Set((body.sources ?? []).map(source => source.sourceId)) };
          current.listeners.forEach(notify => notify(current.value));
        } catch {
          // A reminder is not a gate: retain the last successful answer.
        } finally {
          if (generation === current.generation) current.inFlight = null;
        }
      })();
      current.inFlight = request;
    };
    const changed = () => load(true);
    const refresh = () => {
      if (document.visibilityState === "visible" && Date.now() - current.lastLoad >= 1000) load();
    };
    window.addEventListener(SHARE_LINKS_CHANGED_EVENT, changed);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    current.cleanup = () => {
      window.removeEventListener(SHARE_LINKS_CHANGED_EVENT, changed);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
    load();
  }
  entry.listeners.add(listener);
  listener(entry.value);
  const subscribed = entry;
  return () => {
    subscribed.listeners.delete(listener);
    if (subscribed.listeners.size === 0) {
      subscribed.cleanup();
      if (entries.get(workspaceId) === subscribed) entries.delete(workspaceId);
    }
  };
}

/** Shared, workspace-scoped reminders; failed reads retain the last successful answer. */
export function useSharedTargets(workspaceId: string, enabled: boolean): Targets {
  const [snapshot, setSnapshot] = useState<{ workspaceId: string; value: Targets }>({ workspaceId, value: NONE });
  useEffect(() => {
    if (!enabled) {
      setSnapshot({ workspaceId, value: NONE });
      return;
    }
    return subscribe(workspaceId, value => setSnapshot({ workspaceId, value }));
  }, [workspaceId, enabled]);
  return enabled && snapshot.workspaceId === workspaceId ? snapshot.value : NONE;
}
