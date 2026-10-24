// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useSourceTrees } from '@/components/knowledge/use-source-trees';
import type { SourceCollection } from '@/components/knowledge/source-tree-cache';
import type { SourceView } from '@/modules/knowledge/application/knowledge-query-service';
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
it('replaces the real hook cache on refresh and ignores in-flight responses from the old snapshot',async()=>{
 const sources=[{id:'current'},{id:'extra'}] as SourceView[];
 const seed=()=>[{source:sources[0],tree:[]}];
 let api!: ReturnType<typeof useSourceTrees>;
 function Host({initial}:{initial:SourceCollection[]}){api=useSourceTrees('w',sources,initial);return null;}
 let resolve!: (r:Response)=>void;
 vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>(r=>{resolve=r;})));
 const element=document.createElement('div');const root=createRoot(element);
 try {
  await act(async()=>root.render(<Host initial={seed()}/>));
  let pending!: Promise<void>;
  await act(async()=>{pending=api.ensure('extra');});
  expect(api.states.extra.status).toBe('loading');
  await act(async()=>root.render(<Host initial={seed()}/>));
  expect(api.states.extra).toBeUndefined();
  await act(async()=>{resolve(Response.json({tree:[]}));await pending;});
  expect(api.states.extra).toBeUndefined();expect(api.states.current.status).toBe('loaded');
 } finally {await act(async()=>root.unmount());vi.unstubAllGlobals();}
});
