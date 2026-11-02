import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
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
 * recipient or the owner discusses, follows, is mentioned or is offered as a candidate; every
 * refusal a non-recipient sees is the dead link's ShareLinkNotFoundError.
 */
let pool: Pool;
beforeAll(() => { pool = createDatabasePool(databaseConfig("test")); });
afterAll(async () => { await pool.end(); });

const MARKDOWN = "A secret passage here.";
const notFound = { code: "SHARE_LINK_NOT_FOUND" };
const notRecipient = { code: "MENTION_NOT_RECIPIENT" };

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
  await new PersonalWorkspaceService(uow).ensurePersonalWorkspace(ids.recipient.id);
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
  return { uow, tag, ids, owner, recipient, colleague, stranger, doc, link, anchor, service, start, reply, removeRecipient, storedMentions };
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
      .toEqual([expect.objectContaining({ threadId: thread.id, token: f.link.token, linkAvailable: true })]);
  });

  it("refuse a mention of a non-recipient on a thread or a reply, storing nothing", async () => {
    const f = await fixture();
    await expect(f.start(f.recipient, [f.ids.stranger.id])).rejects.toMatchObject(notRecipient);
    await expect(f.start(f.recipient, [f.ids.colleague.id, f.ids.stranger.id])).rejects.toMatchObject(notRecipient);
    const thread = await f.start();
    await expect(f.reply(f.recipient, thread.id, [f.ids.stranger.id])).rejects.toMatchObject(notRecipient);
    expect(await f.storedMentions()).toEqual([]);
    expect((await f.service.queryForLink(f.recipient, f.link.token)).threads.map(t => t.comments.length)).toEqual([1]);
  });

  it("offer only recipients as candidates, never a matching stranger", async () => {
    const f = await fixture();
    const found = await f.service.searchMentionCandidates(f.recipient, { query: f.tag, token: f.link.token });
    expect(found.candidates.map(c => c.id)).toEqual([f.ids.colleague.id]);
    expect((await f.service.searchMentionCandidates(f.recipient, { query: f.ids.stranger.emp_id, token: f.link.token })).candidates).toEqual([]);
    await expect(f.service.searchMentionCandidates(f.stranger, { query: f.tag, token: f.link.token })).rejects.toMatchObject(notFound);
  });

  it("are handed over by the owner only to recipients", async () => {
    const f = await fixture();
    const offered = async (mentionedUserIds?: string[]) => (await f.service.mentionLinksForOwner(f.owner, { documentId: f.doc.documentId, mentionedUserIds })).links.map(l => l.id);
    expect(await offered([f.ids.recipient.id])).toEqual([f.link.id]);
    expect(await offered([])).toEqual([f.link.id]);
    expect(await offered([f.ids.stranger.id])).toEqual([]);
    expect(await offered([f.ids.recipient.id, f.ids.stranger.id])).toEqual([]);
    expect(await offered()).toEqual([]);
    const write = (mentions: string[]) => f.service.createForOwner(f.owner, {
      documentId: f.doc.documentId, expectedRevisionId: f.doc.revisionId, anchor: f.anchor, body: "Look", idempotencyKey: randomUUID(), mentions, mentionLinkId: f.link.id,
    });
    await expect(write([f.ids.stranger.id])).rejects.toMatchObject(notRecipient);
    expect(await f.storedMentions()).toEqual([]);
    await write([f.ids.recipient.id]);
    expect(await f.storedMentions()).toEqual([f.ids.recipient.id]);
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
      .toEqual([expect.objectContaining({ kind: "FOLLOW", threadId: thread.id, token: f.link.token, linkAvailable: true })]);
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
