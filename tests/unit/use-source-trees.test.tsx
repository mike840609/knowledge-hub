// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { useSourceTrees } from '@/components/knowledge/use-source-trees';
import type { SourceView } from '@/modules/knowledge/application/knowledge-query-service';
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const headers=()=>[{id:'current'},{id:'extra'}] as SourceView[];
let api!: ReturnType<typeof useSourceTrees>;
const rendered:unknown[]=[];
function Host({sources,current=null}:{sources:SourceView[];current?:string|null}){api=useSourceTrees('w',sources,current);rendered.push(api.states.current);return null;}
let cleanup:()=>Promise<void>;
afterEach(async()=>{await cleanup?.();vi.unstubAllGlobals();});
function mount(){const root=createRoot(document.createElement('div'));cleanup=async()=>{await act(async()=>root.unmount());};return root;}
it('replaces the cache on a server refresh and ignores in-flight responses from the old snapshot',async()=>{
 let resolve!: (r:Response)=>void;
 vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>(r=>{resolve=r;})));
 const root=mount();
 await act(async()=>root.render(<Host sources={headers()}/>));
 await act(async()=>api.adopt([{source:{id:'current'} as SourceView,tree:[]}]));
 let pending!: Promise<void>;
 await act(async()=>{pending=api.ensure('extra');});
 expect(api.states.extra.status).toBe('loading');
 await act(async()=>root.render(<Host sources={headers()}/>));
 expect(api.states).toEqual({});
 await act(async()=>{resolve(Response.json({tree:[]}));await pending;});
 expect(api.states.extra).toBeUndefined();
});
it('keeps loaded trees while the headers are the same, as on a route change inside the workspace',async()=>{
 const fetcher=vi.fn().mockResolvedValue(Response.json({tree:[]}));vi.stubGlobal('fetch',fetcher);
 const sources=headers();const root=mount();
 await act(async()=>root.render(<Host sources={sources}/>));
 await act(async()=>api.ensure('extra'));
 await act(async()=>root.render(<Host sources={sources}/>));
 expect(api.states.extra.status).toBe('loaded');
 await act(async()=>api.ensure('extra'));
 expect(fetcher).toHaveBeenCalledTimes(1);
});
it('adopts a tree the server read, replacing a failed or older copy, without a request',async()=>{
 const fetcher=vi.fn().mockResolvedValue(Response.json({},{status:503}));vi.stubGlobal('fetch',fetcher);
 const sources=headers();const root=mount();
 await act(async()=>root.render(<Host sources={sources}/>));
 await act(async()=>api.ensure('current'));
 expect(api.states.current.status).toBe('error');
 const tree=[{type:'document',id:'n',documentId:'d',label:'Seeded',status:'ACTIVE',parentId:null,position:0}] as never;
 await act(async()=>api.adopt([{source:sources[0],tree}]));
 expect(api.collections).toEqual([{source:sources[0],tree}]);
 expect(fetcher).toHaveBeenCalledTimes(1);
});
it('keeps the current source\'s tree through a refresh, so its rows never unmount, and still drops the others',async()=>{
 const fetcher=vi.fn().mockResolvedValue(Response.json({tree:[]}));vi.stubGlobal('fetch',fetcher);
 const tree=[{type:'document',id:'n',documentId:'d',label:'Held',status:'ACTIVE',parentId:null,position:0}] as never;
 const root=mount();
 await act(async()=>root.render(<Host sources={headers()} current="current"/>));
 await act(async()=>api.adopt([{source:{id:'current'} as SourceView,tree}]));
 await act(async()=>api.ensure('extra'));
 rendered.length=0;
 await act(async()=>root.render(<Host sources={headers()} current="current"/>));
 expect(rendered.length).toBeGreaterThan(0);
 expect(rendered.every(state=>(state as {tree?:unknown})?.tree===tree)).toBe(true);
 expect(api.states.extra).toBeUndefined();
});
it('carries nothing when no source is current, or the current one is gone from the refreshed headers',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({tree:[]})));
 const root=mount();
 await act(async()=>root.render(<Host sources={headers()}/>));
 await act(async()=>api.ensure('current'));
 await act(async()=>root.render(<Host sources={headers()}/>));
 expect(api.states).toEqual({});
 await act(async()=>root.render(<Host sources={headers()} current="current"/>));
 await act(async()=>api.ensure('current'));
 await act(async()=>root.render(<Host sources={[{id:'extra'} as SourceView]} current="current"/>));
 expect(api.states).toEqual({});
});
