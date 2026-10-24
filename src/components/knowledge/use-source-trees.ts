"use client";
import { useMemo, useSyncExternalStore } from 'react';
import { SourceTreeCache, type SourceCollection } from './source-tree-cache';
import type { SourceView } from '@/modules/knowledge/application/knowledge-query-service';
export function useSourceTrees(workspaceId: string, sources: SourceView[], seed: SourceCollection[]) {
  // A refresh supplies a new seed, invalidating extra trees without affecting expansion preferences.
  // Old caches have no subscribers after replacement, so their replies cannot change the new snapshot.
  const cache = useMemo(() => new SourceTreeCache(workspaceId, seed), [workspaceId, seed]);
  const states = useSyncExternalStore(cache.subscribe, cache.snapshot, cache.snapshot);
  const collections = useMemo(() => sources.flatMap(source => {
    const state = states[source.id]; return state?.status === 'loaded' ? [{ source, tree: state.tree }] : [];
  }), [sources, states]);
  return { states, collections, ensure: cache.ensure, retry: cache.retry };
}
