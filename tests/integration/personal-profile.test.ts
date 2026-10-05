import {beforeAll,beforeEach,afterAll,expect,it} from "vitest";
import type {Pool} from "mariadb";
import {provisionIsolatedDatabase,disposeIsolatedDatabase} from "../../scripts/db/test-database";
import {runMigrations,type IsolatedDatabaseHandle} from "../../scripts/db/migrate";
import {databaseConfig} from "@/infrastructure/database/mariadb/config";
import {createDatabasePool} from "@/infrastructure/database/mariadb/pool";
import {MariaDbUnitOfWork} from "@/infrastructure/database/mariadb/transaction";
import {buildApplicationServices} from "@/server/composition";
import {createSourceFixture,createDocumentFixture,fixtureCaller,secondFixtureIdentity} from "../fixtures/knowledge";
import {prepareReadingImport} from "../fixtures/folder-reading";
let pool:Pool,handle:IsolatedDatabaseHandle,uow:MariaDbUnitOfWork,s:ReturnType<typeof buildApplicationServices>,ws:string,noteSource:string,folder:string;
beforeAll(async()=>{handle=await provisionIsolatedDatabase("test");pool=createDatabasePool({...databaseConfig("test"),database:handle.databaseName});await runMigrations(pool);uow=new MariaDbUnitOfWork(pool);s=buildApplicationServices(pool);});
beforeEach(async()=>{if(ws)await pool.query("UPDATE workspaces SET workspace_type='TEAM',personal_owner_user_id=NULL WHERE id=?",[ws]);const fixture=await createSourceFixture(pool);ws=fixture.workspaceId;noteSource=fixture.source.id;folder=fixture.folderId;await pool.query("UPDATE workspaces SET name='My Space',workspace_type='PERSONAL',personal_owner_user_id=? WHERE id=?",[fixtureCaller().identity.id,ws]);});
afterAll(async()=>{await pool?.end();if(handle)await disposeIsolatedDatabase(handle);});
async function apply(files:{path:string;text:string}[],sourceId:string|null=null){const result=await s.imports.apply.apply(fixtureCaller(),await prepareReadingImport(uow,ws,sourceId,files));if(result.kind!=="APPLIED")throw Error("fixture");return result;}
const files=(count:number)=>Array.from({length:count},(_,i)=>({path:`${i}.md`,text:`---\nknowledge_id: profile-${i}\n---\n# Article ${i}\nOriginal`}));
it("counts active articles, favorites and folders without loading Markdown or counting drafts",async()=>{
  expect(s).toHaveProperty("personalProfile");
  const note=await createDocumentFixture(pool,noteSource,folder);
  await s.personal.put(fixtureCaller(),ws,`favorite:${note.documentId}`,{favorite:true},0);
  await s.personal.put(fixtureCaller(),ws,"draft:new",{title:"Unsaved",markdown:"draft",baseRevisionId:null},0);
  await apply(files(3));
  const result=await s.personalProfile.get(fixtureCaller(),ws,7);
  expect(result.counts).toEqual({articles:4,synced:3,notes:1,archived:0,folders:1,favorites:1,unread:3,browsed:0});
  expect(result.sync).toEqual({successful:1,failed:0,neverSynced:0,pending:0});
  expect(result.sources[0].articles).toBe(3);
  expect((await s.personalProfile.documents(fixtureCaller(),ws,{filter:"favorites",days:7})).total).toBe(1);
});
it("deduplicates latest unread versions and period changes, excludes move-only changes, and matches drilldowns",async()=>{
  const source=await apply(files(2));
  const edited=files(2).map(f=>({...f,text:f.text.replace("Original","Updated")}));
  await apply(edited,source.sourceId);await apply(edited.map(f=>({...f,path:`moved/${f.path}`})),source.sourceId);
  let result=await s.personalProfile.get(fixtureCaller(),ws,7);
  expect(result.counts.unread).toBe(2);expect(result.changes).toEqual({added:2,updated:2,archived:0});
  const unread=await s.personalProfile.documents(fixtureCaller(),ws,{filter:"unread",days:7});
  expect(unread.total).toBe(2);expect(unread.items).toHaveLength(2);
  const doc=await s.queries.getDocument(fixtureCaller(),unread.items[0].documentId);
  const old=await s.queries.getRevision(fixtureCaller(),doc.documentId,1);
  await s.documentReadProgress.markRead(fixtureCaller(),{workspaceId:ws,documentId:doc.documentId,revisionId:old.id});
  expect((await s.personalProfile.get(fixtureCaller(),ws,7)).counts.unread).toBe(2);
  await s.documentReadProgress.markRead(fixtureCaller(),{workspaceId:ws,documentId:doc.documentId,revisionId:doc.currentRevision.id});
  expect((await s.personalProfile.get(fixtureCaller(),ws,7)).counts.unread).toBe(1);
  await pool.query("UPDATE sync_runs SET completed_at=DATE_SUB(NOW(6),INTERVAL 10 DAY) WHERE source_id=? AND status='APPLIED'",[source.sourceId]);
  result=await s.personalProfile.get(fixtureCaller(),ws,7);expect(result.changes.added).toBe(0);
  expect((await s.personalProfile.get(fixtureCaller(),ws,30)).changes).toEqual({added:2,updated:2,archived:0});
  expect((await s.personalProfile.documents(fixtureCaller(),ws,{filter:"updated",days:30})).total).toBe(2);
});
it("counts only private current previews and separates previews from completed sync attempts",async()=>{
  const source=await apply(files(1));
  const preview=await prepareReadingImport(uow,ws,source.sourceId,files(1));
  expect((await s.personalProfile.get(fixtureCaller(),ws,7)).sync).toEqual({successful:1,failed:0,neverSynced:0,pending:1});
  const pending=await s.personalProfile.syncItems(fixtureCaller(),ws,{filter:"pending"});expect(pending.total).toBe(1);expect(pending.items[0].previewId).toBe(preview);
  await pool.query("UPDATE source_import_snapshots SET expires_at=DATE_SUB(NOW(6),INTERVAL 1 SECOND) WHERE id=?",[preview]);
  expect((await s.personalProfile.get(fixtureCaller(),ws,7)).sync.pending).toBe(0);
});
it("paginates exact matching article totals and excludes archived sources from active counts",async()=>{
  const source=await apply(files(53));
  const first=await s.personalProfile.documents(fixtureCaller(),ws,{filter:"all",days:7});expect(first.total).toBe(53);expect(first.items).toHaveLength(50);expect(first.nextCursor).toBeTruthy();
  const second=await s.personalProfile.documents(fixtureCaller(),ws,{filter:"all",days:7,after:first.nextCursor!});expect(second.items).toHaveLength(3);expect(second.nextCursor).toBeNull();expect(new Set([...first.items,...second.items].map(d=>d.documentId)).size).toBe(53);
  await uow.run(r=>r.documents.updateStatus(first.items[0].documentId,"ARCHIVED",fixtureCaller().identity.id));
  await s.personal.put(fixtureCaller(),ws,`favorite:${first.items[0].documentId}`,{favorite:true},0);
  expect((await s.personalProfile.get(fixtureCaller(),ws,7)).counts).toMatchObject({articles:52,archived:1,favorites:0,unread:52});
  await pool.query("UPDATE knowledge_sources SET status='ARCHIVED',archived_at=NOW(6),archived_by=? WHERE id=?",[fixtureCaller().identity.id,source.sourceId]);
  expect((await s.personalProfile.get(fixtureCaller(),ws,7)).counts).toMatchObject({articles:0,archived:53,folders:0,unread:0});
  expect((await s.personalProfile.documents(fixtureCaller(),ws,{filter:"archived",days:7})).total).toBe(53);
});
it("denies Team and another user's profile and rejects invalid detail filters",async()=>{
  await expect(s.personalProfile.get(fixtureCaller(secondFixtureIdentity),ws,7)).rejects.toMatchObject({code:"WORKSPACE_NOT_FOUND"});
  await expect(s.personalProfile.documents(fixtureCaller(),ws,{filter:"invalid",days:7})).rejects.toMatchObject({code:"INVALID_REQUEST"});
  await expect(s.personalProfile.get(fixtureCaller(),ws,8)).rejects.toMatchObject({code:"INVALID_REQUEST"});
  await pool.query("UPDATE workspaces SET workspace_type='TEAM',personal_owner_user_id=NULL WHERE id=?",[ws]);
  await expect(s.personalProfile.get(fixtureCaller(),ws,7)).rejects.toMatchObject({code:"WORKSPACE_NOT_FOUND"});
});
it("includes new-folder previews and hides stale or other-creator previews",async()=>{
 const initial=await prepareReadingImport(uow,ws,null,files(1));
 expect((await s.personalProfile.get(fixtureCaller(),ws,7)).sync.pending).toBe(1);
 expect((await s.personalProfile.syncItems(fixtureCaller(),ws,{filter:"pending"})).items[0].sourceId).toBeNull();
 await pool.query("UPDATE source_import_snapshots SET expires_at=DATE_SUB(NOW(6),INTERVAL 1 SECOND) WHERE id=?",[initial]);
 const source=await apply(files(1));
 const stale=await prepareReadingImport(uow,ws,source.sourceId,files(1));
 await pool.query("UPDATE knowledge_sources SET sync_version=sync_version+1 WHERE id=?",[source.sourceId]);
 expect((await s.personalProfile.get(fixtureCaller(),ws,7)).sync.pending).toBe(0);
 await pool.query("UPDATE knowledge_sources SET sync_version=sync_version-1 WHERE id=?",[source.sourceId]);
 await pool.query("UPDATE source_import_snapshots SET created_by=? WHERE id=?",[secondFixtureIdentity.id,stale]);
 expect((await s.personalProfile.get(fixtureCaller(),ws,7)).sync.pending).toBe(0);
 expect((await s.personalProfile.syncItems(fixtureCaller(),ws,{filter:"folders"})).total).toBe(1);
});
it("does not mistake a no-change sync for missing historical changes",async()=>{
 const source=await apply(files(1));await apply(files(1),source.sourceId);
 expect((await s.personalProfile.get(fixtureCaller(),ws,7)).legacyChangesUnavailable).toBe(false);
 await pool.query("DELETE c FROM sync_run_changes c JOIN sync_runs r ON r.id=c.run_id WHERE r.source_id=?",[source.sourceId]);
 const result=await s.personalProfile.get(fixtureCaller(),ws,7);
 expect(result.legacyChangesUnavailable).toBe(true);expect(result.changes).toEqual({added:0,updated:0,archived:0});
});
it("keeps overview totals and distribution consistent when a sync commits during the read",async()=>{
 const source=await apply(files(1));const raw=await pool.getConnection();
 try{
  await raw.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");await raw.beginTransaction();let changed=false;
  const {MariaDbPersonalProfileRepository}=await import("@/infrastructure/database/mariadb/repositories/personal-profile");
  const repository=new MariaDbPersonalProfileRepository({query:async(sql:string,params?:unknown[])=>{const result=await raw.query(sql,params);if(!changed){changed=true;await apply(files(2),source.sourceId);}return result;}} as never);
  const result=await repository.overview({userId:fixtureCaller().identity.id,workspaceId:ws,since:new Date(Date.now()-7*86400000),now:new Date()});
  expect(result.sources.reduce((sum,source)=>sum+source.articles,0)).toBeLessThanOrEqual(result.counts.synced);
  await raw.commit();
 }finally{await raw.rollback();raw.release();}
});
it("keeps detail totals and items consistent when an article appears during the read",async()=>{
 const raw=await pool.getConnection();
 try{
  await raw.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");await raw.beginTransaction();let changed=false;
  const {MariaDbPersonalProfileRepository}=await import("@/infrastructure/database/mariadb/repositories/personal-profile");
  const repository=new MariaDbPersonalProfileRepository({query:async(sql:string,params?:unknown[])=>{const result=await raw.query(sql,params);if(!changed){changed=true;await createDocumentFixture(pool,noteSource,folder);}return result;}} as never);
  const result=await repository.documents({userId:fixtureCaller().identity.id,workspaceId:ws,since:new Date(Date.now()-7*86400000),now:new Date()},"all");
  expect(result.items.length).toBeLessThanOrEqual(result.total);
  await raw.commit();
 }finally{await raw.rollback();raw.release();}
});
