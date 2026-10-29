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
  const ownerId = identity("Owner"), aliceId = identity("Alice"), bobId = identity("Bob");
  await uow.run(async r => { for (const user of [ownerId, aliceId, bobId]) await r.users.upsertIdentity(user); });
  const owner = callerFromIdentity(ownerId);
  const { workspace } = await new PersonalWorkspaceService(uow).ensurePersonalWorkspace(ownerId.id);
  const sourceId = await ensureDefaultHubSource(uow, owner, workspace.id);
  const created = await new HubKnowledgeCommandServiceImpl(uow).createDocument(owner, { sourceId, parentId: null, title: "Review", markdown: "A secret passage here.", metadata: {} });
  const shares = new DocumentShareService(uow, new RandomShareTokenIssuer());
  const issue = async () => {
    const link = await shares.create(owner, { documentId: created.documentId });
    return { token: link.path.slice(3), id: String((await pool.query("SELECT id FROM document_share_links WHERE document_id=? ORDER BY created_at DESC, id DESC LIMIT 1", [created.documentId]))[0].id) };
  };
  const newLink = async () => (await issue()).id;
  const { token, id: linkId } = await issue();
  const block = projectReviewBlocks("A secret passage here.")[0];
  const anchor: ReviewAnchor = { schemaVersion: 1, blockPath: block.path, blockKind: block.kind, startUtf16: 2, endUtf16: 16, exact: "secret passage", prefix: "A ", suffix: " here." };
  const service = new DocumentReviewService(uow, () => at(0), () => true);
  const startThread = async () => {
    const thread = await service.createForLink(callerFromIdentity(bobId), { token, expectedRevisionId: created.revisionId, anchor, body: "Bob asks", idempotencyKey: randomUUID() });
    const [row] = await pool.query("SELECT id FROM document_review_comments WHERE thread_id=? ORDER BY created_at, id LIMIT 1", [thread.id]);
    return { threadId: thread.id as string, commentId: String(row.id) };
  };
  return { uow, alice: aliceId.id, bob: bobId.id, linkId, startThread, newLink };
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
    expect(await f.uow.run(r => r.reviewMentions.listUnreadByRecipient(f.alice))).toEqual([]);
    expect(await f.uow.run(r => r.reviewMentions.listUnreadByRecipient(f.bob))).toHaveLength(1);
  });

  it("markAllRead touches only the caller's unread rows", async () => {
    const f = await fixture();
    const a = await f.startThread(), b = await f.startThread();
    const row = (commentId: string, user: string) => ({ commentId, mentionedUserId: user, shareLinkId: f.linkId, createdAt: at(1), readAt: null });
    await f.uow.run(r => r.reviewMentions.insertMany([row(a.commentId, f.alice), row(b.commentId, f.alice), row(a.commentId, f.bob)]));
    await f.uow.run(r => r.reviewMentions.markAllRead(f.alice, at(9)));
    expect(await f.uow.run(r => r.reviewMentions.listUnreadByRecipient(f.alice))).toEqual([]);
    expect(await f.uow.run(r => r.reviewMentions.listUnreadByRecipient(f.bob))).toHaveLength(1);
  });

  it("markThreadRead touches only the caller's rows in that thread", async () => {
    const f = await fixture();
    const a = await f.startThread(), b = await f.startThread();
    const row = (commentId: string, user: string) => ({ commentId, mentionedUserId: user, shareLinkId: f.linkId, createdAt: at(1), readAt: null });
    await f.uow.run(r => r.reviewMentions.insertMany([row(a.commentId, f.alice), row(b.commentId, f.alice), row(a.commentId, f.bob)]));
    await f.uow.run(r => r.reviewMentions.markThreadRead(f.alice, a.threadId, at(9)));
    expect((await f.uow.run(r => r.reviewMentions.listUnreadByRecipient(f.alice))).map(m => m.commentId)).toEqual([b.commentId]);
    expect(await f.uow.run(r => r.reviewMentions.listUnreadByRecipient(f.bob))).toHaveLength(1);
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
