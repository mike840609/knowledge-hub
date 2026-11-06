import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { RandomShareTokenIssuer } from "@/infrastructure/security/random-share-token-issuer";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import type { UserIdentity } from "@/modules/identity/domain/user-identity";
import { DocumentShareService } from "@/modules/knowledge/application/document-share-service";
import { HubKnowledgeCommandServiceImpl } from "@/modules/knowledge/application/hub-knowledge-command-service";
import { SavedShareService } from "@/modules/knowledge/application/saved-share-service";
import { ensureDefaultHubSource } from "@/modules/sources/application/ensure-default-hub-source";
import { PersonalWorkspaceService } from "@/modules/workspaces/application/personal-workspace-service";
import { uuidv7 } from "@/shared/ids/uuidv7";

/** Named-recipient share spec, "Shares": a recipient sees every named share that opens now, without saving it. */
let pool: Pool;
beforeAll(() => { pool = createDatabasePool(databaseConfig("test")); });
afterAll(async () => { await pool.end(); });

const unitOfWork = () => new MariaDbUnitOfWork(pool);

async function newUser(name: string): Promise<UserIdentity> {
  const id = uuidv7();
  const identity = { id, emp_id: `NAMED-LIST-${id}`, name, org_code: "SHARE" };
  const uow = unitOfWork();
  await uow.run((r) => r.users.upsertIdentity(identity));
  await new PersonalWorkspaceService(uow).ensurePersonalWorkspace(id);
  return identity;
}

async function setup() {
  const owner = await newUser("List Owner");
  const uow = unitOfWork();
  const { workspace } = await new PersonalWorkspaceService(uow).ensurePersonalWorkspace(owner.id);
  const caller = callerFromIdentity(owner);
  const sourceId = await ensureDefaultHubSource(uow, caller, workspace.id);
  const hub = new HubKnowledgeCommandServiceImpl(uow);
  const { treeNodeId: folderNodeId } = await hub.createFolder(caller, { sourceId, parentId: null, name: "Reading list" });
  const first = await hub.createDocument(caller, { sourceId, parentId: folderNodeId, title: "Quarterly plan", markdown: "Body", metadata: {} });
  const second = await hub.createDocument(caller, { sourceId, parentId: null, title: "Roadmap", markdown: "Body", metadata: {} });
  const alice = await newUser("Alice");
  const bob = await newUser("Bob");
  const alicePersonal = await uow.run((r) => r.workspaces.findPersonalByOwnerUserId(alice.id));
  const bobPersonal = await uow.run((r) => r.workspaces.findPersonalByOwnerUserId(bob.id));
  return {
    caller, sourceId, folderNodeId, firstId: first.documentId, secondId: second.documentId, alice, bob,
    aliceCaller: callerFromIdentity(alice), bobCaller: callerFromIdentity(bob),
    aliceWorkspaceId: alicePersonal!.id, bobWorkspaceId: bobPersonal!.id, hub,
    shares: new DocumentShareService(uow, new RandomShareTokenIssuer()), saved: new SavedShareService(uow),
  };
}

describe("SavedShareService.listNamedForRecipient", () => {
  it("lists a named Source by its name and drops it when revoked", async () => {
    const f = await setup();
    const source = await unitOfWork().run(r => r.sourcePolicy.findById(f.sourceId));
    const link = await f.shares.createForSource(f.caller, { sourceId: f.sourceId, recipients: [f.alice.id] });
    expect(await f.saved.listNamedForRecipient(f.aliceCaller, f.aliceWorkspaceId)).toEqual([
      expect.objectContaining({ linkId: link.id, title: source!.name, href: `/w/${f.aliceWorkspaceId}/shares/${link.path.slice(3)}` }),
    ]);
    await f.shares.revoke(f.caller, link.id);
    expect(await f.saved.listNamedForRecipient(f.aliceCaller, f.aliceWorkspaceId)).toEqual([]);
  });
  it("lists the named shares that open now, newest first, with title, sender and link", async () => {
    const f = await setup();
    const one = await f.shares.create(f.caller, { documentId: f.firstId, recipients: [f.alice.id] });
    const two = await f.shares.create(f.caller, { documentId: f.secondId, recipients: [f.alice.id] });
    const revoked = await f.shares.create(f.caller, { documentId: f.secondId, recipients: [f.alice.id] });
    await f.shares.revoke(f.caller, revoked.id);
    const items = await f.saved.listNamedForRecipient(f.aliceCaller, f.aliceWorkspaceId);
    expect(items.map((i) => i.linkId).sort()).toEqual([one.id, two.id].sort());
    expect(items).toContainEqual({ linkId: one.id, title: "Quarterly plan", sharedByName: "List Owner", addedAt: expect.any(Date), href: `/w/${f.aliceWorkspaceId}/shares/${one.path.slice(3)}` });
    expect(items[0].addedAt.getTime()).toBeGreaterThanOrEqual(items[1].addedAt.getTime());
  });

  it("lists nothing for someone who is not named, and drops a removed recipient", async () => {
    const f = await setup();
    const view = await f.shares.create(f.caller, { documentId: f.firstId, recipients: [f.alice.id] });
    expect(await f.saved.listNamedForRecipient(f.bobCaller, f.bobWorkspaceId)).toEqual([]);
    await f.shares.removeRecipient(f.caller, view.id, f.alice.id);
    expect(await f.saved.listNamedForRecipient(f.aliceCaller, f.aliceWorkspaceId)).toEqual([]);
  });

  it("titles a folder share by the folder name and drops an archived document", async () => {
    const f = await setup();
    const folder = await f.shares.createForFolder(f.caller, { folderNodeId: f.folderNodeId, recipients: [f.alice.id] });
    await f.shares.create(f.caller, { documentId: f.secondId, recipients: [f.alice.id] });
    await f.hub.archiveDocument(f.caller, f.secondId);
    expect(await f.saved.listNamedForRecipient(f.aliceCaller, f.aliceWorkspaceId))
      .toEqual([expect.objectContaining({ linkId: folder.id, title: "Reading list", href: `/w/${f.aliceWorkspaceId}/shares/${folder.path.slice(3)}` })]);
  });

  it("refuses a workspace that is not the caller's own personal workspace", async () => {
    const f = await setup();
    await f.shares.create(f.caller, { documentId: f.firstId, recipients: [f.alice.id] });
    await expect(f.saved.listNamedForRecipient(f.aliceCaller, f.bobWorkspaceId)).rejects.toMatchObject({ code: "WORKSPACE_NOT_FOUND" });
    await expect(f.saved.listNamedForRecipient(f.aliceCaller, uuidv7())).rejects.toMatchObject({ code: "WORKSPACE_NOT_FOUND" });
  });
});
