// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { useSidebarShortcuts } from '@/components/knowledge/use-sidebar-shortcuts';
const transitions: (()=>void)[]=[];
vi.mock('react',async original=>({...await original<typeof import('react')>(),startTransition:(run:()=>void)=>{transitions.push(run);}}));
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
afterEach(()=>{vi.unstubAllGlobals();transitions.length=0;});
it.each([true,false])('defers background shortcut response (success=%s) so it cannot interrupt a document navigation',async success=>{
 let answer!: (r:Response)=>void;
 vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>(resolve=>{answer=resolve;})));
 let api!: ReturnType<typeof useSidebarShortcuts>;
 function Host(){api=useSidebarShortcuts('w','d',false,undefined);return null;}
 const host=document.createElement('div'),root=createRoot(host);
 try{
  await act(async()=>root.render(<Host/>));
  await act(async()=>answer(Response.json({documents:[{documentId:'d',label:'Arrived'}]},{status:success?200:503})));
  expect(api.documents).toEqual([]);expect(api.error).toBeFalsy();
  expect(transitions).toHaveLength(1);
  await act(async()=>transitions.splice(0).forEach(run=>run()));
  if(success)expect(api.documents).toEqual([{documentId:'d',label:'Arrived'}]);else expect(api.error).toBe(true);
 }finally{await act(async()=>root.unmount());}
});
