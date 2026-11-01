import { expect, it, vi } from 'vitest';
import { SourceTreeCache } from '@/components/knowledge/source-tree-cache';
it('deduplicates concurrent expansion and caches even an empty result', async () => {
 let resolve!: (v: unknown) => void;
 const fetcher = vi.fn(() => new Promise(r => {resolve=r;}));
 const cache = new SourceTreeCache('w', [], fetcher as never);
 const first = cache.ensure('s'); const second = cache.ensure('s');
 expect(fetcher).toHaveBeenCalledTimes(1);
 resolve(Response.json({tree:[]})); await Promise.all([first,second]);
 await cache.ensure('s'); expect(fetcher).toHaveBeenCalledTimes(1);
 expect(cache.snapshot().s).toEqual({status:'loaded',tree:[]});
});
it('a failure stays retryable and is not cached as an empty tree', async () => {
 const fetcher=vi.fn().mockRejectedValueOnce(new Error()).mockResolvedValue(Response.json({tree:[]}));
 const cache=new SourceTreeCache('w',[],fetcher); await cache.ensure('s');
 expect(cache.snapshot().s.status).toBe('error');
 await cache.ensure('s'); expect(fetcher).toHaveBeenCalledTimes(1);
 await cache.retry('s'); expect(cache.snapshot().s.status).toBe('loaded');
});
it('late responses cannot update a disposed scope', async () => {
 let resolve!: (v:unknown)=>void;
 const cache=new SourceTreeCache('old',[],vi.fn(()=>new Promise(r=>{resolve=r;})) as never);
 const pending=cache.ensure('s'); cache.dispose(); resolve(Response.json({tree:[]})); await pending;
 expect(cache.snapshot().s.status).not.toBe('loaded');
});
it('stores the publication document views returned with a lazy tree', async () => {
 const publication={publication:{id:'p1',sourceId:'s'},documents:[{teamDocumentId:'d1',creatorName:'Mike'}]};
 const cache=new SourceTreeCache('w',[],vi.fn().mockResolvedValue(Response.json({tree:[],publication})));
 await cache.ensure('s');
 expect(cache.snapshot().s).toEqual({status:'loaded',tree:[],publication});
});
it('a fresh snapshot drops extra cached trees but seeds the updated current tree', async () => {
 const source={id:'s',name:'Source'} as never;
 const old=new SourceTreeCache('w',[],vi.fn().mockResolvedValue(Response.json({tree:[]})));
 await old.ensure('extra');expect(old.snapshot().extra.status).toBe('loaded');
 const fresh=new SourceTreeCache('w',[{source,tree:[]}]);
 expect(fresh.snapshot().extra).toBeUndefined();expect(fresh.snapshot().s.status).toBe('loaded');
});
