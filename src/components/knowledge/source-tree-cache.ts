import type { KnowledgeTreeItem, SourceView } from '@/modules/knowledge/application/knowledge-query-service';
import type { PublicationListItem } from '@/modules/sources/application/publication-service';
export type SourceCollection = { source: SourceView; tree: KnowledgeTreeItem[] };
export type TreeLoadState =
  | { status: 'loading' | 'error' }
  | {
    status: 'loaded';
    tree: KnowledgeTreeItem[];
    /** A publication's per-document maintainers, returned with its lazy tree. */
    publication?: PublicationListItem;
  };
/** One cache per server snapshot. Pending responses never cross snapshot/workspace boundaries. */
export class SourceTreeCache {
  private states: Record<string, TreeLoadState>;
  private listeners = new Set<() => void>();
  private pending = new Map<string, Promise<void>>();
  private controllers = new Set<AbortController>();
  private disposed = false;
  constructor(private workspaceId: string, seed: SourceCollection[], private fetcher: typeof fetch = (...args) => fetch(...args)) {
    this.states = Object.fromEntries(seed.map(c => [c.source.id, { status: 'loaded', tree: c.tree }]));
  }
  snapshot = () => this.states;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private put(id: string, state: TreeLoadState) {
    if (this.disposed) return;
    this.states = { ...this.states, [id]: state }; this.listeners.forEach(listener => listener());
  }
  ensure = (id: string): Promise<void> => {
    if (this.disposed) return Promise.resolve();
    const pending = this.pending.get(id); if (pending) return pending;
    if (this.states[id]) return Promise.resolve();
    const controller = new AbortController(); this.controllers.add(controller);
    this.put(id, { status: 'loading' });
    const work = (async () => {
      try {
        const response = await this.fetcher(`/api/workspaces/${this.workspaceId}/sources/${id}/tree`, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('Tree unavailable');
        const body = await response.json();
        if (!Array.isArray(body.tree)) throw new Error('Invalid tree response');
        this.put(id, {
          status: 'loaded',
          tree: body.tree,
          ...(body.publication && typeof body.publication === 'object'
            ? { publication: body.publication as PublicationListItem }
            : {}),
        });
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
  dispose() { this.disposed = true; this.controllers.forEach(c => c.abort()); }
}
