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

/** Discussions and follows through a Source link (source share spec §6). */
let pool: Pool;
beforeAll(() => { pool = createDatabasePool(databaseConfig("test")); });
afterAll(async () => { await pool.end(); });

const MARKDOWN = "A secret passage here.";
const notFound = { code: "SHARE_LINK_NOT_FOUND" };

/** A clock that moves only when told, so "after seen" is never decided by two calls landing in one millisecond. */
function steppingClock() {
  let now = Date.UTC(2026, 9, 29, 9, 0);
  return { clock: () => new Date(now), tick: () => { now += 1000; } };
}

/**
 * Source root:
 * Shared/
 *   Engineering/
 *     Dev setup   (the deep document discussed)
 *   FAQ
 * Outside         (another document in the shared Source, also shared by its own document link)
 */
async function fixture() {
  const uow = new MariaDbUnitOfWork(pool);
  const identity = (name: string) => ({ id: uuidv7(), emp_id: randomUUID(), name, org_code: "FOLDER-REVIEW" });
  const ownerId = identity("Owner"), readerId = identity("Reader"), otherId = identity("Other");
  await uow.run(async r => { for (const user of [ownerId, readerId, otherId]) await r.users.upsertIdentity(user); });
  const owner = callerFromIdentity(ownerId), reader = callerFromIdentity(readerId), other = callerFromIdentity(otherId);
  const { workspace } = await new PersonalWorkspaceService(uow).ensurePersonalWorkspace(ownerId.id);
  const sourceId = await ensureDefaultHubSource(uow, owner, workspace.id);
  const hub = new HubKnowledgeCommandServiceImpl(uow);
  const doc = (parentId: string | null, title: string) => hub.createDocument(owner, { sourceId, parentId, title, markdown: MARKDOWN, metadata: {} });
  const { treeNodeId: folderNodeId } = await hub.createFolder(owner, { sourceId, parentId: null, name: "Shared" });
  const { treeNodeId: engineeringId } = await hub.createFolder(owner, { sourceId, parentId: folderNodeId, name: "Engineering" });
  const devSetup = await doc(engineeringId, "Dev setup");
  const faq = await doc(folderNodeId, "FAQ");
  const outside = await doc(null, "Outside");
  const shares = new DocumentShareService(uow, new RandomShareTokenIssuer());
  const link = await shares.createForSource(owner, { sourceId });
  const token = link.path.slice("/s/".length);
  const documentLink = await shares.create(owner, { documentId: outside.documentId });
  const documentToken = documentLink.path.slice("/s/".length);
  const block = projectReviewBlocks(MARKDOWN)[0];
  const anchor: ReviewAnchor = { schemaVersion: 1, blockPath: block.path, blockKind: block.kind, startUtf16: 2, endUtf16: 16, exact: "secret passage", prefix: "A ", suffix: " here." };
  const time = steppingClock();
  const service = new DocumentReviewService(uow, time.clock, () => true);
  const start = async (on = devSetup, caller = reader, body = "Reader asks") => {
    const thread = await service.createForLink(caller, { token, documentId: on.documentId, expectedRevisionId: on.revisionId, anchor, body, idempotencyKey: randomUUID() });
    time.tick();
    return thread;
  };
  const ownerReply = async (threadId: string, on = devSetup, body = "Owner answers") => {
    await service.replyForOwner(owner, { documentId: on.documentId, threadId, body, idempotencyKey: randomUUID() });
    time.tick();
  };
  const move = (nodeId: string, newParentId: string | null) => hub.moveTreeNode(owner, { nodeId, newParentId, newPosition: 0 });
  const follows = async (caller = reader) => (await service.listUnreadForOwner(caller)).notifications.filter(n => n.kind === "FOLLOW");
  /** The activity feed lists a dead link's entry too; the unread list leaves it out (nothing unread). */
  const activity = async (caller = reader) => (await service.listActivityForOwner(caller)).notifications.filter(n => n.kind === "FOLLOW");
  const discussions = async (caller = reader) => (await service.listFollowedDiscussions(caller)).items;
  return { uow, service, shares, hub, sourceId, link, token, documentLink, documentToken, anchor, owner, reader, other, folderNodeId, engineeringId, devSetup, faq, outside, time, start, ownerReply, move, follows, activity, discussions };
}

describe("discussions through a Source link", () => {
  it("records origin, owner notice, and follow; queries only the requested document", async () => {
    const f = await fixture();
    const thread = await f.start();
    await f.start(f.faq);
    expect(await f.uow.run(r => r.reviewThreads.findById(thread.id))).toMatchObject({ documentId: f.devSetup.documentId, originShareLinkId: f.link.id });
    expect(await f.uow.run(r => r.shareCommentEvents.listUnreadByRecipient(f.owner.identity.id))).toEqual(expect.arrayContaining([expect.objectContaining({ documentId: f.devSetup.documentId, threadId: thread.id, originShareLinkId: f.link.id })]));
    expect(await f.uow.run(r => r.reviewFollows.listFollowing(f.reader.identity.id, 10))).toEqual(expect.arrayContaining([expect.objectContaining({ threadId: thread.id, shareLinkId: f.link.id })]));
    expect((await f.service.queryForLink(null, f.token, f.devSetup.documentId)).threads.map(t => t.id)).toEqual([thread.id]);
    expect((await f.service.mentionLinksForOwner(f.owner, { documentId: f.devSetup.documentId })).links).toEqual(expect.arrayContaining([expect.objectContaining({ id: f.link.id, targetKind: "SOURCE" })]));
  });
  it("refuses missing and foreign documents, document link parameters, and another document's thread", async () => {
    const f = await fixture();
    const strangerId = { id: uuidv7(), emp_id: randomUUID(), name: "Stranger", org_code: "FOREIGN" };
    await f.uow.run(r => r.users.upsertIdentity(strangerId));
    const stranger = callerFromIdentity(strangerId);
    const { workspace } = await new PersonalWorkspaceService(f.uow).ensurePersonalWorkspace(strangerId.id);
    const sourceId = await ensureDefaultHubSource(f.uow, stranger, workspace.id);
    const foreign = await f.hub.createDocument(stranger, { sourceId, parentId: null, title: "Foreign", markdown: MARKDOWN, metadata: {} });
    await expect(f.service.queryForLink(null, f.token)).rejects.toMatchObject(notFound);
    await expect(f.service.queryForLink(null, f.token, foreign.documentId)).rejects.toMatchObject(notFound);
    await expect(f.service.queryForLink(null, f.documentToken, f.outside.documentId)).rejects.toMatchObject(notFound);
    const thread = await f.start(f.faq);
    await expect(f.service.replyForLink(f.reader, { token: f.token, documentId: f.devSetup.documentId, threadId: thread.id, body: "x", idempotencyKey: randomUUID() })).rejects.toMatchObject(notFound);
  });
  it("hides archived documents from writes and follows, restores them, and permits dead-link unfollow", async () => {
    const f = await fixture();
    const thread = await f.start();
    await f.ownerReply(thread.id);
    const inbox = async () => (await f.service.listInbox(f.reader, { kind: "follow", status: "all", unread: false })).discussions;
    const liveRow = expect.objectContaining({ threadId: thread.id, kind: "FOLLOW", documentId: f.devSetup.documentId, sourceId: f.sourceId, documentTitle: "Dev setup", token: f.token, href: `/s/${f.token}?d=${f.devSetup.documentId}&thread=${thread.id}` });
    expect(await inbox()).toEqual([liveRow]);
    expect(await f.discussions()).toEqual([expect.objectContaining({ threadId: thread.id, linkAvailable: true, documentId: f.devSetup.documentId })]);
    await f.hub.archiveDocument(f.owner, f.devSetup.documentId);
    const scope = { token: f.token, documentId: f.devSetup.documentId, threadId: thread.id };
    await expect(f.service.createForLink(f.reader, { ...scope, expectedRevisionId: f.devSetup.revisionId, anchor: f.anchor, body: "x", idempotencyKey: randomUUID() })).rejects.toMatchObject(notFound);
    await expect(f.service.replyForLink(f.reader, { ...scope, body: "x", idempotencyKey: randomUUID() })).rejects.toMatchObject(notFound);
    await expect(f.service.followForLink(f.reader, { ...scope, following: true })).rejects.toMatchObject(notFound);
    await expect(f.service.markSeenForLink(f.reader, scope)).rejects.toMatchObject(notFound);
    expect(await f.discussions()).toEqual([{ threadId: thread.id, linkAvailable: false }]);
    expect(await f.activity()).toEqual([expect.objectContaining({ threadId: thread.id, linkAvailable: false, documentId: "", documentTitle: "" })]);
    // The Inbox index delegates to the same follow availability judgement, but omits dead rows entirely.
    expect(await inbox()).toEqual([]);
    await f.hub.restoreDocument(f.owner, f.devSetup.documentId);
    expect(await f.discussions()).toEqual([expect.objectContaining({ threadId: thread.id, linkAvailable: true })]);
    expect(await inbox()).toEqual([liveRow]);
    await f.hub.archiveDocument(f.owner, f.devSetup.documentId);
    expect(await f.service.unfollowOwn(f.reader, thread.id)).toEqual({ following: false });
  });
});
