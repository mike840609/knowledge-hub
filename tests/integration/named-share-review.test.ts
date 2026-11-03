import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { RandomShareTokenIssuer } from "@/infrastructure/security/random-share-token-issuer";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import { DocumentShareService } from "@/modules/knowledge/application/document-share-service";
import { DocumentReviewService } from "@/modules/knowledge/application/document-review-service";
import { HubKnowledgeCommandServiceImpl } from "@/modules/knowledge/application/hub-knowledge-command-service";
import { SavedShareService } from "@/modules/knowledge/application/saved-share-service";
import type { ReviewAnchor } from "@/modules/knowledge/domain/document-review";
import type { DocumentShareLink } from "@/modules/knowledge/domain/document-share-link";
import { projectReviewBlocks } from "@/modules/knowledge/domain/review-anchor";
import { ensureDefaultHubSource } from "@/modules/sources/application/ensure-default-hub-source";
import { PersonalWorkspaceService } from "@/modules/workspaces/application/personal-workspace-service";
import { uuidv7 } from "@/shared/ids/uuidv7";

/**
 * Named-recipient share spec, "Discussions and mentions": through a NAMED link only a signed-in
 * recipient or the owner discusses or follows; every refusal a non-recipient sees is the dead link's
 * ShareLinkNotFoundError. A mention of a non-recipient is a proposal that grants nothing
 * (named-share-mention-proposals.test.ts covers it in full).
 */
let pool: Pool;
beforeAll(() => { pool = createDatabasePool(databaseConfig("test")); });
afterAll(async () => { await pool.end(); });

const MARKDOWN = "A secret passage here.";
const notFound = { code: "SHARE_LINK_NOT_FOUND" };

async function fixture() {
  const uow = new MariaDbUnitOfWork(pool);
  // A shared word in every name, so one query matches recipients and strangers alike.
  const tag = `Named${randomUUID().slice(0, 8)}`;
  const identity = (name: string) => ({ id: uuidv7(), emp_id: randomUUID(), name: `${tag} ${name}`, org_code: "NAMED-REVIEW" });
  const ids = { owner: identity("Owner"), recipient: identity("Recipient"), colleague: identity("Colleague"), stranger: identity("Stranger") };
  await uow.run(async r => { for (const user of Object.values(ids)) await r.users.upsertIdentity(user); });
  const owner = callerFromIdentity(ids.owner), recipient = callerFromIdentity(ids.recipient);
  const colleague = callerFromIdentity(ids.colleague), stranger = callerFromIdentity(ids.stranger);
  const { workspace } = await new PersonalWorkspaceService(uow).ensurePersonalWorkspace(ids.owner.id);
  const { workspace: recipientWorkspace } = await new PersonalWorkspaceService(uow).ensurePersonalWorkspace(ids.recipient.id);
  const { workspace: colleagueWorkspace } = await new PersonalWorkspaceService(uow).ensurePersonalWorkspace(ids.colleague.id);
  const sourceId = await ensureDefaultHubSource(uow, owner, workspace.id);
  const doc = await new HubKnowledgeCommandServiceImpl(uow).createDocument(owner, { sourceId, parentId: null, title: "Named doc", markdown: MARKDOWN, metadata: {} });
  const at = new Date();
  const link: DocumentShareLink = {
    id: uuidv7(), target: { kind: "DOCUMENT", documentId: doc.documentId }, token: randomUUID(), label: null, audience: "NAMED",
    createdBy: ids.owner.id, createdAt: at, expiresAt: null, revokedBy: null, revokedAt: null,
  };
  await uow.run(async r => {
    await r.shareLinks.insert(link);
    await r.shareLinks.insertRecipients(link.id, [ids.recipient.id, ids.colleague.id], ids.owner.id, at);
  });
  const block = projectReviewBlocks(MARKDOWN)[0];
  const anchor: ReviewAnchor = { schemaVersion: 1, blockPath: block.path, blockKind: block.kind, startUtf16: 2, endUtf16: 16, exact: "secret passage", prefix: "A ", suffix: " here." };
  const service = new DocumentReviewService(uow, () => new Date(), () => true);
  const start = (caller = recipient, mentions?: string[]) => service.createForLink(caller, { token: link.token, expectedRevisionId: doc.revisionId, anchor, body: "A question", idempotencyKey: randomUUID(), mentions });
  const reply = (caller: typeof owner, threadId: string, mentions?: string[]) => service.replyForLink(caller, { token: link.token, threadId, body: "An answer", idempotencyKey: randomUUID(), mentions });
  const removeRecipient = (userId: string) => uow.run(r => r.shareLinks.removeRecipient(link.id, userId));
  const storedMentions = async () => (await pool.query("SELECT m.mentioned_user_id AS id FROM review_comment_mentions m JOIN document_review_comments c ON c.id=m.comment_id JOIN document_review_threads t ON t.id=c.thread_id WHERE t.document_id=?", [doc.documentId])).map((row: { id: string }) => row.id);
  return { uow, tag, ids, owner, recipient, colleague, stranger, recipientWorkspace, colleagueWorkspace, doc, link, anchor, service, start, reply, removeRecipient, storedMentions };
}

describe("discussions on a NAMED link", () => {
  it("are read and written by a recipient, and refused to a stranger and to no one signed in", async () => {
    const f = await fixture();
    const thread = await f.start();
    await f.reply(f.recipient, thread.id);
    const read = await f.service.queryForLink(f.recipient, f.link.token);
    expect(read.threads.map(t => t.id)).toEqual([thread.id]);
    expect(read.threads[0].comments).toHaveLength(2);
    await expect(f.service.queryForLink(f.stranger, f.link.token)).rejects.toMatchObject(notFound);
    await expect(f.service.queryForLink(null, f.link.token)).rejects.toMatchObject(notFound);
    await expect(f.start(f.stranger)).rejects.toMatchObject(notFound);
    await expect(f.reply(f.stranger, thread.id)).rejects.toMatchObject(notFound);
    await expect(f.service.followForLink(f.stranger, { token: f.link.token, threadId: thread.id, following: true })).rejects.toMatchObject(notFound);
    await expect(f.service.markSeenForLink(f.stranger, { token: f.link.token, threadId: thread.id })).rejects.toMatchObject(notFound);
  });

  it("refuse edit, delete, follow and mark-seen to a stranger and to a removed recipient, as a dead link does", async () => {
    const f = await fixture();
    const thread = await f.start();
    const commentId = thread.comments[0].id;
    const writes = (caller: typeof f.owner) => [
      () => f.service.editForLink(caller, { token: f.link.token, threadId: thread.id, commentId, body: "Edited" }),
      () => f.service.deleteForLink(caller, { token: f.link.token, threadId: thread.id, commentId }),
      () => f.service.followForLink(caller, { token: f.link.token, threadId: thread.id, following: true }),
      () => f.service.markSeenForLink(caller, { token: f.link.token, threadId: thread.id }),
    ];
    for (const write of writes(f.stranger)) await expect(write()).rejects.toMatchObject(notFound);
    await f.removeRecipient(f.ids.recipient.id);
    // Their own comment: only the link's audience stops them.
    for (const write of writes(f.recipient)) await expect(write()).rejects.toMatchObject(notFound);
    const kept = await f.service.queryForOwner(f.owner, f.doc.documentId);
    expect(kept.threads[0].comments.map(c => c.body)).toEqual(["A question"]);
  });

  it("are read by the owner through the link", async () => {
    const f = await fixture();
    const thread = await f.start();
    expect((await f.service.queryForLink(f.owner, f.link.token)).threads.map(t => t.id)).toEqual([thread.id]);
  });
});

describe("mentions through a NAMED link", () => {
  it("store a mention of another recipient", async () => {
    const f = await fixture();
    const thread = await f.start(f.recipient, [f.ids.colleague.id]);
    expect(await f.storedMentions()).toEqual([f.ids.colleague.id]);
    expect((await f.service.listUnreadForOwner(f.colleague)).notifications.filter(n => n.kind === "MENTION"))
      .toEqual([expect.objectContaining({ threadId: thread.id, token: f.link.token, linkAvailable: true, href: `/w/${f.colleagueWorkspace.id}/shares/${f.link.token}?thread=${thread.id}` })]);
  });

  it("store a recipient's mention of a non-recipient on a thread or a reply as dead, opening nothing to them", async () => {
    const f = await fixture();
    await f.start(f.recipient, [f.ids.stranger.id]);
    const thread = await f.start();
    await f.reply(f.recipient, thread.id, [f.ids.stranger.id]);
    expect(await f.storedMentions()).toEqual([f.ids.stranger.id, f.ids.stranger.id]);
    await expect(f.service.queryForLink(f.stranger, f.link.token)).rejects.toMatchObject(notFound);
    expect((await f.service.listUnreadForOwner(f.stranger)).notifications.filter(n => n.kind === "MENTION" && n.linkAvailable)).toEqual([]);
  });

  it("offer recipients first, then matching strangers flagged as needing approval", async () => {
    const f = await fixture();
    const found = await f.service.searchMentionCandidates(f.recipient, { query: f.tag, token: f.link.token });
    expect(found.candidates.map(c => [c.id, c.needsApproval])).toEqual([[f.ids.colleague.id, false], [f.ids.stranger.id, true]]);
    expect((await f.service.searchMentionCandidates(f.recipient, { query: f.ids.stranger.emp_id, token: f.link.token })).candidates.map(c => c.id)).toEqual([f.ids.stranger.id]);
    await expect(f.service.searchMentionCandidates(f.stranger, { query: f.tag, token: f.link.token })).rejects.toMatchObject(notFound);
  });

  it("are handed over by the owner to anyone, adding the people the link does not name", async () => {
    const f = await fixture();
    expect((await f.service.mentionLinksForOwner(f.owner, { documentId: f.doc.documentId })).links).toEqual([{ id: f.link.id, label: null, audience: "NAMED" }]);
    const write = (mentions: string[]) => f.service.createForOwner(f.owner, {
      documentId: f.doc.documentId, expectedRevisionId: f.doc.revisionId, anchor: f.anchor, body: "Look", idempotencyKey: randomUUID(), mentions, mentionLinkId: f.link.id,
    });
    await write([f.ids.recipient.id]);
    expect(await f.storedMentions()).toEqual([f.ids.recipient.id]);
    await write([f.ids.stranger.id]);
    expect((await f.service.queryForLink(f.stranger, f.link.token)).threads).toHaveLength(2);
  });
});

describe("a recipient's follow on a NAMED link", () => {
  it("brings the owner's reply to their Inbox, and names nothing once they are removed", async () => {
    const f = await fixture();
    const thread = await f.start(f.owner);
    await f.service.followForLink(f.recipient, { token: f.link.token, threadId: thread.id, following: true });
    await f.service.replyForOwner(f.owner, { documentId: f.doc.documentId, threadId: thread.id, body: "Owner answers", idempotencyKey: randomUUID() });
    // Being named also put the share itself in their Inbox (named-share-inbox.test.ts); this is about the follow.
    expect((await f.service.listUnreadForOwner(f.recipient)).notifications.filter(n => n.kind === "FOLLOW"))
      .toEqual([expect.objectContaining({ kind: "FOLLOW", threadId: thread.id, token: f.link.token, linkAvailable: true, href: `/w/${f.recipientWorkspace.id}/shares/${f.link.token}?thread=${thread.id}` })]);
    // Shares → Discussions opens the same Hub reader: `/s/<token>` is the dead link's page for a NAMED share.
    expect((await f.service.listFollowedDiscussions(f.recipient)).items)
      .toEqual([expect.objectContaining({ threadId: thread.id, linkAvailable: true, href: `/w/${f.recipientWorkspace.id}/shares/${f.link.token}?thread=${thread.id}` })]);
    await f.reply(f.recipient, thread.id);
    await f.removeRecipient(f.ids.recipient.id);
    expect((await f.service.listUnreadForOwner(f.recipient)).notifications).toEqual([]);
    const activity = (await f.service.listActivityForOwner(f.recipient)).notifications.filter(n => n.kind === "FOLLOW");
    expect(activity).toEqual([expect.objectContaining({ linkAvailable: false, documentTitle: "", excerpt: "" })]);
    expect(activity[0]).not.toHaveProperty("token");
    expect((await f.service.listFollowedDiscussions(f.recipient)).items).toEqual([{ threadId: thread.id, linkAvailable: false }]);
    expect((await f.service.countUnreadForOwner(f.recipient)).count).toBe(0);
    await expect(f.reply(f.recipient, thread.id)).rejects.toMatchObject(notFound);
    await expect(f.service.queryForLink(f.recipient, f.link.token)).rejects.toMatchObject(notFound);
    // Their earlier comment stays in the discussion, attributed as before.
    const owned = await f.service.queryForOwner(f.owner, f.doc.documentId);
    expect(owned.threads[0].comments.map(c => c.authorName)).toContain(`${f.tag} Recipient`);
  });

  it("a mention of a removed recipient names nothing", async () => {
    const f = await fixture();
    await f.start(f.recipient, [f.ids.colleague.id]);
    await f.removeRecipient(f.ids.colleague.id);
    expect((await f.service.listUnreadForOwner(f.colleague)).notifications).toEqual([]);
    expect((await f.service.listActivityForOwner(f.colleague)).notifications.filter(n => n.kind === "MENTION"))
      .toEqual([expect.objectContaining({ linkAvailable: false, documentTitle: "" })]);
  });
});

describe("saving a NAMED link", () => {
  it("is refused to a recipient, as a dead link is", async () => {
    const f = await fixture();
    await expect(new SavedShareService(f.uow).save(f.recipient, f.link.token)).rejects.toMatchObject(notFound);
  });
});

/**
 * Shared/
 *   Inside    (discussed through the folder's NAMED link)
 * The folder's link names `recipient` only; `targetScope`'s folder branch judges every write.
 */
describe("writes through a NAMED folder link", () => {
  async function folderFixture() {
    const f = await fixture();
    const hub = new HubKnowledgeCommandServiceImpl(f.uow);
    const sourceId = (await f.uow.run(r => r.documents.findById(f.doc.documentId)))!.sourceId;
    const { treeNodeId: folderNodeId } = await hub.createFolder(f.owner, { sourceId, parentId: null, name: "Shared" });
    const inside = await hub.createDocument(f.owner, { sourceId, parentId: folderNodeId, title: "Inside", markdown: MARKDOWN, metadata: {} });
    const shares = new DocumentShareService(f.uow, new RandomShareTokenIssuer());
    const token = (await shares.createForFolder(f.owner, { folderNodeId, recipients: [f.ids.recipient.id] })).path.slice("/s/".length);
    const write = (caller: typeof f.owner) => f.service.createForLink(caller, { token, documentId: inside.documentId, expectedRevisionId: inside.revisionId, anchor: f.anchor, body: "Folder question", idempotencyKey: randomUUID() });
    const move = (newParentId: string | null) => hub.moveTreeNode(f.owner, { nodeId: inside.treeNodeId, newParentId, newPosition: 0 });
    return { ...f, token, inside, folderNodeId, write, move };
  }

  it("succeed for a recipient on a document under the folder", async () => {
    const f = await folderFixture();
    const thread = await f.write(f.recipient);
    expect((await f.service.queryForLink(f.recipient, f.token, f.inside.documentId)).threads.map(t => t.id)).toEqual([thread.id]);
  });

  it("are refused to a signed-in reader the link does not name, as a dead link is", async () => {
    const f = await folderFixture();
    await expect(f.write(f.stranger)).rejects.toMatchObject(notFound);
    await expect(f.write(f.colleague)).rejects.toMatchObject(notFound);
  });

  it("are refused to a recipient once the document is moved out of the folder", async () => {
    const f = await folderFixture();
    const thread = await f.write(f.recipient);
    await f.move(null);
    await expect(f.write(f.recipient)).rejects.toMatchObject(notFound);
    await expect(f.service.replyForLink(f.recipient, { token: f.token, documentId: f.inside.documentId, threadId: thread.id, body: "Still here?", idempotencyKey: randomUUID() })).rejects.toMatchObject(notFound);
  });
});
