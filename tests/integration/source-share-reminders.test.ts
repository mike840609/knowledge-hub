import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { RandomShareTokenIssuer } from "@/infrastructure/security/random-share-token-issuer";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import { DocumentShareService } from "@/modules/knowledge/application/document-share-service";
import { HubKnowledgeCommandServiceImpl } from "@/modules/knowledge/application/hub-knowledge-command-service";
import { ensureDefaultHubSource } from "@/modules/sources/application/ensure-default-hub-source";
import { SourceApplicationService } from "@/modules/sources/application/source-version-guard";
import { PersonalWorkspaceService } from "@/modules/workspaces/application/personal-workspace-service";
import { uuidv7 } from "@/shared/ids/uuidv7";

let pool: Pool;
beforeAll(() => { pool = createDatabasePool(databaseConfig("test")); });
afterAll(async () => { await pool.end(); });

async function fixture() {
  const uow = new MariaDbUnitOfWork(pool);
  const identity = { id: uuidv7(), emp_id: randomUUID(), name: "Source reminder owner", org_code: "SOURCE-REMIND" };
  await uow.run(r => r.users.upsertIdentity(identity));
  const caller = callerFromIdentity(identity);
  const { workspace } = await new PersonalWorkspaceService(uow).ensurePersonalWorkspace(identity.id);
  const sourceId = await ensureDefaultHubSource(uow, caller, workspace.id);
  const hub = new HubKnowledgeCommandServiceImpl(uow);
  const folder = await hub.createFolder(caller, { sourceId, parentId: null, name: "Folder" });
  const root = await hub.createDocument(caller, { sourceId, parentId: null, title: "Root", markdown: "Body", metadata: {} });
  const deep = await hub.createDocument(caller, { sourceId, parentId: folder.treeNodeId, title: "Deep", markdown: "Body", metadata: {} });
  let now = Date.now();
  const shares = new DocumentShareService(uow, new RandomShareTokenIssuer(), () => new Date(now));
  return { caller, workspaceId: workspace.id, sourceId, root, deep, shares, uow, folder, advance: () => { now += 86401000; } };
}

describe("source share reminders", () => {
  it("lists open source links and drops revoked links", async () => {
    const f = await fixture();
    const link = await f.shares.createForSource(f.caller, { sourceId: f.sourceId });
    expect((await f.shares.listOpenShareTargets(f.caller, f.workspaceId)).sources).toEqual([expect.objectContaining({ sourceId: f.sourceId })]);
    await f.shares.revoke(f.caller, link.id);
    expect((await f.shares.listOpenShareTargets(f.caller, f.workspaceId)).sources).toEqual([]);
  });

  it("drops an expired source link", async () => {
    const f = await fixture();
    await f.shares.createForSource(f.caller, { sourceId: f.sourceId, expiresInDays: 1 });
    f.advance();
    expect((await f.shares.listOpenShareTargets(f.caller, f.workspaceId)).sources).toEqual([]);
  });

  it("names the shared source for root and nested documents", async () => {
    const f = await fixture();
    await f.shares.createForSource(f.caller, { sourceId: f.sourceId });
    for (const document of [f.root, f.deep]) {
      expect((await f.shares.containersSharingDocument(f.caller, document.documentId)).sources).toEqual([expect.objectContaining({ sourceId: f.sourceId })]);
    }
  });

  it("refuses a stranger access to workspace and document reminders", async () => {
    const f = await fixture();
    const stranger = await fixture();
    await f.shares.createForSource(f.caller, { sourceId: f.sourceId });
    await expect(f.shares.listOpenShareTargets(stranger.caller, f.workspaceId)).rejects.toMatchObject({ code: expect.stringMatching(/^WORKSPACE_(NOT_FOUND|ACCESS_DENIED)$/) });
    await expect(f.shares.containersSharingDocument(stranger.caller, f.root.documentId)).rejects.toMatchObject({ code: "WORKSPACE_ACCESS_DENIED" });
  });

  it("does not name a source for a document in another source", async () => {
    const f = await fixture();
    const sourceId = uuidv7();
    const now = new Date();
    await f.uow.run(r => r.sources.insert({ id: sourceId, name: "Other", workspaceId: f.workspaceId, sourceType: "HUB", ownership: "HUB_MANAGED", status: "ACTIVE", syncVersion: 0, createdBy: f.caller.identity.id, updatedBy: f.caller.identity.id, archivedBy: null, archivedAt: null, createdAt: now, updatedAt: now }));
    const outside = await new HubKnowledgeCommandServiceImpl(f.uow).createDocument(f.caller, { sourceId, parentId: null, title: "Outside", markdown: "Body", metadata: {} });
    await f.shares.createForSource(f.caller, { sourceId: f.sourceId });
    expect((await f.shares.containersSharingDocument(f.caller, outside.documentId)).sources).toEqual([]);
  });

  it("hides archived sources and shows them after restore", async () => {
    const f = await fixture();
    const sources = new SourceApplicationService(f.uow);
    await f.shares.createForSource(f.caller, { sourceId: f.sourceId });
    await sources.archiveSource(f.caller, f.sourceId);
    expect((await f.shares.containersSharingDocument(f.caller, f.root.documentId)).sources).toEqual([]);
    await sources.restoreSource(f.caller, f.sourceId);
    expect((await f.shares.containersSharingDocument(f.caller, f.root.documentId)).sources).toEqual([expect.objectContaining({ sourceId: f.sourceId })]);
  });
});
