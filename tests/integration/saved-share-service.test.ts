import { afterAll, beforeAll, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { RandomShareTokenIssuer } from "@/infrastructure/security/random-share-token-issuer";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import { DocumentShareService } from "@/modules/knowledge/application/document-share-service";
import { SavedShareService } from "@/modules/knowledge/application/saved-share-service";
import { HubKnowledgeCommandServiceImpl } from "@/modules/knowledge/application/hub-knowledge-command-service";
import { PersonalService } from "@/modules/personal/application/personal-service";
import { MariaDbPersonalStore } from "@/infrastructure/database/mariadb/repositories/personal-items";
import { KnowledgeQueryServiceImpl } from "@/modules/knowledge/application/knowledge-query-service";
import { ensureDefaultHubSource } from "@/modules/sources/application/ensure-default-hub-source";
import { PersonalWorkspaceService } from "@/modules/workspaces/application/personal-workspace-service";
import { uuidv7 } from "@/shared/ids/uuidv7";
let pool: Pool;
beforeAll(() => { pool = createDatabasePool(databaseConfig("test")); });
afterAll(async () => pool.end());
async function fixture() {
  const id = uuidv7(), uow = new MariaDbUnitOfWork(pool);
  const caller = callerFromIdentity({ id, emp_id: `SAVED-${id}`, name: "Saved Owner", org_code: "SAVED" });
  await uow.run(r => r.users.upsertIdentity(caller.identity));
  const { workspace } = await new PersonalWorkspaceService(uow).ensurePersonalWorkspace(id);
  const sourceId = await ensureDefaultHubSource(uow, caller, workspace.id);
  const { documentId } = await new HubKnowledgeCommandServiceImpl(uow).createDocument(caller, { sourceId, parentId: null, title: "Saved %_! guide", markdown: "private body", metadata: {} });
  const now = new Date("2026-10-12T00:00:00Z");
  const shares = new DocumentShareService(uow, new RandomShareTokenIssuer(), () => now);
  const saved = new SavedShareService(uow, () => now);
  const link = await shares.create(caller, { documentId });
  return { caller, workspace, sourceId, documentId, shares, saved, uow, now, link, token: link.path.slice(3) };
}
it("saves live foreign shares without membership, isolates recipient and preserves favorites authorization", async () => {
  const owner = await fixture(), reader = await fixture(), other = await fixture();
  const result = await reader.saved.save(reader.caller, owner.token);
  expect(result).toMatchObject({ saved: true, workspaceId: reader.workspace.id });
  expect(await reader.saved.state(reader.caller, owner.token)).toEqual(result);
  expect(await other.saved.state(other.caller, owner.token)).toMatchObject({ saved: false, id: null });
  const list = await reader.saved.list(reader.caller, reader.workspace.id, {});
  expect(list.items).toHaveLength(1); expect(list.items[0]).toMatchObject({ title: "Saved %_! guide", status: "available", path: owner.link.path });
  expect(JSON.stringify(list)).not.toContain("private body");
  await expect(other.saved.list(other.caller, reader.workspace.id, {})).rejects.toBeDefined();
  await expect(other.saved.remove(other.caller, result.id!)).rejects.toBeDefined();
  const personal = new PersonalService(new MariaDbPersonalStore(pool), new KnowledgeQueryServiceImpl(reader.uow), reader.uow);
  await expect(personal.put(reader.caller, reader.workspace.id, `favorite:${owner.documentId}`, { favorite: true }, 0)).rejects.toBeDefined();
  expect((await owner.shares.list(owner.caller, owner.documentId))[0].totalViews).toBe(0);
});
it("deduplicates concurrent saves, revives removed records and keeps separate links independent", async () => {
  const owner = await fixture(), reader = await fixture();
  const results = await Promise.all([reader.saved.save(reader.caller, owner.token), reader.saved.save(reader.caller, owner.token)]);
  expect(results[0].id).toBe(results[1].id);
  await reader.saved.remove(reader.caller, results[0].id!); await reader.saved.remove(reader.caller, results[0].id!);
  expect(await reader.saved.state(reader.caller, owner.token)).toMatchObject({ saved: false });
  expect((await reader.saved.save(reader.caller, owner.token)).id).toBe(results[0].id);
  const second = await owner.shares.create(owner.caller, { documentId: owner.documentId });
  const secondSave = await reader.saved.save(reader.caller, second.path.slice(3));
  expect(secondSave.id).not.toBe(results[0].id);
  expect((await reader.saved.list(reader.caller, reader.workspace.id, {})).items).toHaveLength(2);
});
it("uses snapshots and generic unavailable state after revocation, with no private search leak", async () => {
  const owner = await fixture(), reader = await fixture();
  const record = await reader.saved.save(reader.caller, owner.token);
  await owner.shares.revoke(owner.caller, owner.link.id);
  await pool.query("UPDATE knowledge_revisions SET title='New secret title' WHERE document_id=?", [owner.documentId]);
  await pool.query("UPDATE users SET name='New secret sender' WHERE id=?", [owner.caller.identity.id]);
  const item = (await reader.saved.list(reader.caller, reader.workspace.id, {})).items[0];
  expect(item).toMatchObject({ title: "Saved %_! guide", sharedByName: "Saved Owner", status: "unavailable", path: null, updatedAt: null });
  expect((await reader.saved.list(reader.caller, reader.workspace.id, { q: "secret" })).items).toEqual([]);
  expect((await reader.saved.list(reader.caller, reader.workspace.id, { q: "%_!", status: "unavailable" })).items).toHaveLength(1);
  await expect(reader.saved.save(reader.caller, owner.token)).rejects.toMatchObject({ code: "SHARE_LINK_NOT_FOUND" });
  await expect(owner.shares.readShared(owner.token)).rejects.toMatchObject({ code: "SHARE_LINK_NOT_FOUND" });
  await reader.saved.remove(reader.caller, record.id!);
});
it("expiry rejects saving but saved records remain removable", async () => {
  const owner = await fixture(), reader = await fixture();
  const record = await reader.saved.save(reader.caller, owner.token);
  const later = new SavedShareService(reader.uow, () => new Date("2027-01-01T00:00:00Z"));
  expect((await later.list(reader.caller, reader.workspace.id, {})).items[0]).toMatchObject({ status: "expired", path: null });
  await expect(later.save(reader.caller, owner.token)).rejects.toMatchObject({ code: "SHARE_LINK_NOT_FOUND" });
  await later.remove(reader.caller, record.id!);
});
it.each(["document", "source", "workspace", "membership"])("validity follows %s lifecycle and restoration", async kind => {
  const owner = await fixture(), reader = await fixture();
  await reader.saved.save(reader.caller, owner.token);
  if (kind === "membership") await pool.query("DELETE FROM workspace_memberships WHERE workspace_id=? AND user_id=?", [owner.workspace.id, owner.caller.identity.id]);
  else if (kind === "workspace") await pool.query("UPDATE workspaces SET lifecycle_state='ARCHIVED', archived_by=?, archived_at=? WHERE id=?", [owner.caller.identity.id, owner.now, owner.workspace.id]);
  else await pool.query(`UPDATE ${kind === "document" ? "knowledge_documents" : "knowledge_sources"} SET status='ARCHIVED', archived_by=?, archived_at=? WHERE id=?`, [owner.caller.identity.id, owner.now, kind === "document" ? owner.documentId : owner.sourceId]);
  expect((await reader.saved.list(reader.caller, reader.workspace.id, { status: "available" })).items).toHaveLength(0);
  await expect(reader.saved.save(reader.caller, owner.token)).rejects.toMatchObject({ code: "SHARE_LINK_NOT_FOUND" });
  if (kind === "document" || kind === "source") {
    await pool.query(`UPDATE ${kind === "document" ? "knowledge_documents" : "knowledge_sources"} SET status='ACTIVE', archived_by=NULL, archived_at=NULL WHERE id=?`, [kind === "document" ? owner.documentId : owner.sourceId]);
    expect((await reader.saved.list(reader.caller, reader.workspace.id, {})).items[0].status).toBe("available");
  }
});
it("paginates stably, searches literal characters and hides invalid tokens", async () => {
  const owner = await fixture(), reader = await fixture();
  await reader.saved.save(reader.caller, owner.token);
  for (let j = 1; j < 52; j++) {
    const { documentId } = await new HubKnowledgeCommandServiceImpl(owner.uow).createDocument(owner.caller, { sourceId: owner.sourceId, parentId: null, title: `Page ${j}`, markdown: "body", metadata: {} });
    const link = await owner.shares.create(owner.caller, { documentId });
    await reader.saved.save(reader.caller, link.path.slice(3));
  }
  const first = await reader.saved.list(reader.caller, reader.workspace.id, {}), second = await reader.saved.list(reader.caller, reader.workspace.id, { page: "2" });
  expect(first.items).toHaveLength(50); expect(first.hasNext).toBe(true); expect(second.items).toHaveLength(2);
  expect(new Set([...first.items,...second.items].map(x => x.id)).size).toBe(52);
  await expect(reader.saved.save(reader.caller, "not-a-token")).rejects.toMatchObject({ code: "SHARE_LINK_NOT_FOUND" });
});
it("search matches saved metadata and currently public metadata after a rename",async()=>{
 const owner=await fixture(),reader=await fixture();await reader.saved.save(reader.caller,owner.token);
 const current=await owner.uow.run(r=>r.revisions.findCurrent(owner.documentId));
 await new HubKnowledgeCommandServiceImpl(owner.uow).createRevision(owner.caller,{documentId:owner.documentId,expectedCurrentRevisionId:current!.id,title:"New public title",markdown:"updated body",metadata:{}});
 await owner.uow.run(r=>r.users.upsertIdentity({...owner.caller.identity,name:"Updated sender"}));
 for(const q of ["Saved %_! guide","Saved Owner","New public title","Updated sender"]){
  const list=await reader.saved.list(reader.caller,reader.workspace.id,{q});expect(list.items).toHaveLength(1);expect(list.items[0]).toMatchObject({title:"New public title",sharedByName:"Updated sender"});
 }
});
it("never snapshots a private title published between validation and metadata capture",async()=>{
 const owner=await fixture(),reader=await fixture();
 const current=await owner.uow.run(r=>r.revisions.findCurrent(owner.documentId));let mutated=false;
 async function revokeAndEdit(){if(mutated)return;mutated=true;await owner.shares.revoke(owner.caller,owner.link.id);await new HubKnowledgeCommandServiceImpl(owner.uow).createRevision(owner.caller,{documentId:owner.documentId,expectedCurrentRevisionId:current!.id,title:"Private after revoke",markdown:"private revised body",metadata:{}});}
 const raced=new SavedShareService({run:work=>reader.uow.run(r=>work({...r,
  revisions:new Proxy(r.revisions,{get(target,key){const value=Reflect.get(target,key);if(key==="findCurrent")return async(id:string)=>{await revokeAndEdit();return target.findCurrent(id);};return typeof value==="function"?value.bind(target):value;}}),
  savedShares:new Proxy(r.savedShares,{get(target,key){const value=Reflect.get(target,key);if(key==="findSnapshotByToken"&&typeof value==="function")return async(token:string)=>{const snapshot=await value.call(target,token);await revokeAndEdit();return snapshot;};return typeof value==="function"?value.bind(target):value;}}),
 }))},()=>owner.now);
 await raced.save(reader.caller,owner.token);expect(mutated).toBe(true);
 const list=await reader.saved.list(reader.caller,reader.workspace.id,{});expect(list.items[0]).toMatchObject({title:"Saved %_! guide",status:"unavailable",path:null});
 expect((await reader.saved.list(reader.caller,reader.workspace.id,{q:"Private after revoke"})).items).toHaveLength(0);
});
it("every reader of a link judges it alike: a link whose creator no longer owns the My Space opens nowhere", async () => {
  const owner = await fixture(), reader = await fixture(), other = await fixture();
  await reader.saved.save(reader.caller, owner.token);
  // A creator who is still a member, but not the owner: only the ownership rule refuses this link.
  await pool.query("INSERT INTO workspace_memberships (workspace_id,user_id,role,membership_source,created_by,created_at,updated_at) VALUES (?,?,'VIEWER','DIRECT',NULL,?,?)", [owner.workspace.id, reader.caller.identity.id, owner.now, owner.now]);
  await pool.query("UPDATE document_share_links SET created_by=? WHERE id=?", [reader.caller.identity.id, owner.link.id]);
  await expect(owner.shares.readShared(owner.token)).rejects.toMatchObject({ code: "SHARE_LINK_NOT_FOUND" });
  await expect(other.saved.save(other.caller, owner.token)).rejects.toMatchObject({ code: "SHARE_LINK_NOT_FOUND" });
  const [item] = (await reader.saved.list(reader.caller, reader.workspace.id, {})).items;
  expect(item).toMatchObject({ status: "unavailable", path: null });
});
it("a pass-through check judges the link without counting a view", async () => {
  const owner = await fixture();
  await expect(owner.shares.readShared(owner.token, { recordView: false })).resolves.toMatchObject({ title: "Saved %_! guide" });
  expect((await owner.shares.list(owner.caller, owner.documentId))[0].totalViews).toBe(0);
  await owner.shares.readShared(owner.token);
  expect((await owner.shares.list(owner.caller, owner.documentId))[0].totalViews).toBe(1);
});
