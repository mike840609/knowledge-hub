import { expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({services:vi.fn()}));
vi.mock('@/server/composition',()=>({applicationServices:mocks.services}));
import { getKnowledgeExplorerModel } from '@/server/knowledge-read';
it('400 nodes across four sources: initial bootstrap reads and serializes only 100 current nodes',async()=>{
 const sources=Array.from({length:4},(_,i)=>({id:`s${i}`,name:`Source ${i}`,workspaceId:'w'}));
 const trees=sources.map(source=>Array.from({length:100},(_,i)=>({type:'document',id:`${source.id}-${i}`,documentId:`d${source.id}-${i}`,label:`Document ${i}`,parentId:null,position:i,status:'ACTIVE',currentRevisionId:`r${i}`})));
 const listTree=vi.fn(async(_caller:unknown,id:string)=>trees[Number(id.slice(1))]);
 mocks.services.mockReturnValue({establishTrustedCaller:async()=>({caller:{}}),workspaces:{listWorkspaces:async()=>[{id:'w'}]},queries:{getSource:async()=>sources[0],listSources:async()=>sources,listTree}});
 const result=await getKnowledgeExplorerModel('w','s0',{includeArchived:true,includeCollections:true});
 const oldCollections=sources.map((source,i)=>({source,tree:trees[i]}));
 expect(listTree).toHaveBeenCalledTimes(1);
 expect(result?.collections.flatMap(c=>c.tree)).toHaveLength(100);
 const oldBytes=Buffer.byteLength(JSON.stringify(oldCollections));
 const newBytes=Buffer.byteLength(JSON.stringify({sources:result?.sources,collections:result?.collections}));
 expect(newBytes).toBeLessThan(oldBytes*.3);
 console.info(JSON.stringify({fixtureNodes:400,baselineTreeReads:4,currentTreeReads:listTree.mock.calls.length,baselineCollectionBytes:oldBytes,currentHeadersAndCollectionBytes:newBytes}));
});
