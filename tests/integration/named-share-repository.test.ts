import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import type { UserIdentity } from "@/modules/identity/domain/user-identity";
import { HubKnowledgeCommandServiceImpl } from "@/modules/knowledge/application/hub-knowledge-command-service";
import type { DocumentShareLink, ShareAudience } from "@/modules/knowledge/domain/document-share-link";
import { ensureDefaultHubSource } from "@/modules/sources/application/ensure-default-hub-source";
import { PersonalWorkspaceService } from "@/modules/workspaces/application/personal-workspace-service";
import { uuidv7 } from "@/shared/ids/uuidv7";

let pool: Pool;
beforeAll(() => { pool = createDatabasePool(databaseConfig("test")); });
afterAll(async () => { await pool.end(); });

const unitOfWork = () => new MariaDbUnitOfWork(pool);

function newIdentity(name: string): UserIdentity {
  const id = uuidv7();
  return { id, emp_id: `NAMED-SHARE-${id}`, name, org_code: "SHARE" };
}

async function setup() {
  const owner = newIdentity("Named Owner");
  const uow = unitOfWork();
  await uow.run((r) => r.users.upsertIdentity(owner));
  const { workspace } = await new PersonalWorkspaceService(uow).ensurePersonalWorkspace(owner.id);
  const caller = callerFromIdentity(owner);
  const sourceId = await ensureDefaultHubSource(uow, caller, workspace.id);
  const hub = new HubKnowledgeCommandServiceImpl(uow);
  const { treeNodeId: folderNodeId } = await hub.createFolder(caller, { sourceId, parentId: null, name: "Named Folder" });
  const { documentId } = await hub.createDocument(caller, { sourceId, parentId: folderNodeId, title: "Named Doc", markdown: "body", metadata: {} });
  return { owner, workspaceId: workspace.id, folderNodeId, documentId };
}

async function newUser(name: string): Promise<string> {
  const identity = newIdentity(name);
  await unitOfWork().run((r) => r.users.upsertIdentity(identity));
  return identity.id;
}

function linkOf(ownerId: string, target: DocumentShareLink["target"], audience: ShareAudience, at = new Date()): DocumentShareLink {
  return {
    id: uuidv7(), target, token: crypto.randomUUID(), label: null, audience, createdBy: ownerId, createdAt: at,
    expiresAt: audience === "NAMED" ? null : new Date(at.getTime() + 86_400_000), revokedBy: null, revokedAt: null,
  };
}

const insert = (link: DocumentShareLink) => unitOfWork().run((r) => r.shareLinks.insert(link));
const run = <T>(work: (r: Parameters<Parameters<MariaDbUnitOfWork["run"]>[0]>[0]) => Promise<T>) => unitOfWork().run(work);

describe("NAMED share links in the repository", () => {
  it("round-trips audience and a null expiry", async () => {
    const { owner, documentId } = await setup();
    const link = linkOf(owner.id, { kind: "DOCUMENT", documentId }, "NAMED");
    await insert(link);
    const found = await run((r) => r.shareLinks.findByToken(link.token));
    expect(found).toMatchObject({ id: link.id, audience: "NAMED", expiresAt: null });
    const plain = linkOf(owner.id, { kind: "DOCUMENT", documentId }, "LINK");
    await insert(plain);
    expect(await run((r) => r.shareLinks.findById(plain.id))).toMatchObject({ audience: "LINK", expiresAt: plain.expiresAt });
  });

  it("counts a NAMED link as active for its document and its folder", async () => {
    const { owner, documentId, folderNodeId } = await setup();
    await insert(linkOf(owner.id, { kind: "DOCUMENT", documentId }, "NAMED"));
    await insert(linkOf(owner.id, { kind: "FOLDER", folderNodeId }, "NAMED"));
    const now = new Date(Date.now() + 365 * 86_400_000);
    expect(await run((r) => r.shareLinks.countActiveByDocument(documentId, now))).toBe(1);
    expect(await run((r) => r.shareLinks.countActiveByFolder(folderNodeId, now))).toBe(1);
  });

  it("lists a folder that has only a NAMED link, and lists the link for its owner", async () => {
    const { owner, workspaceId, folderNodeId } = await setup();
    const link = linkOf(owner.id, { kind: "FOLDER", folderNodeId }, "NAMED");
    await insert(link);
    const now = new Date();
    expect(await run((r) => r.shareLinks.listOpenFolderLinks(workspaceId, owner.id, now))).toEqual([{ folderNodeId, name: "Named Folder" }]);
    const managed = await run((r) => r.shareLinks.listForWorkspace(workspaceId, owner.id, { q: "", status: "all", page: 1 }, now, 50, 0));
    expect(managed).toHaveLength(1);
    expect(managed[0]).toMatchObject({ id: link.id, status: "active", expiresAt: null, kind: "FOLDER" });
  });

  it("stores, answers and removes recipients", async () => {
    const { owner, documentId } = await setup();
    const [first, second, stranger] = await Promise.all([newUser("First"), newUser("Second"), newUser("Stranger")]);
    const link = linkOf(owner.id, { kind: "DOCUMENT", documentId }, "NAMED");
    await insert(link);
    const t0 = new Date("2026-11-03T00:00:00Z");
    await run((r) => r.shareLinks.insertRecipients(link.id, [first], owner.id, t0));
    await run((r) => r.shareLinks.insertRecipients(link.id, [second, first], owner.id, new Date(t0.getTime() + 1000)));

    expect(await run((r) => r.shareLinks.countRecipients(link.id))).toBe(2);
    expect(await run((r) => r.shareLinks.isRecipient(link.id, first))).toBe(true);
    expect(await run((r) => r.shareLinks.isRecipient(link.id, stranger))).toBe(false);
    const listed = await run((r) => r.shareLinks.listRecipients(link.id));
    expect(listed.map((row) => row.userId)).toEqual([second, first]);
    expect(listed[1].addedAt).toEqual(t0);

    expect(await run((r) => r.shareLinks.removeRecipient(link.id, first))).toBe(true);
    expect(await run((r) => r.shareLinks.removeRecipient(link.id, first))).toBe(false);
    expect(await run((r) => r.shareLinks.isRecipient(link.id, first))).toBe(false);
  });

  it("lists links for a recipient newest first and tracks the recipient's own read state", async () => {
    const { owner, documentId, folderNodeId } = await setup();
    const reader = await newUser("Reader");
    const older = linkOf(owner.id, { kind: "DOCUMENT", documentId }, "NAMED");
    const newer = linkOf(owner.id, { kind: "FOLDER", folderNodeId }, "NAMED");
    await insert(older);
    await insert(newer);
    const t0 = new Date("2026-11-03T00:00:00Z");
    await run((r) => r.shareLinks.insertRecipients(older.id, [reader], owner.id, t0));
    await run((r) => r.shareLinks.insertRecipients(newer.id, [reader], owner.id, new Date(t0.getTime() + 5000)));

    const received = await run((r) => r.shareLinks.listForRecipient(reader, 10));
    expect(received.map((row) => row.link.id)).toEqual([newer.id, older.id]);
    expect(received[0]).toMatchObject({ readAt: null, link: { audience: "NAMED", expiresAt: null } });
    expect(await run((r) => r.shareLinks.listForRecipient(reader, 1))).toHaveLength(1);

    const readAt = new Date(t0.getTime() + 9000);
    await run((r) => r.shareLinks.markRecipientRead(older.id, reader, readAt));
    await run((r) => r.shareLinks.markRecipientRead(older.id, reader, new Date(t0.getTime() + 99000)));
    const after = await run((r) => r.shareLinks.listForRecipient(reader, 10));
    expect(after.find((row) => row.link.id === older.id)?.readAt).toEqual(readAt);
    expect(after.find((row) => row.link.id === newer.id)?.readAt).toBeNull();
  });

  it("rejects a LINK without an expiry, and a NAMED link with one", async () => {
    const { owner, documentId } = await setup();
    const bad = { ...linkOf(owner.id, { kind: "DOCUMENT", documentId }, "LINK"), expiresAt: null };
    await expect(insert(bad)).rejects.toThrow(/integrity constraint/);
    const named = { ...linkOf(owner.id, { kind: "DOCUMENT", documentId }, "NAMED"), expiresAt: new Date(Date.now() + 86_400_000) };
    await expect(insert(named)).rejects.toThrow(/integrity constraint/);
  });
});
