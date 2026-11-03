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
import type { DocumentShareLink, ShareAudience } from "@/modules/knowledge/domain/document-share-link";
import { ensureDefaultHubSource } from "@/modules/sources/application/ensure-default-hub-source";
import { PersonalWorkspaceService } from "@/modules/workspaces/application/personal-workspace-service";
import { uuidv7 } from "@/shared/ids/uuidv7";

/**
 * Named-recipient share spec, "Authorization summary": a NAMED link opens only for a signed-in
 * recipient or its owner, and every other caller gets the dead link's ShareLinkNotFoundError.
 */

let pool: Pool;
beforeAll(() => { pool = createDatabasePool(databaseConfig("test")); });
afterAll(async () => { await pool.end(); });

const unitOfWork = () => new MariaDbUnitOfWork(pool);
const service = () => new DocumentShareService(unitOfWork(), new RandomShareTokenIssuer());
const notFound = { code: "SHARE_LINK_NOT_FOUND" };

function newIdentity(name: string): UserIdentity {
  const id = uuidv7();
  return { id, emp_id: `NAMED-READ-${id}`, name, org_code: "SHARE" };
}

async function newUser(name: string): Promise<string> {
  const identity = newIdentity(name);
  await unitOfWork().run((r) => r.users.upsertIdentity(identity));
  return identity.id;
}

/**
 * My Space:
 *   Shared/
 *     Inside      (the document link's target, and reachable through the folder link)
 * plus a recipient, a stranger, and a NAMED link on each of the document and the folder.
 */
async function setup() {
  const owner = newIdentity("Named Read Owner");
  const uow = unitOfWork();
  await uow.run((r) => r.users.upsertIdentity(owner));
  const { workspace } = await new PersonalWorkspaceService(uow).ensurePersonalWorkspace(owner.id);
  const caller = callerFromIdentity(owner);
  const sourceId = await ensureDefaultHubSource(uow, caller, workspace.id);
  const hub = new HubKnowledgeCommandServiceImpl(uow);
  const { treeNodeId: folderNodeId } = await hub.createFolder(caller, { sourceId, parentId: null, name: "Shared" });
  const inside = await hub.createDocument(caller, { sourceId, parentId: folderNodeId, title: "Inside", markdown: "Inside body", metadata: {} });
  const recipient = await newUser("Named Recipient");
  const stranger = await newUser("Not Listed");
  const documentLink = await insertLink(owner.id, { kind: "DOCUMENT", documentId: inside.documentId }, "NAMED", [recipient]);
  const folderLink = await insertLink(owner.id, { kind: "FOLDER", folderNodeId }, "NAMED", [recipient]);
  return { owner, caller, hub, sourceId, folderNodeId, inside, recipient, stranger, documentLink, folderLink };
}

async function insertLink(ownerId: string, target: DocumentShareLink["target"], audience: ShareAudience, recipients: string[] = []) {
  const at = new Date();
  const link: DocumentShareLink = {
    id: uuidv7(), target, token: crypto.randomUUID(), label: null, audience, createdBy: ownerId, createdAt: at,
    expiresAt: audience === "NAMED" ? null : new Date(at.getTime() + 86_400_000), revokedBy: null, revokedAt: null,
  };
  await unitOfWork().run(async (r) => {
    await r.shareLinks.insert(link);
    if (recipients.length > 0) await r.shareLinks.insertRecipients(link.id, recipients, ownerId, at);
  });
  return link;
}

describe("a NAMED document link", () => {
  it("refuses a caller-less read and target, as a dead link does", async () => {
    const { documentLink } = await setup();
    await expect(service().readShared(documentLink.token)).rejects.toMatchObject(notFound);
    await expect(service().readShared(documentLink.token, { viewerId: null })).rejects.toMatchObject(notFound);
    await expect(service().readSharedTarget(documentLink.token)).rejects.toMatchObject(notFound);
    await expect(service().readSharedTarget(documentLink.token, { viewerId: null })).rejects.toMatchObject(notFound);
  });

  it("refuses a signed-in caller who is not listed", async () => {
    const { documentLink, stranger } = await setup();
    await expect(service().readShared(documentLink.token, { viewerId: stranger })).rejects.toMatchObject(notFound);
    await expect(service().readSharedTarget(documentLink.token, { viewerId: stranger })).rejects.toMatchObject(notFound);
  });

  it("opens for a listed recipient, whatever the case of their id", async () => {
    const { documentLink, recipient, inside } = await setup();
    for (const viewerId of [recipient, recipient.toUpperCase()]) {
      expect(await service().readShared(documentLink.token, { viewerId })).toMatchObject({ kind: "DOCUMENT", title: "Inside", markdown: "Inside body", audience: "NAMED", expiresAt: null });
      expect(await service().readSharedTarget(documentLink.token, { viewerId })).toEqual({ kind: "DOCUMENT", documentId: inside.documentId, audience: "NAMED" });
    }
  });

  it("opens for its owner, who is never a recipient row", async () => {
    const { documentLink, owner, inside } = await setup();
    for (const viewerId of [owner.id, owner.id.toUpperCase()]) {
      expect(await service().readShared(documentLink.token, { viewerId })).toMatchObject({ kind: "DOCUMENT", title: "Inside", audience: "NAMED" });
      expect(await service().readSharedTarget(documentLink.token, { viewerId })).toEqual({ kind: "DOCUMENT", documentId: inside.documentId, audience: "NAMED" });
    }
  });

  it("does not open for a recipient of another link on the same document", async () => {
    const { owner, inside, stranger } = await setup();
    await insertLink(owner.id, { kind: "DOCUMENT", documentId: inside.documentId }, "NAMED", [stranger]);
    const other = await insertLink(owner.id, { kind: "DOCUMENT", documentId: inside.documentId }, "NAMED", [await newUser("Someone Else")]);
    await expect(service().readShared(other.token, { viewerId: stranger })).rejects.toMatchObject(notFound);
    await expect(service().readSharedTarget(other.token, { viewerId: stranger })).rejects.toMatchObject(notFound);
  });

  it("refuses a recipient once removed", async () => {
    const { documentLink, recipient } = await setup();
    await unitOfWork().run((r) => r.shareLinks.removeRecipient(documentLink.id, recipient));
    await expect(service().readShared(documentLink.token, { viewerId: recipient })).rejects.toMatchObject(notFound);
    await expect(service().readSharedTarget(documentLink.token, { viewerId: recipient })).rejects.toMatchObject(notFound);
  });

  it("refuses the recipient and the owner once revoked", async () => {
    const { documentLink, recipient, owner, caller } = await setup();
    await service().revoke(caller, documentLink.id);
    for (const viewerId of [recipient, owner.id]) {
      await expect(service().readShared(documentLink.token, { viewerId })).rejects.toMatchObject(notFound);
      await expect(service().readSharedTarget(documentLink.token, { viewerId })).rejects.toMatchObject(notFound);
    }
  });
});

describe("a NAMED folder link", () => {
  it("refuses a caller-less read and a caller who is not listed", async () => {
    const { folderLink, stranger, inside } = await setup();
    for (const options of [{}, { viewerId: null }, { viewerId: stranger }]) {
      await expect(service().readShared(folderLink.token, options)).rejects.toMatchObject(notFound);
      await expect(service().readShared(folderLink.token, { ...options, documentId: inside.documentId })).rejects.toMatchObject(notFound);
      await expect(service().readSharedTarget(folderLink.token, options)).rejects.toMatchObject(notFound);
    }
  });

  it("opens the folder for a recipient and for the owner", async () => {
    const { folderLink, recipient, owner, inside } = await setup();
    for (const viewerId of [recipient, owner.id]) {
      const view = await service().readShared(folderLink.token, { viewerId, documentId: inside.documentId });
      expect(view).toMatchObject({ kind: "FOLDER", folderName: "Shared", audience: "NAMED", document: { documentId: inside.documentId, title: "Inside" } });
      expect(await service().readSharedTarget(folderLink.token, { viewerId, documentId: inside.documentId })).toEqual({ kind: "FOLDER", documentId: inside.documentId, audience: "NAMED" });
    }
  });

  it("re-derives the subtree: a document moved out is refused to the recipient", async () => {
    const { folderLink, recipient, inside, hub, caller } = await setup();
    await hub.moveTreeNode(caller, { nodeId: inside.treeNodeId, newParentId: null, newPosition: 0 });
    await expect(service().readShared(folderLink.token, { viewerId: recipient, documentId: inside.documentId })).rejects.toMatchObject(notFound);
    expect(await service().readSharedTarget(folderLink.token, { viewerId: recipient, documentId: inside.documentId })).toEqual({ kind: "FOLDER", documentId: null, audience: "NAMED" });
  });

  it("refuses a removed recipient, and everyone once revoked", async () => {
    const { folderLink, recipient, owner, caller } = await setup();
    await unitOfWork().run((r) => r.shareLinks.removeRecipient(folderLink.id, recipient));
    await expect(service().readShared(folderLink.token, { viewerId: recipient })).rejects.toMatchObject(notFound);
    await expect(service().readSharedTarget(folderLink.token, { viewerId: recipient })).rejects.toMatchObject(notFound);
    await service().revoke(caller, folderLink.id);
    await expect(service().readShared(folderLink.token, { viewerId: owner.id })).rejects.toMatchObject(notFound);
    await expect(service().readSharedTarget(folderLink.token, { viewerId: owner.id })).rejects.toMatchObject(notFound);
  });
});

describe("the link id a NAMED read carries", () => {
  it("names the link to its reader, so the Hub can mark their Inbox entry read", async () => {
    const { documentLink, folderLink, recipient, inside } = await setup();
    expect(await service().readShared(documentLink.token, { viewerId: recipient })).toMatchObject({ linkId: documentLink.id });
    expect(await service().readShared(folderLink.token, { viewerId: recipient, documentId: inside.documentId })).toMatchObject({ linkId: folderLink.id });
    expect(await service().readShared(documentLink.token, { viewerId: recipient, recordView: false })).toMatchObject({ linkId: documentLink.id });
  });

  it("is never on a LINK read, which serves anyone", async () => {
    const { caller, inside, folderNodeId } = await setup();
    for (const created of [await service().create(caller, { documentId: inside.documentId }), await service().createForFolder(caller, { folderNodeId })]) {
      expect(await service().readShared(created.path.slice("/s/".length))).not.toHaveProperty("linkId");
    }
  });
});

describe("a LINK share is unchanged", () => {
  it("opens without a caller, and for any caller, with audience LINK", async () => {
    const { caller, inside, folderNodeId, stranger } = await setup();
    const documentLink = await service().create(caller, { documentId: inside.documentId });
    const folderLink = await service().createForFolder(caller, { folderNodeId });
    const tokenOf = (path: string) => path.slice("/s/".length);
    for (const options of [{}, { viewerId: null }, { viewerId: stranger }]) {
      expect(await service().readShared(tokenOf(documentLink.path), options)).toMatchObject({ kind: "DOCUMENT", title: "Inside", audience: "LINK" });
      expect(await service().readSharedTarget(tokenOf(documentLink.path), options)).toEqual({ kind: "DOCUMENT", documentId: inside.documentId, audience: "LINK" });
      expect(await service().readShared(tokenOf(folderLink.path), options)).toMatchObject({ kind: "FOLDER", audience: "LINK", document: { documentId: inside.documentId } });
      expect(await service().readSharedTarget(tokenOf(folderLink.path), options)).toEqual({ kind: "FOLDER", documentId: inside.documentId, audience: "LINK" });
    }
  });
});
