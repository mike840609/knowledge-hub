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

/** A clock that moves only when told, so "after seen" is never decided by two calls landing in one millisecond. */
function steppingClock() {
  let now = Date.UTC(2026, 9, 22, 9, 0);
  return { clock: () => new Date(now), tick: () => { now += 1000; } };
}

async function fixture() {
  const uow = new MariaDbUnitOfWork(pool);
  const identity = (name: string) => ({ id: uuidv7(), emp_id: randomUUID(), name, org_code: "REVIEW" });
  const ownerId = identity("Owner"), readerId = identity("Reader"), otherId = identity("Other");
  await uow.run(async r => { for (const user of [ownerId, readerId, otherId]) await r.users.upsertIdentity(user); });
  const owner = callerFromIdentity(ownerId), reader = callerFromIdentity(readerId), other = callerFromIdentity(otherId);
  const { workspace } = await new PersonalWorkspaceService(uow).ensurePersonalWorkspace(ownerId.id);
  const sourceId = await ensureDefaultHubSource(uow, owner, workspace.id);
  const created = await new HubKnowledgeCommandServiceImpl(uow).createDocument(owner, { sourceId, parentId: null, title: "Review", markdown: "A secret passage here.", metadata: {} });
  const shares = new DocumentShareService(uow, new RandomShareTokenIssuer());
  const link = await shares.create(owner, { documentId: created.documentId });
  const token = link.path.slice(3);
  const block = projectReviewBlocks("A secret passage here.")[0];
  const anchor: ReviewAnchor = { schemaVersion: 1, blockPath: block.path, blockKind: block.kind, startUtf16: 2, endUtf16: 16, exact: "secret passage", prefix: "A ", suffix: " here." };
  const time = steppingClock();
  const service = new DocumentReviewService(uow, time.clock, () => true);
  const start = async () => { const thread = await service.createForLink(reader, { token, expectedRevisionId: created.revisionId, anchor, body: "Reader asks", idempotencyKey: randomUUID() }); time.tick(); return thread; };
  const ownerReply = async (threadId: string, body = "Owner answers") => { await service.replyForOwner(owner, { documentId: created.documentId, threadId, body, idempotencyKey: randomUUID() }); time.tick(); };
  const follows = async (caller = reader) => (await service.listUnreadForOwner(caller)).notifications.filter(n => n.kind === "FOLLOW");
  return { uow, service, shares, link, token, anchor, owner, reader, other, ...created, time, start, ownerReply, follows };
}

describe("a shared-page reader follows the discussions they write in", () => {
  it("hears the owner's reply, once per discussion, and stops hearing it once seen", async () => {
    const f = await fixture();
    const thread = await f.start();
    expect(await f.follows()).toEqual([]);
    await f.ownerReply(thread.id);
    const [entry] = await f.follows();
    expect(entry).toMatchObject({ id: `follow:${thread.id}`, kind: "FOLLOW", threadId: thread.id, token: f.token, linkAvailable: true, replyCount: 1, authorName: "Owner", excerpt: "Owner answers", documentTitle: "Review", readAt: null });
    await f.ownerReply(thread.id, "And more");
    expect(await f.follows()).toEqual([expect.objectContaining({ replyCount: 2, excerpt: "And more" })]);
    await f.service.markSeenForLink(f.reader, { token: f.token, threadId: thread.id });
    f.time.tick();
    expect(await f.follows()).toEqual([]);
    const activity = (await f.service.listActivityForOwner(f.reader)).notifications.filter(n => n.kind === "FOLLOW");
    expect(activity).toEqual([expect.objectContaining({ threadId: thread.id, readAt: expect.any(Date) })]);
  });

  it("hears another reader too, but never their own words", async () => {
    const f = await fixture();
    const thread = await f.start();
    await f.service.replyForLink(f.reader, { token: f.token, threadId: thread.id, body: "Me again", idempotencyKey: randomUUID() });
    f.time.tick();
    expect(await f.follows()).toEqual([]);
    await f.service.replyForLink(f.other, { token: f.token, threadId: thread.id, body: "Another view", idempotencyKey: randomUUID() });
    f.time.tick();
    expect(await f.follows()).toEqual([expect.objectContaining({ authorName: "Other", replyCount: 1 })]);
    // The other reader follows too, and hears nothing of what they wrote.
    expect(await f.follows(f.other)).toEqual([]);
  });

  it("keeps the owner's reply as the Inbox excerpt after the reader writes again", async () => {
    const f = await fixture();
    const thread = await f.start();
    await f.ownerReply(thread.id, "Owner answer");
    f.time.tick();
    await f.service.replyForLink(f.reader, { token: f.token, threadId: thread.id, body: "Me again", idempotencyKey: randomUUID() });
    f.time.tick();
    // Writing again moves the read cursor past the owner's reply (spec 2026-10-22 § Following), so
    // the unread Inbox no longer lists it; the activity feed still does, quoting the owner.
    const [entry] = (await f.service.listActivityForOwner(f.reader)).notifications.filter(n => n.kind === "FOLLOW");
    expect(entry).toMatchObject({ excerpt: "Owner answer", authorName: "Owner", replyCount: 0 });
  });

  it("unfollowing stops it; writing again follows again; following again starts from now", async () => {
    const f = await fixture();
    const thread = await f.start();
    expect((await f.service.followForLink(f.reader, { token: f.token, threadId: thread.id, following: false })).following).toBe(false);
    expect((await f.service.queryForLink(f.reader, f.token)).threads[0].following).toBe(false);
    await f.ownerReply(thread.id);
    expect(await f.follows()).toEqual([]);
    await f.service.followForLink(f.reader, { token: f.token, threadId: thread.id, following: true });
    f.time.tick();
    expect(await f.follows()).toEqual([]);
    await f.service.followForLink(f.reader, { token: f.token, threadId: thread.id, following: false });
    await f.service.replyForLink(f.reader, { token: f.token, threadId: thread.id, body: "Back", idempotencyKey: randomUUID() });
    f.time.tick();
    expect((await f.service.queryForLink(f.reader, f.token)).threads[0].following).toBe(true);
    await f.ownerReply(thread.id);
    expect(await f.follows()).toHaveLength(1);
  });

  it("anyone signed in on the link may follow; anonymous readers are told nothing", async () => {
    const f = await fixture();
    const thread = await f.start();
    expect((await f.service.queryForLink(null, f.token)).threads[0].following).toBeUndefined();
    expect((await f.service.queryForLink(f.other, f.token)).threads[0].following).toBe(false);
    await f.service.followForLink(f.other, { token: f.token, threadId: thread.id, following: true });
    f.time.tick();
    await f.ownerReply(thread.id);
    expect(await f.follows(f.other)).toHaveLength(1);
  });

  it("a dead link leaves an entry that says only that, and counts as nothing unread", async () => {
    const f = await fixture();
    const thread = await f.start();
    await f.ownerReply(thread.id, "PRIVATE ANSWER");
    await f.shares.revoke(f.owner, f.link.id);
    expect(await f.follows()).toEqual([]);
    const [entry] = (await f.service.listActivityForOwner(f.reader)).notifications.filter(n => n.kind === "FOLLOW");
    expect(entry).toMatchObject({ linkAvailable: false, excerpt: "", documentTitle: "", authorName: undefined });
    expect(entry.token).toBeUndefined();
    expect(JSON.stringify(entry)).not.toContain("PRIVATE ANSWER");
    await expect(f.service.followForLink(f.reader, { token: f.token, threadId: thread.id, following: true })).rejects.toMatchObject({ code: "SHARE_LINK_NOT_FOUND" });
  });

  it("a hidden reply or discussion stops counting", async () => {
    const f = await fixture();
    const thread = await f.start();
    await f.ownerReply(thread.id);
    await f.service.setVisibility(f.owner, { documentId: f.documentId, threadId: thread.id, visibility: "HIDDEN", reason: "spam" });
    expect(await f.follows()).toEqual([]);
  });

  it("the owner never follows their own document", async () => {
    const f = await fixture();
    const thread = await f.service.createForLink(f.owner, { token: f.token, expectedRevisionId: f.revisionId, anchor: f.anchor, body: "Owner via link", idempotencyKey: randomUUID() });
    expect(await f.uow.run(r => r.reviewFollows.followingThreadIds(f.owner.identity.id, [thread.id]))).toEqual(new Set());
  });

  it("seeing, marking read and marking all read touch only the caller's own follows", async () => {
    const f = await fixture();
    const thread = await f.start();
    await f.ownerReply(thread.id);
    await f.service.markSeenForLink(f.other, { token: f.token, threadId: thread.id });
    await f.service.markEventRead(f.other, `follow:${thread.id}`);
    await f.service.markAllActivityRead(f.other);
    expect(await f.follows()).toHaveLength(1);
    await f.service.markEventRead(f.reader, `follow:${thread.id}`);
    f.time.tick();
    expect(await f.follows()).toEqual([]);
    await f.ownerReply(thread.id);
    await f.service.markAllActivityRead(f.reader);
    f.time.tick();
    expect(await f.follows()).toEqual([]);
  });
});

describe("the owner reads discussion by discussion", () => {
  it("marking one discussion read leaves the others unread, and refuses a non-owner", async () => {
    const f = await fixture();
    const first = await f.start();
    const second = await f.start();
    const ownerUnread = async () => (await f.service.listUnreadForOwner(f.owner)).notifications.filter(n => n.kind === "OWNER").map(n => n.threadId);
    expect((await ownerUnread()).sort()).toEqual([first.id, second.id].sort());
    await f.service.markThreadRead(f.owner, f.documentId, first.id);
    expect(await ownerUnread()).toEqual([second.id]);
    await expect(f.service.markThreadRead(f.reader, f.documentId, second.id)).rejects.toMatchObject({ code: "SHARE_LINK_NOT_FOUND" });
    expect(await ownerUnread()).toEqual([second.id]);
  });
});

describe("Shares → Discussions: every discussion the reader follows", () => {
  const discussions = async (f: Awaited<ReturnType<typeof fixture>>, caller = f.reader) => (await f.service.listFollowedDiscussions(caller)).items;

  it("lists a discussion no one has answered yet, and marks it unread once someone does", async () => {
    const f = await fixture();
    const thread = await f.start();
    expect(await discussions(f)).toEqual([expect.objectContaining({ threadId: thread.id, linkAvailable: true, token: f.token, documentTitle: "Review", threadStatus: "OPEN", authorName: "Reader", excerpt: "Reader asks", unread: 0 })]);
    await f.ownerReply(thread.id);
    expect(await discussions(f)).toEqual([expect.objectContaining({ authorName: "Owner", excerpt: "Owner answers", unread: 1 })]);
    await f.service.markSeenForLink(f.reader, { token: f.token, threadId: thread.id });
    f.time.tick();
    expect(await discussions(f)).toEqual([expect.objectContaining({ unread: 0 })]);
  });

  it("drops a discussion once unfollowed, from the link or from the list", async () => {
    const f = await fixture();
    const thread = await f.start();
    await f.service.followForLink(f.reader, { token: f.token, threadId: thread.id, following: false });
    expect(await discussions(f)).toEqual([]);
    await f.service.followForLink(f.reader, { token: f.token, threadId: thread.id, following: true });
    expect(await f.service.unfollowOwn(f.reader, thread.id)).toEqual({ following: false });
    expect(await discussions(f)).toEqual([]);
  });

  it("a dead link's row names nothing, and Remove needs no live link", async () => {
    const f = await fixture();
    const thread = await f.start();
    await f.ownerReply(thread.id, "PRIVATE ANSWER");
    await f.shares.revoke(f.owner, f.link.id);
    const items = await discussions(f);
    expect(items).toEqual([{ threadId: thread.id, linkAvailable: false }]);
    expect(JSON.stringify(items)).not.toContain("PRIVATE");
    await f.service.unfollowOwn(f.reader, thread.id);
    expect(await discussions(f)).toEqual([]);
  });

  it("Remove touches only the caller's own follow and says the same for anything else", async () => {
    const f = await fixture();
    const thread = await f.start();
    await f.service.followForLink(f.other, { token: f.token, threadId: thread.id, following: true });
    expect(await f.service.unfollowOwn(f.other, thread.id)).toEqual({ following: false });
    expect(await discussions(f)).toHaveLength(1);
    expect(await f.service.unfollowOwn(f.reader, randomUUID())).toEqual({ following: false });
    expect(await f.service.unfollowOwn(f.reader, "not-a-uuid")).toEqual({ following: false });
    expect(await discussions(f)).toHaveLength(1);
  });

  it("the Inbox still lists only discussions someone else answered", async () => {
    const f = await fixture();
    await f.start();
    expect((await f.service.listActivityForOwner(f.reader)).notifications.filter(n => n.kind === "FOLLOW")).toEqual([]);
  });
});
