"use client";
import { useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { SourceTreeCache, type SourceCollection, type TreeLoadState } from './source-tree-cache';
import type { SourceView } from '@/modules/knowledge/application/knowledge-query-service';

function loadedCollections(sources: SourceView[], states: Record<string, TreeLoadState>): SourceCollection[] {
  return sources.flatMap(source => {
    const state = states[source.id];
    return state?.status === 'loaded' ? [{ source, tree: state.tree }] : [];
  });
}

export function useSourceTrees(workspaceId: string, sources: SourceView[], seed?: SourceCollection[]) {
  const previous = useRef<{ workspaceId: string; cache: SourceTreeCache } | null>(null);
  const headerSnapshot = seed ? null : sources;
  // Layouts that supply only headers get a new snapshot on router.refresh().
  // Keep their previous rows until each requested tree has been revalidated.
  const cache = useMemo(() => {
    const prior = previous.current;
    const retained = headerSnapshot && prior?.workspaceId === workspaceId
      ? loadedCollections(headerSnapshot, prior.cache.snapshot())
      : [];
    return new SourceTreeCache(workspaceId, seed ?? [], undefined, retained);
  }, [workspaceId, seed, headerSnapshot]);
  useLayoutEffect(() => {
    previous.current = { workspaceId, cache };
  }, [workspaceId, cache]);
  const states = useSyncExternalStore(cache.subscribe, cache.snapshot, cache.snapshot);
  const collections = useMemo(() => loadedCollections(sources, states), [sources, states]);
  return { states, collections, ensure: cache.ensure, retry: cache.retry };
}
