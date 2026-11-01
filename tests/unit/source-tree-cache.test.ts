import { expect, it, vi } from 'vitest';
import { SourceTreeCache, commitSourceTree } from '@/components/knowledge/source-tree-cache';
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
it('a fresh snapshot drops extra cached trees but seeds the updated current tree', async () => {
 const source={id:'s',name:'Source'} as never;
 const old=new SourceTreeCache('w',[],vi.fn().mockResolvedValue(Response.json({tree:[]})));
 await old.ensure('extra');expect(old.snapshot().extra.status).toBe('loaded');
 const fresh=new SourceTreeCache('w',[{source,tree:[]}]);
 expect(fresh.snapshot().extra).toBeUndefined();expect(fresh.snapshot().s.status).toBe('loaded');
});

it('publishes the committed source tree to active caches, not other sources', () => {
 const source={id:'source-a',name:'A'} as never;
 const other={id:'source-b',name:'B'} as never;
 const old=[{id:'a',type:'folder',label:'a',position:0,parentId:null,status:'ACTIVE'}] as never;
 const fresh=[{id:'a',type:'folder',label:'a',position:1,parentId:null,status:'ACTIVE'}] as never;
 const cache=new SourceTreeCache('workspace-commit-1',[{source,tree:old},{source:other,tree:[]}]);
 const seen=vi.fn(); const unsubscribe=cache.subscribe(seen);
 commitSourceTree('workspace-commit-1','source-a',fresh);
 expect(cache.snapshot()['source-a']).toEqual({status:'loaded',tree:fresh});
 expect(cache.snapshot()['source-b']).toEqual({status:'loaded',tree:[]});
 expect(seen).toHaveBeenCalledTimes(1);
 const remounted=new SourceTreeCache('workspace-commit-1',[{source,tree:old}]);
 expect(remounted.snapshot()['source-a']).toEqual({status:'loaded',tree:fresh});
 const reconciled=new SourceTreeCache('workspace-commit-1',[{source,tree:fresh}]);
 expect(reconciled.snapshot()['source-a']).toEqual({status:'loaded',tree:fresh});
 unsubscribe();
});
