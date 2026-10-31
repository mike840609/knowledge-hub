// @vitest-environment jsdom
import { act, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { SourceSidebar } from '@/components/knowledge/source-sidebar';
import { useSourceTrees } from '@/components/knowledge/use-source-trees';
import type { SourceView } from '@/modules/knowledge/application/knowledge-query-service';
import type { PublicationListItem } from '@/modules/sources/application/publication-service';
vi.mock('next/navigation',()=>({useRouter:()=>({push:vi.fn()}),usePathname:()=>'/w/w/knowledge/a',useSearchParams:()=>new URLSearchParams(),useParams:()=>({})}));
vi.mock('next/link',()=>({default:({children,...props}:React.ComponentProps<'a'>)=> <a {...props}>{children}</a>}));
vi.mock('@/components/shell/use-workspace-authorization',()=>({useWorkspaceAuthorization:()=>({access:{actions:{},workspace:{type:'PERSONAL'}},confirmed:true})}));
vi.mock('@/components/knowledge/use-document-shortcuts',()=>({useDocumentShortcuts:()=>({shortcuts:{favorites:[],recent:[]},ready:true,update:vi.fn()}),documentShortcutKey:(s:string,d:string)=>`${s}:${d}`}));
vi.mock('@/components/knowledge/use-tree-mutations',()=>({useTreeMutations:()=>({})}));
vi.mock('@/components/actions/action-menu',()=>({useActionRunner:()=>vi.fn()}));
vi.mock('@/components/actions/action-registry',()=>({actionsFor:()=>[]}));
// This file counts the fetches a source's tree makes; the tree's share marker has its own request.
vi.mock('@/components/knowledge/shared-folders',()=>({useSharedFolderIds:()=>new Set<string>()}));
vi.mock('@/components/knowledge/knowledge-tree',()=>({KnowledgeTree:({items,documentPublicationMeta}:{items:{label:string;documentId?:string}[];documentPublicationMeta?:Record<string,{maintainerName:string}>})=><div>{items.map(i=><span key={i.label}>{i.label}{i.documentId&&documentPublicationMeta?.[i.documentId]?`:${documentPublicationMeta[i.documentId].maintainerName}`:''}</span>)}</div>}));
vi.mock('@/components/ui/tooltip',()=>({Tooltip:({children}:{children:React.ReactNode})=>children}));
vi.mock('@/components/ui/toast',()=>({useToast:()=>vi.fn()}));
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const sources=[{id:'a',name:'Alpha',status:'ACTIVE',ownership:'HUB_MANAGED',sourceType:'HUB'},{id:'b',name:'Beta',status:'ACTIVE',ownership:'SOURCE_MANAGED',sourceType:'FOLDER_SYNC'}] as SourceView[];
function Host({publications=[]}:{publications?:PublicationListItem[]}){
 const seed=useMemo(()=>[{source:sources[0],tree:[]}],[]);
 const trees=useSourceTrees('w',sources,seed);
 return <SourceSidebar workspaceId="w" source={sources[0]} sources={sources} collections={trees.collections} treeStates={trees.states} ensureTree={trees.ensure} retryTree={trees.retry} includeArchived publications={publications} />;
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
it('hydrates a collapsed publication document metadata from its lazy tree',async()=>{
 const seeded:PublicationListItem={publication:{id:'p1',sourceId:'b',teamWorkspaceId:'w',name:'Beta',kind:'FOLDER',creatorUserId:'u1',status:'ACTIVE'},creatorName:'Mike',updatedAt:new Date(0),canJoin:false,canManage:false,documents:[],ownContribution:null};
 const hydrated:PublicationListItem={...seeded,documents:[{teamDocumentId:'d',sourcePath:'a.md',status:'ACTIVE',creatorUserId:'u1',creatorName:'Mike',updatedAt:new Date(0),leftAt:null,rightsFrozenAt:null,pendingCatchUp:false}]};
 const fetcher=vi.fn().mockResolvedValue(Response.json({tree:[{type:'document',id:'n',documentId:'d',label:'Beta note',status:'ACTIVE',parentId:null,position:0}],publication:hydrated}));
 vi.stubGlobal('fetch',fetcher);
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 cleanup=async()=>{await act(async()=>root.unmount());host.remove();};
 await act(async()=>root.render(<Host publications={[seeded]}/>));
 expect(host.textContent).not.toContain('Beta note:Mike');
 await act(async()=>host.querySelector<HTMLButtonElement>('button[aria-controls="collection-b"]')!.click());
 await act(async()=>{await new Promise(r=>setTimeout(r,20));});
 expect(host.textContent).toContain('Beta note:Mike');
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
