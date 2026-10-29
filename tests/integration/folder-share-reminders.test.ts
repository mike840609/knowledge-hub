import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { RandomShareTokenIssuer } from "@/infrastructure/security/random-share-token-issuer";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import { createDirectMembership } from "@/modules/workspaces/domain/workspace-membership";
import { DocumentShareService } from "@/modules/knowledge/application/document-share-service";
import { HubKnowledgeCommandServiceImpl } from "@/modules/knowledge/application/hub-knowledge-command-service";
import { ensureDefaultHubSource } from "@/modules/sources/application/ensure-default-hub-source";
import { PersonalWorkspaceService } from "@/modules/workspaces/application/personal-workspace-service";
import { uuidv7 } from "@/shared/ids/uuidv7";

/** The two quiet reminders of a folder link (folder share spec §8): the owner is told, never blocked. */
let pool: Pool;
beforeAll(() => { pool = createDatabasePool(databaseConfig("test")); });
afterAll(async () => { await pool.end(); });

const DAY = 24 * 60 * 60 * 1000;

async function personal(name: string, uow: MariaDbUnitOfWork) {
  const id = uuidv7();
  const identity = { id, emp_id: randomUUID(), name, org_code: "FOLDER-REMIND" };
  await uow.run(r => r.users.upsertIdentity(identity));
  const { workspace } = await new PersonalWorkspaceService(uow).ensurePersonalWorkspace(id);
  const caller = callerFromIdentity(identity);
  return { caller, workspaceId: workspace.id, sourceId: await ensureDefaultHubSource(uow, caller, workspace.id) };
}

/** A VIEWER of the owner's My Space, who is not its owner. */
async function memberOf(workspaceId: string, uow: MariaDbUnitOfWork) {
  const identity = { id: uuidv7(), emp_id: randomUUID(), name: "Reminder Member", org_code: "FOLDER-REMIND" };
  await uow.run(async r => {
    await r.users.upsertIdentity(identity);
    await r.workspaceMemberships.insert(createDirectMembership({ workspaceId, userId: identity.id, role: "VIEWER", now: new Date() }));
  });
  return callerFromIdentity(identity);
}

/** Owner's My Space: Handbook/{Guides/{Deep}, Welcome}, and Outside at the root. */
async function fixture() {
  const uow = new MariaDbUnitOfWork(pool);
  let now = Date.now();
  const clock = () => new Date(now);
  const owner = await personal("Reminder Owner", uow), stranger = await personal("Reminder Stranger", uow);
  const hub = new HubKnowledgeCommandServiceImpl(uow);
  const doc = (parentId: string | null, title: string) => hub.createDocument(owner.caller, { sourceId: owner.sourceId, parentId, title, markdown: "Body.", metadata: {} });
  const folder = async (parentId: string | null, name: string) => (await hub.createFolder(owner.caller, { sourceId: owner.sourceId, parentId, name })).treeNodeId;
  const handbook = await folder(null, "Handbook"), guides = await folder(handbook, "Guides");
  const welcome = await doc(handbook, "Welcome"), deep = await doc(guides, "Deep"), outside = await doc(null, "Outside");
  const shares = new DocumentShareService(uow, new RandomShareTokenIssuer(), clock);
  const open = () => shares.listOpenFolderLinks(owner.caller, owner.workspaceId);
  return { uow, hub, owner, stranger, handbook, guides, welcome, deep, outside, shares, open, advance: (ms: number) => { now += ms; } };
}

describe("listOpenFolderLinks", () => {
  it("lists a folder that has an open link, with its name, and nothing before one exists", async () => {
    const f = await fixture();
    expect(await f.open()).toEqual([]);
    await f.shares.createForFolder(f.owner.caller, { folderNodeId: f.handbook });
    expect(await f.open()).toEqual([{ folderNodeId: f.handbook, name: "Handbook" }]);
  });

  it("lists a folder once however many open links it has, and not a document's link", async () => {
    const f = await fixture();
    await f.shares.createForFolder(f.owner.caller, { folderNodeId: f.handbook });
    await f.shares.createForFolder(f.owner.caller, { folderNodeId: f.handbook, label: "Second" });
    await f.shares.create(f.owner.caller, { documentId: f.outside.documentId });
    expect(await f.open()).toEqual([{ folderNodeId: f.handbook, name: "Handbook" }]);
  });

  it("drops the folder once its only open link is revoked, and keeps it while another stays open", async () => {
    const f = await fixture();
    const first = await f.shares.createForFolder(f.owner.caller, { folderNodeId: f.handbook });
    const second = await f.shares.createForFolder(f.owner.caller, { folderNodeId: f.handbook });
    await f.shares.revoke(f.owner.caller, first.id);
    expect(await f.open()).toHaveLength(1);
    await f.shares.revoke(f.owner.caller, second.id);
    expect(await f.open()).toEqual([]);
  });

  it("drops the folder once its link expires", async () => {
    const f = await fixture();
    await f.shares.createForFolder(f.owner.caller, { folderNodeId: f.handbook, expiresInDays: 1 });
    expect(await f.open()).toHaveLength(1);
    f.advance(DAY + 1000);
    expect(await f.open()).toEqual([]);
  });

  it("follows a rename, and drops a folder that is archived", async () => {
    const f = await fixture();
    await f.shares.createForFolder(f.owner.caller, { folderNodeId: f.guides });
    await f.hub.renameFolder(f.owner.caller, { nodeId: f.guides, name: "Manuals" });
    expect(await f.open()).toEqual([{ folderNodeId: f.guides, name: "Manuals" }]);
    await f.hub.archiveDocument(f.owner.caller, f.deep.documentId);
    await f.hub.archiveFolder(f.owner.caller, f.guides);
    expect(await f.open()).toEqual([]);
  });

  it("refuses everyone but the owner of that My Space, as listManagement does", async () => {
    const f = await fixture();
    await f.shares.createForFolder(f.owner.caller, { folderNodeId: f.handbook });
    const refused = { code: expect.stringMatching(/^WORKSPACE_(NOT_FOUND|ACCESS_DENIED)$/) };
    await expect(f.shares.listOpenFolderLinks(f.stranger.caller, f.owner.workspaceId)).rejects.toMatchObject(refused);
    await expect(f.shares.listOpenFolderLinks(f.owner.caller, f.stranger.workspaceId)).rejects.toMatchObject(refused);
    const member = await memberOf(f.owner.workspaceId, f.uow);
    await expect(f.shares.listOpenFolderLinks(member, f.owner.workspaceId)).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
  });
});

describe("foldersSharingDocument", () => {
  it("names the shared ancestor, nearest first, for a document inside, however deep", async () => {
    const f = await fixture();
    expect(await f.shares.foldersSharingDocument(f.owner.caller, f.deep.documentId)).toEqual([]);
    await f.shares.createForFolder(f.owner.caller, { folderNodeId: f.handbook });
    expect(await f.shares.foldersSharingDocument(f.owner.caller, f.deep.documentId)).toEqual([{ folderNodeId: f.handbook, name: "Handbook" }]);
    await f.shares.createForFolder(f.owner.caller, { folderNodeId: f.guides });
    expect((await f.shares.foldersSharingDocument(f.owner.caller, f.deep.documentId)).map(folder => folder.name)).toEqual(["Guides", "Handbook"]);
  });

  it("names nothing for a document outside every shared folder, or whose own link is a document link", async () => {
    const f = await fixture();
    await f.shares.createForFolder(f.owner.caller, { folderNodeId: f.handbook });
    await f.shares.create(f.owner.caller, { documentId: f.outside.documentId });
    expect(await f.shares.foldersSharingDocument(f.owner.caller, f.outside.documentId)).toEqual([]);
  });

  it("names nothing once the document moves out, and names the folder again when it moves back in", async () => {
    const f = await fixture();
    await f.shares.createForFolder(f.owner.caller, { folderNodeId: f.handbook });
    const nodeId = (await f.uow.run(r => r.tree.findByDocumentId(f.welcome.documentId)))!.id;
    await f.hub.moveTreeNode(f.owner.caller, { nodeId, newParentId: null, newPosition: 0 });
    expect(await f.shares.foldersSharingDocument(f.owner.caller, f.welcome.documentId)).toEqual([]);
    await f.hub.moveTreeNode(f.owner.caller, { nodeId, newParentId: f.handbook, newPosition: 0 });
    expect(await f.shares.foldersSharingDocument(f.owner.caller, f.welcome.documentId)).toHaveLength(1);
  });

  it("names nothing once the link is revoked", async () => {
    const f = await fixture();
    const link = await f.shares.createForFolder(f.owner.caller, { folderNodeId: f.handbook });
    await f.shares.revoke(f.owner.caller, link.id);
    expect(await f.shares.foldersSharingDocument(f.owner.caller, f.welcome.documentId)).toEqual([]);
  });

  it("is refused to anyone but the owner, and for an unknown document", async () => {
    const f = await fixture();
    await f.shares.createForFolder(f.owner.caller, { folderNodeId: f.handbook });
    await expect(f.shares.foldersSharingDocument(f.stranger.caller, f.welcome.documentId)).rejects.toMatchObject({ code: "WORKSPACE_ACCESS_DENIED" });
    const member = await memberOf(f.owner.workspaceId, f.uow);
    await expect(f.shares.foldersSharingDocument(member, f.welcome.documentId)).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    await expect(f.shares.foldersSharingDocument(f.owner.caller, uuidv7())).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
  });
});
