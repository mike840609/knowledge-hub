"use client";
import { createContext, useMemo, useSyncExternalStore } from 'react';
import { SourceTreeCache } from './source-tree-cache';
import type { SourceView } from '@/modules/knowledge/application/knowledge-query-service';
export function useSourceTrees(workspaceId: string, sources: SourceView[]) {
  // The shell owns this, so trees survive navigation inside the workspace. A server refresh supplies new
  // headers, which replaces the cache; old caches have no subscribers, so their replies change nothing.
  const cache = useMemo(() => new SourceTreeCache(workspaceId, []), [workspaceId, sources]);
  const states = useSyncExternalStore(cache.subscribe, cache.snapshot, cache.snapshot);
  const collections = useMemo(() => sources.flatMap(source => {
    const state = states[source.id]; return state?.status === 'loaded' ? [{ source, tree: state.tree }] : [];
  }), [sources, states]);
  return { states, collections, ensure: cache.ensure, retry: cache.retry, adopt: cache.adopt };
}
export type SourceTrees = ReturnType<typeof useSourceTrees>;
/** The shell's trees; a Knowledge page adopts the tree its layout read into them. */
export const SourceTreesContext = createContext<SourceTrees | null>(null);
