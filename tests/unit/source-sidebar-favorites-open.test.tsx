// @vitest-environment jsdom
import { act, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { SourceSidebar } from '@/components/knowledge/source-sidebar';
import { useSourceTrees } from '@/components/knowledge/use-source-trees';
import type { SourceView } from '@/modules/knowledge/application/knowledge-query-service';
const shortcuts = vi.hoisted(() => ({ current: { favorites: [] as string[], recent: [] as string[], ready: false } }));
vi.mock('next/navigation',()=>({useRouter:()=>({push:vi.fn()}),usePathname:()=>'/w/w/knowledge/a',useSearchParams:()=>new URLSearchParams(),useParams:()=>({})}));
vi.mock('next/link',()=>({default:({children,...props}:React.ComponentProps<'a'>)=> <a {...props}>{children}</a>}));
vi.mock('@/components/shell/use-workspace-authorization',()=>({useWorkspaceAuthorization:()=>({access:{actions:{},workspace:{type:'PERSONAL'}},confirmed:true})}));
vi.mock('@/components/knowledge/use-document-shortcuts',()=>({useDocumentShortcuts:()=>({shortcuts:{favorites:shortcuts.current.favorites,recent:shortcuts.current.recent},ready:shortcuts.current.ready,update:vi.fn()}),documentShortcutKey:(s:string,d:string)=>`${s}:${d}`}));
vi.mock('@/components/knowledge/use-tree-mutations',()=>({useTreeMutations:()=>({})}));
vi.mock('@/components/actions/action-menu',()=>({useActionRunner:()=>vi.fn()}));
vi.mock('@/components/actions/action-registry',()=>({actionsFor:()=>[]}));
vi.mock('@/components/knowledge/knowledge-tree',()=>({KnowledgeTree:()=>null}));
vi.mock('@/components/ui/tooltip',()=>({Tooltip:({children}:{children:React.ReactNode})=>children}));
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const sources=[{id:'a',name:'Alpha',status:'ACTIVE',ownership:'HUB_MANAGED',sourceType:'HUB'}] as SourceView[];
function Host(){
 const seed=useMemo(()=>[{source:sources[0],tree:[]}],[]);
 const trees=useSourceTrees('w',sources,seed);
 return <SourceSidebar workspaceId="w" source={sources[0]} sources={sources} collections={trees.collections} treeStates={trees.states} ensureTree={trees.ensure} retryTree={trees.retry} includeArchived />;
}
const KEY='kh:sidebar-favorites:w';
let cleanup:()=>Promise<void>;
afterEach(async()=>{await cleanup?.();localStorage.clear();shortcuts.current={favorites:[],recent:[],ready:false};});
async function mount(){
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({tree:[]})));
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 const render=()=>act(async()=>root.render(<Host/>));
 cleanup=async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();};
 await render();
 return render;
}
it('a closed Favorites stays closed when the sidebar mounts and its list loads',async()=>{
 localStorage.setItem(KEY,'false');
 const render=await mount();
 shortcuts.current={favorites:['a:1','a:2'],recent:[],ready:true};
 await render();
 expect(localStorage.getItem(KEY)).toBe('false');
});
it('a favorite added after the list loaded opens the section',async()=>{
 localStorage.setItem(KEY,'false');
 shortcuts.current={favorites:['a:1'],recent:[],ready:true};
 const render=await mount();
 shortcuts.current={favorites:['a:1','a:2'],recent:[],ready:true};
 await render();
 expect(localStorage.getItem(KEY)).toBe('true');
});
it('an unfavorite does not open a closed section',async()=>{
 localStorage.setItem(KEY,'false');
 shortcuts.current={favorites:['a:1','a:2'],recent:[],ready:true};
 const render=await mount();
 shortcuts.current={favorites:['a:1'],recent:[],ready:true};
 await render();
 expect(localStorage.getItem(KEY)).toBe('false');
});
