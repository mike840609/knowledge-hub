import { expect, it, vi } from 'vitest';
import { readSourceTree, readSidebarShortcuts } from '@/server/source-tree-read';
const caller = {} as never;
it('refuses a source belonging to a different workspace before loading its tree', async () => {
 const listTree = vi.fn();
 const services = {queries:{getSource:async () => ({workspaceId:'other'}),listTree}} as never;
 await expect(readSourceTree(services,caller,'w','s')).rejects.toThrow();
 expect(listTree).not.toHaveBeenCalled();
});
it('loads exactly the requested source inclusively', async () => {
 const listTree = vi.fn(async () => []);
 const services = {queries:{getSource:async () => ({workspaceId:'w'}),listTree}} as never;
 await expect(readSourceTree(services,caller,'w','s')).resolves.toHaveProperty('tree',[]);
 expect(listTree).toHaveBeenCalledTimes(1); expect(listTree).toHaveBeenCalledWith(caller,'s',{includeArchived:true});
});
it('returns a publication document views with the lazy tree for a collapsed team source', async () => {
 const item = {
  publication: { id: 'p1', sourceId: 's', teamWorkspaceId: 'w', name: 'HCM', kind: 'FOLDER', creatorUserId: 'u1', status: 'ACTIVE' },
  creatorName: 'Mike', updatedAt: new Date(), canJoin: false, canManage: false,
  documents: [{ teamDocumentId: 'd1', sourcePath: 'a.md', status: 'ACTIVE', creatorUserId: 'u1', creatorName: 'Mike', updatedAt: new Date(), leftAt: null, rightsFrozenAt: null, pendingCatchUp: false }],
  ownContribution: null,
 };
 const list = vi.fn(async () => [item]);
 const services = {queries:{getSource:async () => ({workspaceId:'w'}),listTree:async () => []},publications:{list}} as never;
 const result = await readSourceTree(services,caller,'w','s');
 expect(result).toMatchObject({publication:{documents:[{teamDocumentId:'d1',creatorName:'Mike'}]}});
 expect(list).toHaveBeenCalledWith(caller,'w',true,{includeDocuments:true,documentsSourceId:'s'});
});
it('a publication metadata failure never fails the tree', async () => {
 const services = {queries:{getSource:async () => ({workspaceId:'w'}),listTree:async () => []},publications:{list:async () => {throw new Error('caption');}}} as never;
 await expect(readSourceTree(services,caller,'w','s')).resolves.toMatchObject({publication:null,tree:[]});
});
it('shortcut metadata is independent of trees and contains no body', async () => {
 const services = {queries:{listSources:async () => [{id:'s',name:'Source'}],listDocumentSummaries:async () => [{documentId:'d',sourceId:'s',title:'Title',ownership:'HUB_MANAGED',status:'ACTIVE',sourceStatus:'ACTIVE',markdown:'secret'}]}} as never;
 expect(await readSidebarShortcuts(services,caller,'w',['d'],false)).toEqual([{documentId:'d',sourceId:'s',label:'Title',sourceName:'Source',ownership:'HUB_MANAGED',pageIcon:null}]);
});
