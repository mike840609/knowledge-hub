import { expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({services:vi.fn()}));
vi.mock('@/server/composition',()=>({applicationServices:mocks.services}));
import { getKnowledgeExplorerModel } from '@/server/knowledge-read';
it('enumerates other sources without reading their trees even for the sidebar bootstrap',async()=>{
 const current={id:'s',workspaceId:'w',name:'Current'},other={id:'other',workspaceId:'w',name:'Other'};
 const listTree=vi.fn(async()=>[]);
 mocks.services.mockReturnValue({establishTrustedCaller:async()=>({caller:{}}),workspaces:{listWorkspaces:async()=>[{id:'w'}]},queries:{getSource:async()=>current,listSources:async()=>[current,other],listTree}});
 const result=await getKnowledgeExplorerModel('w','s',{includeArchived:true,includeCollections:true});
 expect(listTree).toHaveBeenCalledTimes(1);expect(result?.sources).toHaveLength(2);expect(result?.collections).toHaveLength(1);
});
