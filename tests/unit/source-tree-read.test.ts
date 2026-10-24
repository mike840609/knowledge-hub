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
it('shortcut metadata is independent of trees and contains no body', async () => {
 const services = {queries:{listSources:async () => [{id:'s',name:'Source'}],listDocumentSummaries:async () => [{documentId:'d',sourceId:'s',title:'Title',ownership:'HUB_MANAGED',status:'ACTIVE',sourceStatus:'ACTIVE',markdown:'secret'}]}} as never;
 expect(await readSidebarShortcuts(services,caller,'w',['d'],false)).toEqual([{documentId:'d',sourceId:'s',label:'Title',sourceName:'Source',ownership:'HUB_MANAGED'}]);
});
