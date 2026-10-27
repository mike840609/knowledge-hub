"use client";
import { createContext, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { SourceTreeCache } from './source-tree-cache';
import type { SourceView } from '@/modules/knowledge/application/knowledge-query-service';
export function useSourceTrees(workspaceId: string, sources: SourceView[], current: string | null = null) {
  const previous = useRef<SourceTreeCache | null>(null);
  // The shell owns this, so trees survive navigation inside the workspace. A server refresh supplies new
  // headers, which replaces the cache; old caches have no subscribers, so their replies change nothing.
  // The current source keeps the tree it shows until its page adopts the fresh one, before paint, so its
  // rows are never unmounted: their focus, and what the tree just said aloud, survive the refresh.
  const cache = useMemo(() => {
    const source = sources.find(candidate => candidate.id === current);
    const held = source ? previous.current?.snapshot()[source.id] : undefined;
    return new SourceTreeCache(workspaceId, source && held?.status === 'loaded' ? [{ source, tree: held.tree }] : []);
  }, [workspaceId, sources]); // not `current`: a route change keeps the cache
  useEffect(() => { previous.current = cache; }, [cache]);
  const states = useSyncExternalStore(cache.subscribe, cache.snapshot, cache.snapshot);
  const collections = useMemo(() => sources.flatMap(source => {
    const state = states[source.id]; return state?.status === 'loaded' ? [{ source, tree: state.tree }] : [];
  }), [sources, states]);
  return { states, collections, ensure: cache.ensure, retry: cache.retry, adopt: cache.adopt };
}
export type SourceTrees = ReturnType<typeof useSourceTrees>;
/** The shell's trees; a Knowledge page adopts the tree its layout read into them. */
export const SourceTreesContext = createContext<SourceTrees | null>(null);
