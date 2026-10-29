import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { RandomShareTokenIssuer } from "@/infrastructure/security/random-share-token-issuer";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import { DocumentReviewService } from "@/modules/knowledge/application/document-review-service";
import { DocumentShareService } from "@/modules/knowledge/application/document-share-service";
import { HubKnowledgeCommandServiceImpl } from "@/modules/knowledge/application/hub-knowledge-command-service";
import type { ReviewAnchor } from "@/modules/knowledge/domain/document-review";
import { projectReviewBlocks } from "@/modules/knowledge/domain/review-anchor";
import { ensureDefaultHubSource } from "@/modules/sources/application/ensure-default-hub-source";
import { PersonalWorkspaceService } from "@/modules/workspaces/application/personal-workspace-service";
import { uuidv7 } from "@/shared/ids/uuidv7";

/** A mention written through a folder link: the link carries it, and the page it opens names the document (`?d=`). */
let pool: Pool;
beforeAll(() => { pool = createDatabasePool(databaseConfig("test")); });
afterAll(async () => { await pool.end(); });

const MARKDOWN = "A secret passage here.";

async function fixture() {
  const uow = new MariaDbUnitOfWork(pool);
  const identity = (name: string) => ({ id: uuidv7(), emp_id: randomUUID(), name, org_code: "FOLDER-MENTION" });
  const ownerId = identity("Owner"), readerId = identity("Reader"), mentionedId = identity("Mentioned");
  await uow.run(async r => { for (const user of [ownerId, readerId, mentionedId]) await r.users.upsertIdentity(user); });
  const owner = callerFromIdentity(ownerId), reader = callerFromIdentity(readerId), mentioned = callerFromIdentity(mentionedId);
  const { workspace } = await new PersonalWorkspaceService(uow).ensurePersonalWorkspace(ownerId.id);
  const sourceId = await ensureDefaultHubSource(uow, owner, workspace.id);
  const hub = new HubKnowledgeCommandServiceImpl(uow);
  const { treeNodeId: folderNodeId } = await hub.createFolder(owner, { sourceId, parentId: null, name: "Shared" });
  const doc = await hub.createDocument(owner, { sourceId, parentId: folderNodeId, title: "Dev setup", markdown: MARKDOWN, metadata: {} });
  const shares = new DocumentShareService(uow, new RandomShareTokenIssuer());
  const link = await shares.createForFolder(owner, { folderNodeId });
  const token = link.path.slice("/s/".length);
  const block = projectReviewBlocks(MARKDOWN)[0];
  const anchor: ReviewAnchor = { schemaVersion: 1, blockPath: block.path, blockKind: block.kind, startUtf16: 2, endUtf16: 16, exact: "secret passage", prefix: "A ", suffix: " here." };
  const service = new DocumentReviewService(uow, () => new Date(), () => true);
  const mention = () => service.createForLink(reader, { token, documentId: doc.documentId, expectedRevisionId: doc.revisionId, anchor, body: "Please look", idempotencyKey: randomUUID(), mentions: [mentionedId.id] });
  const unread = async () => (await service.listUnreadForOwner(mentioned)).notifications.filter(n => n.kind === "MENTION");
  return { service, shares, hub, owner, reader, token, link, doc, folderNodeId, sourceId, mentionedId, mention, unread };
}

describe("mentions through a folder link", () => {
  it("reaches the person named, with the link's token and the document its page needs", async () => {
    const f = await fixture();
    await f.mention();
    expect(await f.unread()).toEqual([expect.objectContaining({ kind: "MENTION", token: f.token, documentId: f.doc.documentId, linkAvailable: true, authorName: "Reader" })]);
    expect((await f.service.countUnreadForOwner(callerFromIdentity({ id: f.mentionedId.id, emp_id: "", name: "", org_code: "" }))).count).toBe(1);
  });

  it("goes dead, naming nothing, once the document leaves the shared folder", async () => {
    const f = await fixture();
    await f.mention();
    const root = await f.hub.createFolder(f.owner, { sourceId: f.sourceId, parentId: null, name: "Elsewhere" });
    await f.hub.moveTreeNode(f.owner, { nodeId: (await pool.query("SELECT id FROM knowledge_tree_nodes WHERE document_id=?", [f.doc.documentId]))[0].id, newParentId: root.treeNodeId, newPosition: 0 });
    expect(await f.unread()).toEqual([]);
  });

  it("finds candidates on a folder link's page, and refuses the token without a document", async () => {
    const f = await fixture();
    const found = await f.service.searchMentionCandidates(f.reader, { query: f.mentionedId.emp_id, token: f.token, documentId: f.doc.documentId });
    expect(found.candidates.map(c => c.id)).toEqual([f.mentionedId.id]);
    await expect(f.service.searchMentionCandidates(f.reader, { query: f.mentionedId.emp_id, token: f.token })).rejects.toMatchObject({ code: "SHARE_LINK_NOT_FOUND" });
  });
});
