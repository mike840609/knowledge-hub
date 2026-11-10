// @vitest-environment jsdom
import { act, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { SourceShareAction, SourceSharedMarker } from '@/components/sources/source-share-action';
import { SourceSidebar } from '@/components/knowledge/source-sidebar';
import { useSourceTrees } from '@/components/knowledge/use-source-trees';
import type { SourceView } from '@/modules/knowledge/application/knowledge-query-service';
vi.mock('next/navigation',()=>({useRouter:()=>({push:vi.fn()}),usePathname:()=>'/w/w/knowledge/a',useSearchParams:()=>new URLSearchParams(),useParams:()=>({})}));
vi.mock('next/link',()=>({default:({children,...props}:React.ComponentProps<'a'>)=> <a {...props}>{children}</a>}));
const auth = vi.hoisted(() => ({ owner: true, confirmed: true, type: 'PERSONAL' }));
vi.mock('@/components/shell/use-workspace-authorization',()=>({useWorkspaceAuthorization:()=>({access:{actions:{},workspace:{type:auth.type},isPersonalOwner:auth.owner},confirmed:auth.confirmed})}));
vi.mock('@/components/knowledge/use-document-shortcuts',()=>({useDocumentShortcuts:()=>({shortcuts:{favorites:[],recent:[]},ready:true,update:vi.fn()}),documentShortcutKey:(s:string,d:string)=>`${s}:${d}`}));
vi.mock('@/components/knowledge/use-tree-mutations',()=>({useTreeMutations:()=>({})}));
const share = vi.hoisted(() => vi.fn());
vi.mock('@/components/actions/action-menu',async(orig)=>({...await orig<object>(),useActionRunner:()=>(a:{effect:{kind:string;sourceId:string;label:string}})=>{if(a.effect.kind==='share-source')share({sourceId:a.effect.sourceId,name:a.effect.label});},requestShare:share}));
// This file counts the fetches a source's tree makes; the tree's share marker has its own request.
vi.mock('@/components/knowledge/shared-folders',()=>({useSharedTargets:()=>({folderIds:new Set<string>(),sourceIds:new Set<string>(['a','b'])})}));
vi.mock('@/components/knowledge/knowledge-tree',()=>({KnowledgeTree:({items}:{items:{label:string}[]})=><div>{items.map(i=><span key={i.label}>{i.label}</span>)}</div>}));
vi.mock('@/components/ui/tooltip',()=>({Tooltip:({children}:{children:React.ReactNode})=>children}));
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const sources=[{id:'a',name:'Alpha',status:'ACTIVE',ownership:'HUB_MANAGED',sourceType:'HUB'},{id:'b',name:'Beta',status:'ACTIVE',ownership:'SOURCE_MANAGED',sourceType:'FOLDER_SYNC'}] as SourceView[];
function Host(){
 const seed=useMemo(()=>[{source:sources[0],tree:[]}],[]);
 const trees=useSourceTrees('w',sources,seed);
 return <SourceSidebar workspaceId="w" source={sources[0]} sources={sources} collections={trees.collections} treeStates={trees.states} ensureTree={trees.ensure} retryTree={trees.retry} includeArchived />;
}
let cleanup:()=>Promise<void>;
afterEach(async()=>{await cleanup?.();vi.unstubAllGlobals();localStorage.clear();sessionStorage.clear();});
it('only expands Beta on demand, displays failure and retries; cached reopen does not fetch',async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(Response.json({}, {status:503})).mockResolvedValue(Response.json({tree:[{type:'document',id:'n',documentId:'d',label:'Beta note',status:'ACTIVE',parentId:null,position:0}]}));
 vi.stubGlobal('fetch',fetcher);
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 cleanup=async()=>{await act(async()=>root.unmount());host.remove();};
 await act(async()=>root.render(<Host/>)); expect(fetcher).not.toHaveBeenCalled();
 const beta=()=>host.querySelector<HTMLButtonElement>('button[aria-controls="collection-b"]')!;
 await act(async()=>beta().click()); expect(fetcher).toHaveBeenCalledTimes(1);expect(host.textContent).toContain('Documents could not be loaded.');
 const retry=Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Retry')!;
 await act(async()=>retry.click()); expect(host.textContent).toContain('Beta note');
 await act(async()=>beta().click());await act(async()=>beta().click());expect(fetcher).toHaveBeenCalledTimes(2);
});
it('restores a saved-open source and loads it once after hydration',async()=>{
 localStorage.setItem('kh:tree-expanded:w',JSON.stringify({b:true}));
 const fetcher=vi.fn().mockResolvedValue(Response.json({tree:[]}));vi.stubGlobal('fetch',fetcher);
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 cleanup=async()=>{await act(async()=>root.unmount());host.remove();};
 await act(async()=>root.render(<Host/>));
 expect(fetcher).toHaveBeenCalledTimes(1);
 expect(host.textContent).not.toContain('Loading documents…');
});

it('only shows source sharing and markers to the confirmed owner for active sources',async()=>{
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 cleanup=async()=>{await act(async()=>root.unmount());host.remove();auth.owner=true;share.mockClear();};
 await act(async()=>root.render(<Host/>));
 expect(host.querySelectorAll('[aria-label="Shared"]')).toHaveLength(2);
 await act(async()=>{host.querySelector<HTMLButtonElement>('button[aria-label="Actions for Alpha"]')!.dispatchEvent(new MouseEvent('click',{bubbles:true}));});
 await act(async()=>Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(e=>e.textContent==='Share link…')!.click());
 expect(share).toHaveBeenCalledWith({sourceId:'a',name:'Alpha'});
 auth.owner=false;
 await act(async()=>root.render(<Host/>));
 expect(host.querySelector('[aria-label="Shared"]')).toBeNull();
 expect(host.querySelector('button[aria-label="Actions for Alpha"]')).toBeNull();
});

it('hides both marker and action for archived sources and non-owners', async()=>{
 const host=document.createElement('div'); document.body.append(host); const root=createRoot(host);
 cleanup=async()=>{await act(async()=>root.unmount());host.remove();auth.owner=true;};
 const view=(status:string)=><><SourceShareAction workspaceId="w" sourceId="a" sourceName="Alpha" status={status}/><SourceSharedMarker workspaceId="w" sourceId="a" status={status}/></>;
 await act(async()=>root.render(view('ARCHIVED')));
 expect(host.querySelector('button')).toBeNull(); expect(host.querySelector('[aria-label="Shared"]')).toBeNull();
 auth.owner=false;
 await act(async()=>root.render(view('ACTIVE')));
 expect(host.querySelector('button')).toBeNull(); expect(host.querySelector('[aria-label="Shared"]')).toBeNull();
});
