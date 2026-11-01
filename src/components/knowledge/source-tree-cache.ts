import type { KnowledgeTreeItem, SourceView } from '@/modules/knowledge/application/knowledge-query-service';
export type SourceCollection = { source: SourceView; tree: KnowledgeTreeItem[] };
export type TreeLoadState = { status: 'loading' | 'error' } | { status: 'loaded'; tree: KnowledgeTreeItem[] };

// A PATCH must publish the authoritative source, rather than waiting for an arbitrary
// array change from the router: loading another source also recreates the sidebar's arrays.
// Bridge a short-lived stale RSC seed after PATCH without masking later
// authoritative server updates indefinitely.
const COMMITTED_BRIDGE_MS = 60_000;
const committed = new Map<string, { tree: KnowledgeTreeItem[]; expiresAt: number }>();

function committedTree(key: string): KnowledgeTreeItem[] | undefined {
  const snapshot = committed.get(key);
  if (!snapshot) return undefined;
  if (Date.now() >= snapshot.expiresAt) { committed.delete(key); return undefined; }
  return snapshot.tree;
}
type CommitListener = (workspaceId: string, sourceId: string, tree: KnowledgeTreeItem[]) => void;
const listeners = new Set<CommitListener>();
const keyFor = (workspaceId: string, sourceId: string) => `${workspaceId}:${sourceId}`;

function equalTree(left: KnowledgeTreeItem[], right: KnowledgeTreeItem[]): boolean {
  if (left.length !== right.length) return false;
  const byId = new Map(right.map(node => [node.id, node]));
  return left.every(node => {
    const other = byId.get(node.id);
    return other?.parentId === node.parentId && other.position === node.position && other.status === node.status;
  });
}

/**
 * Confirm that the UI shows the committed source snapshot, not merely a newly
 * allocated array caused by a different source's lazy load. Normal explorer
 * mode hides archived nodes and their descendants.
 */
export function matchesCommittedTreeView(displayed: KnowledgeTreeItem[], authoritative: KnowledgeTreeItem[], includeArchived = false): boolean {
  if (includeArchived) return equalTree(displayed, authoritative);
  const byId = new Map(authoritative.map(node => [node.id, node]));
  const visible = authoritative.filter(node => {
    const visited = new Set<string>();
    for (let cursor: KnowledgeTreeItem | undefined = node; cursor; cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined) {
      if (cursor.status === 'ARCHIVED') return false;
      if (visited.has(cursor.id)) return false;
      visited.add(cursor.id);
    }
    return true;
  });
  return equalTree(displayed, visible);
}

export function commitSourceTree(workspaceId: string, sourceId: string, tree: KnowledgeTreeItem[]): void {
  committed.set(keyFor(workspaceId, sourceId), { tree, expiresAt: Date.now() + COMMITTED_BRIDGE_MS });
  for (const listener of listeners) listener(workspaceId, sourceId, tree);
}

/** One cache per server snapshot. Pending responses never cross snapshot/workspace boundaries. */
export class SourceTreeCache {
  private states: Record<string, TreeLoadState>;
  private listeners = new Set<() => void>();
  private pending = new Map<string, Promise<void>>();
  private controllers = new Set<AbortController>();
  private unsubscribeCommit: (() => void) | null = null;
  private disposed = false;
  constructor(private workspaceId: string, seed: SourceCollection[], private fetcher: typeof fetch = (...args) => fetch(...args)) {
    this.states = Object.fromEntries(seed.map(c => {
      const key = keyFor(workspaceId, c.source.id);
      const latest = committedTree(key);
      if (latest && equalTree(latest, c.tree)) {
        // This fresh RSC seed acknowledges the committed placement; use its
        // current labels/revisions/metadata, not the old committed copy.
        committed.delete(key);
        return [c.source.id, { status: 'loaded', tree: c.tree }];
      }
      return [c.source.id, { status: 'loaded', tree: latest ?? c.tree }];
    }));
  }
  snapshot = () => this.states;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    if (!this.unsubscribeCommit) {
      const receive: CommitListener = (workspaceId, sourceId, tree) => {
        if (workspaceId === this.workspaceId) this.put(sourceId, { status: 'loaded', tree });
      };
      listeners.add(receive);
      this.unsubscribeCommit = () => listeners.delete(receive);
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) { this.unsubscribeCommit?.(); this.unsubscribeCommit = null; }
    };
  };
  private put(id: string, state: TreeLoadState) {
    if (this.disposed) return;
    const latest = committedTree(keyFor(this.workspaceId, id));
    if (latest && state.status === 'loaded' && !equalTree(latest, state.tree)) {
      state = { status: 'loaded', tree: latest };
    }
    this.states = { ...this.states, [id]: state }; this.listeners.forEach(listener => listener());
  }
  ensure = (id: string): Promise<void> => {
    if (this.disposed) return Promise.resolve();
    const pending = this.pending.get(id); if (pending) return pending;
    if (this.states[id]) return Promise.resolve();
    const latest = committedTree(keyFor(this.workspaceId, id));
    if (latest) { this.put(id, { status: 'loaded', tree: latest }); return Promise.resolve(); }
    const controller = new AbortController(); this.controllers.add(controller);
    this.put(id, { status: 'loading' });
    const work = (async () => {
      try {
        const response = await this.fetcher(`/api/workspaces/${this.workspaceId}/sources/${id}/tree`, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('Tree unavailable');
        const body = await response.json();
        if (!Array.isArray(body.tree)) throw new Error('Invalid tree response');
        this.put(id, { status: 'loaded', tree: body.tree });
      } catch { if (!controller.signal.aborted) this.put(id, { status: 'error' }); }
      finally { this.pending.delete(id); this.controllers.delete(controller); }
    })();
    this.pending.set(id, work); return work;
  };
  retry = (id: string) => {
    if (this.states[id]?.status === 'error') {
      const next = { ...this.states }; delete next[id]; this.states = next;
    }
    return this.ensure(id);
  };
  dispose() { this.disposed = true; this.unsubscribeCommit?.(); this.unsubscribeCommit = null; this.controllers.forEach(c => c.abort()); }
}
