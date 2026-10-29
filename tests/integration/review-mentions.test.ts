import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { RandomShareTokenIssuer } from "@/infrastructure/security/random-share-token-issuer";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import { DocumentShareService } from "@/modules/knowledge/application/document-share-service";
import { DocumentReviewService } from "@/modules/knowledge/application/document-review-service";
import { HubKnowledgeCommandServiceImpl } from "@/modules/knowledge/application/hub-knowledge-command-service";
import { ensureDefaultHubSource } from "@/modules/sources/application/ensure-default-hub-source";
import { PersonalWorkspaceService } from "@/modules/workspaces/application/personal-workspace-service";
import type { ReviewAnchor } from "@/modules/knowledge/domain/document-review";
import { projectReviewBlocks } from "@/modules/knowledge/domain/review-anchor";
import { uuidv7 } from "@/shared/ids/uuidv7";

let pool: Pool;
beforeAll(() => { pool = createDatabasePool(databaseConfig("test")); });
afterAll(async () => { await pool.end(); });

const T0 = Date.UTC(2026, 9, 29, 9, 0);
const at = (seconds: number) => new Date(T0 + seconds * 1000);

async function fixture() {
  const uow = new MariaDbUnitOfWork(pool);
  const identity = (name: string) => ({ id: uuidv7(), emp_id: randomUUID(), name, org_code: "MENTION" });
  const ownerId = identity("Owner"), aliceId = identity("Alice"), bobId = identity("Bob"), carolId = identity("Carol");
  await uow.run(async r => { for (const user of [ownerId, aliceId, bobId, carolId]) await r.users.upsertIdentity(user); });
  const owner = callerFromIdentity(ownerId);
  const { workspace } = await new PersonalWorkspaceService(uow).ensurePersonalWorkspace(ownerId.id);
  const sourceId = await ensureDefaultHubSource(uow, owner, workspace.id);
  const commands = new HubKnowledgeCommandServiceImpl(uow);
  const created = await commands.createDocument(owner, { sourceId, parentId: null, title: "Review", markdown: "A secret passage here.", metadata: {} });
  const shares = new DocumentShareService(uow, new RandomShareTokenIssuer());
  const issue = async (documentId = created.documentId) => {
    const link = await shares.create(owner, { documentId });
    return { token: link.path.slice(3), id: String((await pool.query("SELECT id FROM document_share_links WHERE document_id=? ORDER BY created_at DESC, id DESC LIMIT 1", [documentId]))[0].id) };
  };
  const newLink = async () => (await issue()).id;
  const { token, id: linkId } = await issue();
  const block = projectReviewBlocks("A secret passage here.")[0];
  const anchor: ReviewAnchor = { schemaVersion: 1, blockPath: block.path, blockKind: block.kind, startUtf16: 2, endUtf16: 16, exact: "secret passage", prefix: "A ", suffix: " here." };
  let seconds = 0;
  const service = new DocumentReviewService(uow, () => at(seconds), () => true);
  const setTime = (s: number) => { seconds = s; };
  const startThread = async () => {
    const thread = await service.createForLink(callerFromIdentity(bobId), { token, expectedRevisionId: created.revisionId, anchor, body: "Bob asks", idempotencyKey: randomUUID() });
    const [row] = await pool.query("SELECT id FROM document_review_comments WHERE thread_id=? ORDER BY created_at, id LIMIT 1", [thread.id]);
    return { threadId: thread.id as string, commentId: String(row.id) };
  };
  const otherDocument = async () => (await commands.createDocument(owner, { sourceId, parentId: null, title: "Other", markdown: "Elsewhere.", metadata: {} })).documentId;
  return { uow, service, shares, owner, ownerUserId: ownerId.id, alice: aliceId.id, bob: bobId.id, carol: carolId.id, reader: callerFromIdentity(bobId), aliceCaller: callerFromIdentity(aliceId), linkId, token, anchor, ...created, startThread, newLink, issue, otherDocument, setTime };
}

describe("review comment mentions repository", () => {
  it("lists only the recipient's rows, newest first, and reports which comments mention them", async () => {
    const f = await fixture();
    const a = await f.startThread(), b = await f.startThread();
    const row = (commentId: string, user: string, s: number) => ({ commentId, mentionedUserId: user, shareLinkId: f.linkId, createdAt: at(s), readAt: null });
    await f.uow.run(r => r.reviewMentions.insertMany([row(a.commentId, f.alice, 1), row(b.commentId, f.alice, 2), row(a.commentId, f.bob, 3)]));
    const listed = await f.uow.run(r => r.reviewMentions.listRecentByRecipient(f.alice, 10));
    expect(listed.map(m => m.commentId)).toEqual([b.commentId, a.commentId]);
    expect(listed.every(m => m.mentionedUserId === f.alice && m.readAt === null)).toBe(true);
    expect(await f.uow.run(r => r.reviewMentions.listRecentByRecipient(f.alice, 1))).toHaveLength(1);
    expect(await f.uow.run(r => r.reviewMentions.mentionedCommentIds(f.alice, [a.commentId, randomUUID()]))).toEqual(new Set([a.commentId]));
    expect(await f.uow.run(r => r.reviewMentions.mentionedCommentIds(f.alice, []))).toEqual(new Set());
  });

  it("markRead touches only the caller's row", async () => {
    const f = await fixture();
    const a = await f.startThread();
    const base = { commentId: a.commentId, shareLinkId: f.linkId, createdAt: at(1), readAt: null };
    await f.uow.run(r => r.reviewMentions.insertMany([{ ...base, mentionedUserId: f.alice }, { ...base, mentionedUserId: f.bob }]));
    await f.uow.run(r => r.reviewMentions.markRead(f.alice, a.commentId, at(9)));
    expect((await f.uow.run(r => r.reviewMentions.listRecentByRecipient(f.alice, 10)))[0].readAt).toEqual(at(9));
    expect((await f.uow.run(r => r.reviewMentions.listRecentByRecipient(f.bob, 10)))[0].readAt).toBeNull();
    expect(await f.uow.run(r => r.reviewMentions.listUnreadByRecipient(f.alice, 100))).toEqual([]);
    expect(await f.uow.run(r => r.reviewMentions.listUnreadByRecipient(f.bob, 100))).toHaveLength(1);
  });

  it("markAllRead touches only the caller's unread rows", async () => {
    const f = await fixture();
    const a = await f.startThread(), b = await f.startThread();
    const row = (commentId: string, user: string) => ({ commentId, mentionedUserId: user, shareLinkId: f.linkId, createdAt: at(1), readAt: null });
    await f.uow.run(r => r.reviewMentions.insertMany([row(a.commentId, f.alice), row(b.commentId, f.alice), row(a.commentId, f.bob)]));
    await f.uow.run(r => r.reviewMentions.markAllRead(f.alice, at(9)));
    expect(await f.uow.run(r => r.reviewMentions.listUnreadByRecipient(f.alice, 100))).toEqual([]);
    expect(await f.uow.run(r => r.reviewMentions.listUnreadByRecipient(f.bob, 100))).toHaveLength(1);
  });

  it("markThreadRead touches only the caller's rows in that thread", async () => {
    const f = await fixture();
    const a = await f.startThread(), b = await f.startThread();
    const row = (commentId: string, user: string) => ({ commentId, mentionedUserId: user, shareLinkId: f.linkId, createdAt: at(1), readAt: null });
    await f.uow.run(r => r.reviewMentions.insertMany([row(a.commentId, f.alice), row(b.commentId, f.alice), row(a.commentId, f.bob)]));
    await f.uow.run(r => r.reviewMentions.markThreadRead(f.alice, a.threadId, at(9)));
    expect((await f.uow.run(r => r.reviewMentions.listUnreadByRecipient(f.alice, 100))).map(m => m.commentId)).toEqual([b.commentId]);
    expect(await f.uow.run(r => r.reviewMentions.listUnreadByRecipient(f.bob, 100))).toHaveLength(1);
  });
});

describe("followForMention", () => {
  const seen = at(5), mentioned = at(50);
  const follow = (f: Awaited<ReturnType<typeof fixture>>, threadId: string, shareLinkId: string, valid: (id: string) => Promise<boolean>) =>
    f.uow.run(r => r.reviewFollows.followForMention({ threadId, userId: f.alice, shareLinkId, at: mentioned, currentLinkValid: valid }));
  const state = async (threadId: string, userId: string) => {
    const [row] = await pool.query("SELECT share_link_id, following, seen_at FROM review_thread_follows WHERE thread_id=? AND user_id=?", [threadId, userId]);
    return { link: String(row.share_link_id), following: Number(row.following), seenAt: new Date(row.seen_at) };
  };
  const never = async () => { throw new Error("must not be asked"); };

  it("inserts a follow when there is none", async () => {
    const f = await fixture(); const t = await f.startThread();
    await follow(f, t.threadId, f.linkId, never);
    expect(await state(t.threadId, f.alice)).toEqual({ link: f.linkId, following: 1, seenAt: mentioned });
  });

  it("re-follows an unfollowed thread on the new link and moves seen_at", async () => {
    const f = await fixture(); const t = await f.startThread(); const other = await f.newLink();
    await f.uow.run(async r => { await r.reviewFollows.follow({ threadId: t.threadId, userId: f.alice, shareLinkId: other, at: seen }); await r.reviewFollows.unfollow(t.threadId, f.alice, seen); });
    await follow(f, t.threadId, f.linkId, never);
    expect(await state(t.threadId, f.alice)).toEqual({ link: f.linkId, following: 1, seenAt: mentioned });
  });

  it("leaves an active follow on a valid link unchanged", async () => {
    const f = await fixture(); const t = await f.startThread(); const other = await f.newLink();
    await f.uow.run(r => r.reviewFollows.follow({ threadId: t.threadId, userId: f.alice, shareLinkId: other, at: seen }));
    const asked: string[] = [];
    await follow(f, t.threadId, f.linkId, async id => { asked.push(id); return true; });
    expect(asked).toEqual([other]);
    expect(await state(t.threadId, f.alice)).toEqual({ link: other, following: 1, seenAt: seen });
  });

  it("moves an active follow to the new link when its link is no longer valid, keeping seen_at", async () => {
    const f = await fixture(); const t = await f.startThread(); const other = await f.newLink();
    await f.uow.run(r => r.reviewFollows.follow({ threadId: t.threadId, userId: f.alice, shareLinkId: other, at: seen }));
    await follow(f, t.threadId, f.linkId, async () => false);
    expect(await state(t.threadId, f.alice)).toEqual({ link: f.linkId, following: 1, seenAt: seen });
  });
});

describe("writing a mention", () => {
  type F = Awaited<ReturnType<typeof fixture>>;
  const mentions = async (commentId: string): Promise<{ user: string; link: string; createdAt: Date }[]> => (await pool.query("SELECT mentioned_user_id, share_link_id, created_at FROM review_comment_mentions WHERE comment_id=? ORDER BY mentioned_user_id", [commentId]))
    .map((row: Record<string, unknown>) => ({ user: String(row.mentioned_user_id), link: String(row.share_link_id), createdAt: new Date(row.created_at as string) }));
  const followOf = async (threadId: string, userId: string) => {
    const [row] = await pool.query("SELECT share_link_id, following, seen_at FROM review_thread_follows WHERE thread_id=? AND user_id=?", [threadId, userId]);
    return row ? { link: String(row.share_link_id), following: Number(row.following), seenAt: new Date(row.seen_at) } : null;
  };
  const commentCount = async (f: F) => Number((await pool.query("SELECT COUNT(*) AS n FROM document_review_comments c JOIN document_review_threads t ON t.id=c.thread_id WHERE t.document_id=?", [f.documentId]))[0].n);
  const firstComment = async (threadId: string) => String((await pool.query("SELECT id FROM document_review_comments WHERE thread_id=? ORDER BY created_at, id LIMIT 1", [threadId]))[0].id);
  const createOnLink = (f: F, extra: Record<string, unknown>, key = randomUUID()) =>
    f.service.createForLink(f.reader, { token: f.token, expectedRevisionId: f.revisionId, anchor: f.anchor, body: "Bob asks", idempotencyKey: key, ...extra });
  const createAsOwner = (f: F, extra: Record<string, unknown>, key = randomUUID()) =>
    f.service.createForOwner(f.owner, { documentId: f.documentId, expectedRevisionId: f.revisionId, anchor: f.anchor, body: "Owner notes", idempotencyKey: key, ...extra });

  it("records the mention with the link it was written through, and the person follows on that link", async () => {
    const f = await fixture();
    f.setTime(10);
    const thread = await createOnLink(f, { mentions: [f.alice.toUpperCase()] });
    const commentId = await firstComment(thread.id);
    expect(await mentions(commentId)).toEqual([{ user: f.alice, link: f.linkId, createdAt: at(10) }]);
    expect(await followOf(thread.id, f.alice)).toEqual({ link: f.linkId, following: 1, seenAt: at(10) });
  });

  it("records one row per person named in a reply", async () => {
    const f = await fixture();
    const { threadId } = await f.startThread();
    const reply = await f.service.replyForLink(f.reader, { token: f.token, threadId, body: "Over to you", idempotencyKey: randomUUID(), mentions: [f.alice, f.carol, f.alice] });
    expect((await mentions(reply.id)).map(m => m.user).sort()).toEqual([f.alice, f.carol].sort());
    expect(await followOf(threadId, f.carol)).toMatchObject({ link: f.linkId, following: 1 });
  });

  it("drops the writer and the owner without refusing the write", async () => {
    const f = await fixture();
    const thread = await createOnLink(f, { mentions: [f.ownerUserId, f.bob] });
    expect(await mentions(await firstComment(thread.id))).toEqual([]);
    expect(await followOf(thread.id, f.ownerUserId)).toBeNull();
  });

  it("refuses an unknown user, writing nothing", async () => {
    const f = await fixture();
    await expect(createOnLink(f, { mentions: [f.alice, randomUUID()] })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(await commentCount(f)).toBe(0);
    const { threadId } = await f.startThread();
    await expect(f.service.replyForLink(f.reader, { token: f.token, threadId, body: "Hi", idempotencyKey: randomUUID(), mentions: [randomUUID()] })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(await commentCount(f)).toBe(1);
  });

  it("refuses more than ten people, writing nothing", async () => {
    const f = await fixture();
    await expect(createOnLink(f, { mentions: Array.from({ length: 11 }, () => randomUUID()) })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(await commentCount(f)).toBe(0);
  });

  it("an owner mention must carry a live link of this document", async () => {
    const f = await fixture();
    await expect(createAsOwner(f, { mentions: [f.alice] })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    const revoked = await f.newLink();
    await f.shares.revoke(f.owner, revoked);
    await expect(createAsOwner(f, { mentions: [f.alice], mentionLinkId: revoked })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    const elsewhere = (await f.issue(await f.otherDocument())).id;
    await expect(createAsOwner(f, { mentions: [f.alice], mentionLinkId: elsewhere })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(createAsOwner(f, { mentions: [f.alice], mentionLinkId: "not-a-link" })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(await commentCount(f)).toBe(0);
    const thread = await createAsOwner(f, { mentions: [f.alice], mentionLinkId: f.linkId.toUpperCase() });
    expect(await mentions(await firstComment(thread.id))).toEqual([expect.objectContaining({ user: f.alice, link: f.linkId })]);
    expect(await followOf(thread.id, f.alice)).toMatchObject({ link: f.linkId, following: 1 });
    // The owner's own reply is held to the same rule.
    await expect(f.service.replyForOwner(f.owner, { documentId: f.documentId, threadId: thread.id, body: "Again", idempotencyKey: randomUUID(), mentions: [f.carol] })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    const reply = await f.service.replyForOwner(f.owner, { documentId: f.documentId, threadId: thread.id, body: "Again", idempotencyKey: randomUUID(), mentions: [f.carol], mentionLinkId: f.linkId });
    expect(await mentions(reply.id)).toEqual([expect.objectContaining({ user: f.carol, link: f.linkId })]);
  });

  it("an owner write without mentions needs no link", async () => {
    const f = await fixture();
    const thread = await createAsOwner(f, { mentions: [], mentionLinkId: "ignored" });
    expect(await mentions(await firstComment(thread.id))).toEqual([]);
  });

  it("a replay writes nothing new, and the same key with other mentions is refused", async () => {
    const f = await fixture();
    const key = randomUUID();
    const thread = await createOnLink(f, { mentions: [f.alice, f.carol] }, key);
    expect((await createOnLink(f, { mentions: [f.carol, f.alice] }, key)).id).toBe(thread.id);
    expect(await mentions(await firstComment(thread.id))).toHaveLength(2);
    await expect(createOnLink(f, { mentions: [f.alice] }, key)).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    await expect(createOnLink(f, {}, key)).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    const replyKey = randomUUID();
    const reply = await f.service.replyForLink(f.reader, { token: f.token, threadId: thread.id, body: "R", idempotencyKey: replyKey, mentions: [f.alice] });
    expect((await f.service.replyForLink(f.reader, { token: f.token, threadId: thread.id, body: "R", idempotencyKey: replyKey, mentions: [f.alice] })).id).toBe(reply.id);
    expect(await mentions(reply.id)).toHaveLength(1);
    await expect(f.service.replyForLink(f.reader, { token: f.token, threadId: thread.id, body: "R", idempotencyKey: replyKey, mentions: [f.carol] })).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    const ownerKey = randomUUID();
    const second = await f.issue();
    const owned = await createAsOwner(f, { mentions: [f.alice], mentionLinkId: f.linkId }, ownerKey);
    expect((await createAsOwner(f, { mentions: [f.alice], mentionLinkId: f.linkId }, ownerKey)).id).toBe(owned.id);
    await expect(createAsOwner(f, { mentions: [f.alice], mentionLinkId: second.id }, ownerKey)).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
  });

  it("moves a follow on a dead link to the mention's link, keeping when it was last seen", async () => {
    const f = await fixture();
    const { threadId } = await f.startThread();
    f.setTime(5);
    await f.service.replyForLink(f.aliceCaller, { token: f.token, threadId, body: "Alice here", idempotencyKey: randomUUID() });
    expect(await followOf(threadId, f.alice)).toEqual({ link: f.linkId, following: 1, seenAt: at(5) });
    await f.shares.revoke(f.owner, f.linkId);
    const fresh = await f.issue();
    f.setTime(50);
    await f.service.replyForLink(f.reader, { token: fresh.token, threadId, body: "Alice, look", idempotencyKey: randomUUID(), mentions: [f.alice] });
    expect(await followOf(threadId, f.alice)).toEqual({ link: fresh.id, following: 1, seenAt: at(5) });
  });

  it("editing a comment leaves its mentions as they were", async () => {
    const f = await fixture();
    const thread = await createOnLink(f, { mentions: [f.alice] });
    const commentId = await firstComment(thread.id);
    const before = await mentions(commentId);
    await f.service.editForLink(f.reader, { token: f.token, threadId: thread.id, commentId, body: "Bob asks, edited", mentions: [f.carol] } as Parameters<typeof f.service.editForLink>[1]);
    expect(await mentions(commentId)).toEqual(before);
  });
});

describe("mentions in the Inbox", () => {
  type F = Awaited<ReturnType<typeof fixture>>;
  const callers = (f: F) => ({ alice: f.aliceCaller, carol: callerFromIdentity({ id: f.carol, emp_id: "", name: "Carol", org_code: "MENTION" }) });
  /** Bob writes a thread at t=10 naming Alice; returns its ids. */
  const mentionAlice = async (f: F) => {
    f.setTime(10);
    const thread = await f.service.createForLink(f.reader, { token: f.token, expectedRevisionId: f.revisionId, anchor: f.anchor, body: "Alice, please check this passage", idempotencyKey: randomUUID(), mentions: [f.alice] });
    const commentId = String((await pool.query("SELECT id FROM document_review_comments WHERE thread_id=? ORDER BY created_at, id LIMIT 1", [thread.id]))[0].id);
    return { threadId: thread.id as string, commentId };
  };
  const mentionsOf = (list: { notifications: Array<{ kind?: string }> }) => list.notifications.filter(n => n.kind === "MENTION");
  const unread = async (f: F) => mentionsOf(await f.service.listUnreadForOwner(callers(f).alice));
  const activity = async (f: F) => mentionsOf(await f.service.listActivityForOwner(callers(f).alice));
  const count = async (f: F) => (await f.service.countUnreadForOwner(callers(f).alice)).count;
  const expectDead = (entry: Record<string, unknown>, commentId: string) => {
    expect(entry).toMatchObject({ id: `mention:${commentId}`, kind: "MENTION", linkAvailable: false, documentTitle: "", authorName: undefined, excerpt: "", workspaceId: "", documentId: "", sourceId: "", threadId: "", commentId: "" });
    expect(entry.token).toBeUndefined();
    expect(entry.readAt).toEqual(entry.createdAt);
  };

  it("lists the mention for the person named, with its link, title, author and words; no one else sees it", async () => {
    const f = await fixture();
    const { threadId, commentId } = await mentionAlice(f);
    expect(await unread(f)).toEqual([{
      id: `mention:${commentId}`, kind: "MENTION", workspaceId: "", documentId: "", sourceId: "", documentTitle: "Review",
      threadId, commentId, authorName: "Bob", excerpt: "Alice, please check this passage", createdAt: at(10), readAt: null,
      threadStatus: "OPEN", token: f.token, linkAvailable: true,
    }]);
    expect(await count(f)).toBe(1);
    expect(mentionsOf(await f.service.listUnreadForOwner(callers(f).carol))).toEqual([]);
    expect((await f.service.countUnreadForOwner(callers(f).carol)).count).toBe(0);
  });

  it("a revoked link leaves an entry naming nothing, not counted", async () => {
    const f = await fixture();
    const { commentId } = await mentionAlice(f);
    await f.shares.revoke(f.owner, f.linkId);
    expect(await unread(f)).toEqual([]);
    expect(await count(f)).toBe(0);
    const [entry] = await activity(f);
    expectDead(entry as Record<string, unknown>, commentId);
  });

  it("a comment the owner hid is the same: not counted, names nothing", async () => {
    const f = await fixture();
    const { threadId, commentId } = await mentionAlice(f);
    await f.service.setVisibility(f.owner, { documentId: f.documentId, threadId, commentId, visibility: "HIDDEN", reason: "off topic" });
    expect(await unread(f)).toEqual([]);
    expect(await count(f)).toBe(0);
    expectDead((await activity(f))[0] as Record<string, unknown>, commentId);
  });

  it("a comment its writer deleted is the same", async () => {
    const f = await fixture();
    const { threadId } = await f.startThread();
    f.setTime(10);
    const reply = await f.service.replyForLink(f.reader, { token: f.token, threadId, body: "Alice?", idempotencyKey: randomUUID(), mentions: [f.alice] });
    expect(await count(f)).toBe(1);
    await f.service.deleteForLink(f.reader, { token: f.token, threadId, commentId: reply.id });
    expect(await unread(f)).toEqual([]);
    expect(await count(f)).toBe(0);
    expectDead((await activity(f))[0] as Record<string, unknown>, reply.id);
  });

  it("a reply that names a follower appears once, as the mention", async () => {
    const f = await fixture();
    const { threadId } = await f.startThread();
    f.setTime(5);
    await f.service.replyForLink(f.aliceCaller, { token: f.token, threadId, body: "Alice follows", idempotencyKey: randomUUID() });
    f.setTime(10);
    const reply = await f.service.replyForLink(f.reader, { token: f.token, threadId, body: "Alice, answered", idempotencyKey: randomUUID(), mentions: [f.alice] });
    const listed = (await f.service.listUnreadForOwner(f.aliceCaller)).notifications;
    expect(listed.map(n => [n.kind, n.id])).toEqual([["MENTION", `mention:${reply.id}`]]);
    expect(await count(f)).toBe(1);
    // A later reply without a mention is a follow unread again.
    f.setTime(20);
    await f.service.replyForLink(f.reader, { token: f.token, threadId, body: "And more", idempotencyKey: randomUUID() });
    expect((await f.service.listUnreadForOwner(f.aliceCaller)).notifications.map(n => n.kind).sort()).toEqual(["FOLLOW", "MENTION"]);
    expect(await count(f)).toBe(2);
  });

  it("marks one mention read, only for its own reader", async () => {
    const f = await fixture();
    const { commentId } = await mentionAlice(f);
    await f.service.markEventRead(callers(f).carol, `mention:${commentId}`);
    expect(await count(f)).toBe(1);
    await f.service.markEventRead(callers(f).alice, "mention:not-a-uuid");
    expect(await count(f)).toBe(1);
    f.setTime(30);
    await f.service.markEventRead(callers(f).alice, `mention:${commentId}`);
    expect(await count(f)).toBe(0);
    expect(await unread(f)).toEqual([]);
    expect((await activity(f))[0]).toMatchObject({ id: `mention:${commentId}`, linkAvailable: true, readAt: at(30) });
  });

  it("mark all read covers mentions", async () => {
    const f = await fixture();
    await mentionAlice(f);
    await mentionAlice(f);
    expect(await count(f)).toBe(2);
    await f.service.markAllActivityRead(callers(f).alice);
    expect(await count(f)).toBe(0);
  });

  it("arriving on the thread marks the caller's mentions there read, following or not", async () => {
    const f = await fixture();
    const first = await mentionAlice(f);
    const second = await mentionAlice(f);
    await f.service.unfollowOwn(callers(f).alice, first.threadId);
    await f.service.markSeenForLink(callers(f).alice, { token: f.token, threadId: first.threadId });
    expect((await unread(f)).map(n => (n as { id: string }).id)).toEqual([`mention:${second.commentId}`]);
    // A thread that does not open marks nothing.
    await expect(f.service.markSeenForLink(callers(f).alice, { token: f.token, threadId: randomUUID() })).rejects.toThrow();
    expect(await count(f)).toBe(1);
  });

  it("the badge counts exactly the unread list: read and dead mentions are in neither", async () => {
    const f = await fixture();
    const read = await mentionAlice(f);
    await mentionAlice(f);
    const hidden = await mentionAlice(f);
    await f.service.markEventRead(callers(f).alice, `mention:${read.commentId}`);
    await f.service.setVisibility(f.owner, { documentId: f.documentId, threadId: hidden.threadId, commentId: hidden.commentId, visibility: "HIDDEN", reason: "off topic" });
    const listed = (await f.service.listUnreadForOwner(callers(f).alice)).notifications;
    expect(listed).toHaveLength(1);
    expect(await count(f)).toBe(listed.length);
  });

  it("Activity's first page carries mentions read and unread; a later page none", async () => {
    const f = await fixture();
    const a = await mentionAlice(f);
    const b = await mentionAlice(f);
    await f.service.markEventRead(callers(f).alice, `mention:${a.commentId}`);
    expect((await activity(f)).map(n => (n as { id: string }).id).sort()).toEqual([`mention:${a.commentId}`, `mention:${b.commentId}`].sort());
    expect(mentionsOf(await f.service.listActivityForOwner(callers(f).alice, { createdAt: at(100), id: randomUUID() }))).toEqual([]);
  });
});

describe("mention candidates", () => {
  const empOf = async (id: string) => String((await pool.query("SELECT emp_id FROM users WHERE id=?", [id]))[0].emp_id);

  it("a signed-in reader on a live link finds people, with nameEn and no org", async () => {
    const f = await fixture();
    const tag = randomUUID().slice(0, 8);
    await pool.query("UPDATE users SET name_en=? WHERE id=?", [`Alice ${tag}`, f.alice]);
    const { candidates } = await f.service.searchMentionCandidates(f.reader, { query: `  alice ${tag} `, token: f.token });
    expect(candidates).toEqual([{ id: f.alice, name: "Alice", nameEn: `Alice ${tag}`, empId: await empOf(f.alice) }]);
  });

  it("returns at most ten rows", async () => {
    const f = await fixture();
    const many = await f.service.searchMentionCandidates(f.reader, { query: "o", token: f.token });
    expect(many.candidates.length).toBeLessThanOrEqual(10);
    expect(many.candidates.length).toBeGreaterThan(0);
  });

  it("an empty or blank query is []", async () => {
    const f = await fixture();
    expect(await f.service.searchMentionCandidates(f.reader, { query: "   ", token: f.token })).toEqual({ candidates: [] });
    expect(await f.service.searchMentionCandidates(f.reader, { query: "", token: f.token })).toEqual({ candidates: [] });
  });

  it("a revoked or unknown token is not found and reveals no rows", async () => {
    const f = await fixture();
    await expect(f.service.searchMentionCandidates(f.reader, { query: "Alice", token: randomUUID() })).rejects.toMatchObject({ name: "ShareLinkNotFoundError" });
    await f.shares.revoke(f.owner, f.linkId);
    await expect(f.service.searchMentionCandidates(f.reader, { query: "Alice", token: f.token })).rejects.toMatchObject({ name: "ShareLinkNotFoundError" });
  });

  it("the owner searches by documentId; a non-owner is not found", async () => {
    const f = await fixture();
    const emp = await empOf(f.alice);
    const found = await f.service.searchMentionCandidates(f.owner, { query: emp, documentId: f.documentId });
    expect(found.candidates.map(c => c.id)).toEqual([f.alice]);
    await expect(f.service.searchMentionCandidates(f.reader, { query: emp, documentId: f.documentId })).rejects.toMatchObject({ name: "ShareLinkNotFoundError" });
  });

  it("answers only a caller who could write a comment now: writes disabled are refused", async () => {
    const f = await fixture();
    const disabled = new DocumentReviewService(f.uow, () => at(0), () => false);
    await expect(disabled.searchMentionCandidates(f.reader, { query: "Alice", token: f.token })).rejects.toMatchObject({ code: "REVIEW_WRITES_DISABLED" });
    await expect(disabled.searchMentionCandidates(f.owner, { query: "", documentId: f.documentId })).rejects.toMatchObject({ code: "REVIEW_WRITES_DISABLED" });
  });

  it("an archived document is refused, even to its owner", async () => {
    const f = await fixture();
    await pool.query("UPDATE knowledge_documents SET status='ARCHIVED',archived_by=?,archived_at=? WHERE id=?", [f.ownerUserId, new Date(), f.documentId]);
    await expect(f.service.searchMentionCandidates(f.owner, { query: "Alice", documentId: f.documentId })).rejects.toMatchObject({ code: "REVIEW_CONFLICT" });
    await expect(f.service.searchMentionCandidates(f.owner, { query: "", documentId: f.documentId })).rejects.toMatchObject({ code: "REVIEW_CONFLICT" });
    // The link no longer opens on an archived document: not found, as any write through it.
    await expect(f.service.searchMentionCandidates(f.reader, { query: "Alice", token: f.token })).rejects.toMatchObject({ name: "ShareLinkNotFoundError" });
  });

  it("exactly one of token and documentId", async () => {
    const f = await fixture();
    await expect(f.service.searchMentionCandidates(f.owner, { query: "a" })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(f.service.searchMentionCandidates(f.owner, { query: "a", token: f.token, documentId: f.documentId })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });
});
