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
import type { KnowledgeUnitOfWork } from "@/modules/knowledge/ports/unit-of-work";
import { projectReviewBlocks } from "@/modules/knowledge/domain/review-anchor";
import { ensureDefaultHubSource } from "@/modules/sources/application/ensure-default-hub-source";
import { PersonalWorkspaceService } from "@/modules/workspaces/application/personal-workspace-service";
import { uuidv7 } from "@/shared/ids/uuidv7";

/** Discussions and follows through a folder link (folder share spec §6). */
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
 * Shared/
 *   Engineering/
 *     Dev setup   (the deep document discussed)
 *   FAQ
 * Outside         (My Space root, outside the shared folder; also shared by its own document link)
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
  const link = await shares.createForFolder(owner, { folderNodeId });
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

/** Records the ids of every Source and Workspace a run locks, passing everything else through. */
function lockRecorder(inner: KnowledgeUnitOfWork) {
  const taken: string[] = [];
  const spying = <T extends object>(target: T, method: string): T => new Proxy(target, {
    get(object, property) {
      const value = Reflect.get(object, property, object);
      if (typeof value !== "function") return value;
      if (property !== method) return value.bind(object);
      return (...args: unknown[]) => { taken.push(String(args[0])); return value.apply(object, args); };
    },
  });
  const uow: KnowledgeUnitOfWork = {
    run: work => inner.run(r => work(new Proxy(r, {
      get(object, property) {
        const value = Reflect.get(object, property, object);
        if (property === "sourcePolicy") return spying(value, "lockById");
        if (property === "workspaces") return spying(value, "lockSharedById");
        return value;
      },
    }))),
  };
  return { uow, taken };
}

/** Records every repository method a read calls, without changing what it returns. */
function queryRecorder(inner: KnowledgeUnitOfWork) {
  const calls: string[] = [];
  const spying = <T extends object>(target: T, namespace: string): T => new Proxy(target, {
    get(object, property) {
      const value = Reflect.get(object, property, object);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => { calls.push(`${namespace}.${String(property)}`); return value.apply(object, args); };
    },
  });
  const uow: KnowledgeUnitOfWork = {
    run: work => inner.run(r => work(new Proxy(r, {
      get(object, property) {
        const value = Reflect.get(object, property, object);
        return value !== null && typeof value === "object" ? spying(value, String(property)) : value;
      },
    }))),
  };
  return { uow, calls };
}

describe("a discussion started through a folder link", () => {
  it("records the folder link as its origin, tells the owner which document, and follows it for the reader", async () => {
    const f = await fixture();
    const thread = await f.start();
    const stored = await f.uow.run(r => r.reviewThreads.findById(thread.id));
    expect(stored).toMatchObject({ documentId: f.devSetup.documentId, originShareLinkId: f.link.id });
    const events = await f.uow.run(r => r.shareCommentEvents.listUnreadByRecipient(f.owner.identity.id));
    expect(events).toEqual([expect.objectContaining({ documentId: f.devSetup.documentId, threadId: thread.id, originShareLinkId: f.link.id, createdByUserId: f.reader.identity.id })]);
    const following = await f.uow.run(r => r.reviewFollows.listFollowing(f.reader.identity.id, 10));
    expect(following).toEqual([expect.objectContaining({ threadId: thread.id, shareLinkId: f.link.id })]);
    expect((await f.service.queryForLink(f.reader, f.token, f.devSetup.documentId)).threads[0]).toMatchObject({ id: thread.id, following: true });
  });

  it("answers the anonymous query with that document's visible discussions only", async () => {
    const f = await fixture();
    const onSetup = await f.start();
    await f.start(f.faq, f.reader, "About the FAQ");
    const result = await f.service.queryForLink(null, f.token, f.devSetup.documentId);
    expect(result.threads.map(thread => thread.id)).toEqual([onSetup.id]);
    expect(result).toMatchObject({ revisionId: f.devSetup.revisionId, writesEnabled: false, callerUserId: null });
    expect((await f.service.queryForLink(null, f.token, f.faq.documentId)).threads.map(thread => thread.comments[0].body)).toEqual(["About the FAQ"]);
  });

  it("replies, edits, deletes, follows and marks seen through the folder link on the same document", async () => {
    const f = await fixture();
    const thread = await f.start();
    const scope = { token: f.token, documentId: f.devSetup.documentId, threadId: thread.id };
    const reply = await f.service.replyForLink(f.other, { ...scope, body: "Other replies", idempotencyKey: randomUUID() });
    await f.service.editForLink(f.other, { ...scope, commentId: reply.id, body: "Other edits" });
    await f.service.deleteForLink(f.other, { ...scope, commentId: reply.id });
    expect(await f.service.followForLink(f.other, { ...scope, following: false })).toEqual({ following: false });
    await f.service.markSeenForLink(f.reader, scope);
    const comments = (await f.service.queryForLink(f.other, f.token, f.devSetup.documentId)).threads[0].comments;
    expect(comments.map(comment => comment.deleted)).toEqual([false, true]);
  });
});

describe("what a folder link refuses, all alike", () => {
  it("a folder link without a document, or with one outside the folder, archived, unknown or malformed", async () => {
    const f = await fixture();
    await new HubKnowledgeCommandServiceImpl(f.uow).archiveDocument(f.owner, f.faq.documentId);
    for (const documentId of [undefined, f.outside.documentId, f.faq.documentId, uuidv7(), "not-a-uuid", f.devSetup.documentId.toUpperCase().replace(/-/g, "")]) {
      await expect(f.service.queryForLink(null, f.token, documentId), String(documentId)).rejects.toMatchObject(notFound);
      await expect(f.service.createForLink(f.reader, { token: f.token, documentId, expectedRevisionId: f.devSetup.revisionId, anchor: f.anchor, body: "x", idempotencyKey: randomUUID() }), String(documentId)).rejects.toMatchObject(notFound);
    }
  });

  it("any document on a document link, even its own", async () => {
    const f = await fixture();
    for (const documentId of [f.outside.documentId, f.devSetup.documentId, "not-a-uuid"]) {
      await expect(f.service.queryForLink(null, f.documentToken, documentId), documentId).rejects.toMatchObject(notFound);
      await expect(f.service.createForLink(f.reader, { token: f.documentToken, documentId, expectedRevisionId: f.outside.revisionId, anchor: f.anchor, body: "x", idempotencyKey: randomUUID() }), documentId).rejects.toMatchObject(notFound);
    }
    await expect(f.service.queryForLink(null, f.documentToken)).resolves.toMatchObject({ threads: [] });
  });

  it("a revoked folder link, whatever document it names", async () => {
    const f = await fixture();
    await f.shares.revoke(f.owner, f.link.id);
    await expect(f.service.queryForLink(null, f.token, f.devSetup.documentId)).rejects.toMatchObject(notFound);
  });

  it("a discussion on another document in the same folder, named with this document", async () => {
    const f = await fixture();
    const onFaq = await f.start(f.faq);
    const comment = (await f.service.queryForLink(f.reader, f.token, f.faq.documentId)).threads[0].comments[0];
    const scope = { token: f.token, documentId: f.devSetup.documentId, threadId: onFaq.id };
    await expect(f.service.replyForLink(f.reader, { ...scope, body: "x", idempotencyKey: randomUUID() })).rejects.toMatchObject(notFound);
    await expect(f.service.followForLink(f.reader, { ...scope, following: false })).rejects.toMatchObject(notFound);
    await expect(f.service.markSeenForLink(f.reader, scope)).rejects.toMatchObject(notFound);
    await expect(f.service.editForLink(f.reader, { ...scope, commentId: comment.id, body: "x" })).rejects.toMatchObject(notFound);
    await expect(f.service.deleteForLink(f.reader, { ...scope, commentId: comment.id })).rejects.toMatchObject(notFound);
  });

  it("a document moved out of the folder after the reader loaded it: create, reply, edit, delete, follow and seen", async () => {
    const f = await fixture();
    const thread = await f.start();
    const opener = thread.comments[0];
    await f.move(f.devSetup.treeNodeId, null);
    const scope = { token: f.token, documentId: f.devSetup.documentId, threadId: thread.id };
    await expect(f.service.createForLink(f.reader, { token: f.token, documentId: f.devSetup.documentId, expectedRevisionId: f.devSetup.revisionId, anchor: f.anchor, body: "x", idempotencyKey: randomUUID() })).rejects.toMatchObject(notFound);
    await expect(f.service.replyForLink(f.reader, { ...scope, body: "x", idempotencyKey: randomUUID() })).rejects.toMatchObject(notFound);
    await expect(f.service.editForLink(f.reader, { ...scope, commentId: opener.id, body: "x" })).rejects.toMatchObject(notFound);
    await expect(f.service.deleteForLink(f.reader, { ...scope, commentId: opener.id })).rejects.toMatchObject(notFound);
    await expect(f.service.followForLink(f.reader, { ...scope, following: true })).rejects.toMatchObject(notFound);
    await expect(f.service.markSeenForLink(f.reader, scope)).rejects.toMatchObject(notFound);
    await expect(f.service.queryForLink(f.reader, f.token, f.devSetup.documentId)).rejects.toMatchObject(notFound);
  });

  // A folder link reaches only its own Source: a document elsewhere is refused before anything of it is locked.
  it("a document in someone else's My Space, refused as missing without locking its Source or Workspace", async () => {
    const f = await fixture();
    const strangerId = { id: uuidv7(), emp_id: randomUUID(), name: "Stranger", org_code: "FOLDER-REVIEW" };
    await f.uow.run(r => r.users.upsertIdentity(strangerId));
    const stranger = callerFromIdentity(strangerId);
    const { workspace } = await new PersonalWorkspaceService(f.uow).ensurePersonalWorkspace(strangerId.id);
    const strangerSourceId = await ensureDefaultHubSource(f.uow, stranger, workspace.id);
    const foreign = await new HubKnowledgeCommandServiceImpl(f.uow).createDocument(stranger, { sourceId: strangerSourceId, parentId: null, title: "Foreign", markdown: MARKDOWN, metadata: {} });
    const locks = lockRecorder(f.uow);
    const service = new DocumentReviewService(locks.uow, f.time.clock, () => true);
    const scope = { token: f.token, documentId: foreign.documentId };
    await expect(service.createForLink(f.reader, { ...scope, expectedRevisionId: foreign.revisionId, anchor: f.anchor, body: "x", idempotencyKey: randomUUID() })).rejects.toMatchObject(notFound);
    await expect(service.replyForLink(f.reader, { ...scope, threadId: uuidv7(), body: "x", idempotencyKey: randomUUID() })).rejects.toMatchObject(notFound);
    await expect(service.followForLink(f.reader, { ...scope, threadId: uuidv7(), following: true })).rejects.toMatchObject(notFound);
    expect(locks.taken).not.toContain(strangerSourceId);
    expect(locks.taken).not.toContain(workspace.id);
    expect(locks.taken).toEqual([]);
  });

  // A sibling in the same Source is outside the grant too: it must be refused before the Source lock.
  it("a same-Source document outside the shared subtree, refused as missing without locking its Source or Workspace", async () => {
    const f = await fixture();
    const locks = lockRecorder(f.uow);
    const service = new DocumentReviewService(locks.uow, f.time.clock, () => true);
    const scope = { token: f.token, documentId: f.outside.documentId };
    await expect(service.createForLink(f.reader, { ...scope, expectedRevisionId: f.outside.revisionId, anchor: f.anchor, body: "x", idempotencyKey: randomUUID() })).rejects.toMatchObject(notFound);
    await expect(service.replyForLink(f.reader, { ...scope, threadId: uuidv7(), body: "x", idempotencyKey: randomUUID() })).rejects.toMatchObject(notFound);
    await expect(service.followForLink(f.reader, { ...scope, threadId: uuidv7(), following: true })).rejects.toMatchObject(notFound);
    expect(locks.taken).toEqual([]);
  });

  it("a document under an archived folder inside the shared one: reads and writes alike", async () => {
    const f = await fixture();
    const thread = await f.start();
    const opener = thread.comments[0];
    const scope = { token: f.token, documentId: f.devSetup.documentId, threadId: thread.id };
    // The Hub refuses to archive a folder that still holds documents; the rule must hold if one is anyway.
    await f.uow.run(r => r.tree.updateStatus(f.engineeringId, "ARCHIVED", f.owner.identity.id));
    await expect(f.service.queryForLink(null, f.token, f.devSetup.documentId)).rejects.toMatchObject(notFound);
    await expect(f.service.createForLink(f.reader, { token: f.token, documentId: f.devSetup.documentId, expectedRevisionId: f.devSetup.revisionId, anchor: f.anchor, body: "x", idempotencyKey: randomUUID() })).rejects.toMatchObject(notFound);
    await expect(f.service.replyForLink(f.reader, { ...scope, body: "x", idempotencyKey: randomUUID() })).rejects.toMatchObject(notFound);
    await expect(f.service.editForLink(f.reader, { ...scope, commentId: opener.id, body: "x" })).rejects.toMatchObject(notFound);
    await expect(f.service.deleteForLink(f.reader, { ...scope, commentId: opener.id })).rejects.toMatchObject(notFound);
    await expect(f.service.followForLink(f.reader, { ...scope, following: false })).rejects.toMatchObject(notFound);
    await expect(f.service.markSeenForLink(f.reader, scope)).rejects.toMatchObject(notFound);
  });
});

describe("the follower's Inbox and Shares → Discussions, judged through the folder now", () => {
  it("is available while the document is in the folder, names nothing once it moves out, and is back when it returns", async () => {
    const f = await fixture();
    const thread = await f.start();
    await f.ownerReply(thread.id, f.devSetup, "PRIVATE ANSWER");
    expect(await f.follows()).toEqual([expect.objectContaining({ threadId: thread.id, linkAvailable: true, token: f.token, documentId: f.devSetup.documentId, documentTitle: "Dev setup", authorName: "Owner", replyCount: 1 })]);
    expect(await f.discussions()).toEqual([expect.objectContaining({ threadId: thread.id, linkAvailable: true, token: f.token, documentId: f.devSetup.documentId, documentTitle: "Dev setup" })]);

    await f.move(f.devSetup.treeNodeId, null);
    expect(await f.follows()).toEqual([]);
    const [dead] = await f.activity();
    expect(dead).toMatchObject({ threadId: thread.id, linkAvailable: false, documentTitle: "", documentId: "", workspaceId: "", sourceId: "", excerpt: "", authorName: undefined });
    expect(dead.token).toBeUndefined();
    expect(JSON.stringify(dead)).not.toContain("PRIVATE ANSWER");
    expect(await f.discussions()).toEqual([{ threadId: thread.id, linkAvailable: false }]);

    await f.move(f.devSetup.treeNodeId, f.engineeringId);
    expect(await f.follows()).toEqual([expect.objectContaining({ threadId: thread.id, linkAvailable: true, token: f.token })]);
    expect(await f.discussions()).toEqual([expect.objectContaining({ threadId: thread.id, linkAvailable: true })]);
  });

  it("judges each follow by its own link: a follow through the folder dies with the folder link, one through the document link does not", async () => {
    const f = await fixture();
    const inFolder = await f.start();
    const viaDocument = await f.service.createForLink(f.reader, { token: f.documentToken, expectedRevisionId: f.outside.revisionId, anchor: f.anchor, body: "On the outside", idempotencyKey: randomUUID() });
    f.time.tick();
    await f.shares.revoke(f.owner, f.link.id);
    const items = await f.discussions();
    expect(items).toEqual(expect.arrayContaining([
      { threadId: inFolder.id, linkAvailable: false },
      expect.objectContaining({ threadId: viaDocument.id, linkAvailable: true, token: f.documentToken }),
    ]));
    // A document link's follow carries no document id: its page needs none.
    expect(items.find(item => item.threadId === viaDocument.id)).not.toHaveProperty("documentId");
  });

  it("lets the reader unfollow with the link dead", async () => {
    const f = await fixture();
    const thread = await f.start();
    await f.move(f.devSetup.treeNodeId, null);
    expect(await f.service.unfollowOwn(f.reader, thread.id)).toEqual({ following: false });
    expect(await f.discussions()).toEqual([]);
  });

  it("counts a live folder follow's unread replies in the badge, and none once the document leaves", async () => {
    const f = await fixture();
    const thread = await f.start();
    await f.ownerReply(thread.id);
    expect(await f.service.countUnreadForOwner(f.reader)).toEqual({ count: 1 });
    await f.move(f.devSetup.treeNodeId, null);
    expect(await f.service.countUnreadForOwner(f.reader)).toEqual({ count: 0 });
  });

  it("judges each followed document under one folder link on its own: the one moved out goes quiet, the one inside stays", async () => {
    const f = await fixture();
    const stays = await f.start(f.faq);
    await f.ownerReply(stays.id, f.faq);
    const leaves = await f.start(f.devSetup);
    await f.ownerReply(leaves.id, f.devSetup);
    expect(await f.service.countUnreadForOwner(f.reader)).toEqual({ count: 2 });
    await f.move(f.devSetup.treeNodeId, null);
    expect(await f.service.countUnreadForOwner(f.reader)).toEqual({ count: 1 });
    expect((await f.follows()).map(n => n.threadId)).toEqual([stays.id]);
    expect(await f.discussions()).toEqual(expect.arrayContaining([
      expect.objectContaining({ threadId: stays.id, linkAvailable: true }),
      { threadId: leaves.id, linkAvailable: false },
    ]));
  });

  it("counts many follows on one folder link in batches, not one thread and chain read per follow", async () => {
    const f = await fixture();
    for (let index = 0; index < 12; index += 1) {
      const document = await f.hub.createDocument(f.owner, { sourceId: f.sourceId, parentId: f.folderNodeId, title: `Note ${index}`, markdown: MARKDOWN, metadata: {} });
      const thread = await f.start(document);
      await f.ownerReply(thread.id, document);
    }
    const counted = queryRecorder(f.uow);
    const service = new DocumentReviewService(counted.uow, f.time.clock, () => true);
    expect(await service.countUnreadForOwner(f.reader)).toEqual({ count: 12 });
    expect(counted.calls).not.toContain("reviewThreads.findById");
    expect(counted.calls).not.toContain("shareLinks.findById");
    expect(counted.calls).not.toContain("tree.listChain");
    expect(counted.calls).toContain("reviewThreads.findByIds");
    expect(counted.calls).toContain("tree.listChainsByDocumentIds");
    expect(counted.calls.length).toBeLessThan(20);
  });
});
