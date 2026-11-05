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

/**
 * The Inbox is one row per discussion (docs/superpowers/specs/2026-11-04-inbox-discussion-index-design.md):
 * owner comments, follows and mentions merge by thread, the filters apply to the whole index, and
 * selecting a discussion reads all three of the caller's sources for it.
 */
let pool: Pool;
beforeAll(() => { pool = createDatabasePool(databaseConfig("test")); });
afterAll(async () => { await pool.end(); });

/** A clock that moves only when told, so a comment's time is never decided by two calls landing in one millisecond. */
function steppingClock() {
  let now = Date.UTC(2026, 10, 4, 9, 0);
  return { clock: () => new Date(now), tick: () => { now += 1000; } };
}

async function fixture() {
  const uow = new MariaDbUnitOfWork(pool);
  const identity = (name: string) => ({ id: uuidv7(), emp_id: randomUUID(), name, org_code: "INBOX" });
  const ownerId = identity("Owner"), readerId = identity("Reader"), mentionedId = identity("Mentioned");
  const recipientId = identity("Recipient"), otherId = identity("Other");
  await uow.run(async r => { for (const user of [ownerId, readerId, mentionedId, recipientId, otherId]) await r.users.upsertIdentity(user); });
  const workspaces = new PersonalWorkspaceService(uow);
  const { workspace } = await workspaces.ensurePersonalWorkspace(ownerId.id);
  for (const user of [readerId, mentionedId, recipientId, otherId]) await workspaces.ensurePersonalWorkspace(user.id);
  const ownerCaller = callerFromIdentity(ownerId), readerCaller = callerFromIdentity(readerId);
  const mentionedCaller = callerFromIdentity(mentionedId), recipientCaller = callerFromIdentity(recipientId), otherCaller = callerFromIdentity(otherId);
  const sourceId = await ensureDefaultHubSource(uow, ownerCaller, workspace.id);
  const created = await new HubKnowledgeCommandServiceImpl(uow).createDocument(ownerCaller, {
    sourceId, parentId: null, title: "Review", markdown: "A secret passage here.", metadata: {},
  });
  const shares = new DocumentShareService(uow, new RandomShareTokenIssuer());
  const link = await shares.create(ownerCaller, { documentId: created.documentId });
  const token = link.path.slice(3);
  const block = projectReviewBlocks("A secret passage here.")[0];
  const anchor: ReviewAnchor = {
    schemaVersion: 1, blockPath: block.path, blockKind: block.kind,
    startUtf16: 2, endUtf16: 16, exact: "secret passage", prefix: "A ", suffix: " here.",
  };
  const time = steppingClock();
  const service = new DocumentReviewService(uow, time.clock, () => true);

  const start = async (caller = readerCaller, body = "Reader asks") => {
    const thread = await service.createForLink(caller, { token, expectedRevisionId: created.revisionId, anchor, body, idempotencyKey: randomUUID() });
    time.tick();
    return thread;
  };
  const reply = async (threadId: string, body: string, mentions?: string[]) => {
    await service.replyForLink(readerCaller, { token, threadId, body, idempotencyKey: randomUUID(), ...(mentions ? { mentions } : {}) });
    time.tick();
  };
  const ownerReply = async (threadId: string, body = "Owner answers", mentions?: string[]) => {
    await service.replyForOwner(ownerCaller, {
      documentId: created.documentId, threadId, body, idempotencyKey: randomUUID(),
      ...(mentions ? { mentions, mentionLinkId: link.id } : {}),
    });
    time.tick();
  };
  /** Owner: a reader comment, the owner's reply, a second reader comment. */
  const discussion = async () => {
    const thread = await start();
    await ownerReply(thread.id);
    await reply(thread.id, "Reader again");
    return thread;
  };
  const inbox = (caller: typeof ownerCaller, over: Record<string, unknown> = {}) =>
    service.listInbox(caller, { kind: "all", status: "all", unread: false, ...over } as Parameters<typeof service.listInbox>[1]);

  return {
    uow, service, shares, link, token, anchor, workspace, sourceId, ...created,
    ownerId, readerId, mentionedId, recipientId, otherId,
    ownerCaller, readerCaller, mentionedCaller, recipientCaller, otherCaller,
    time, start, reply, ownerReply, discussion, inbox,
  };
}

const ids = (page: { discussions: Array<{ threadId: string }> }) => page.discussions.map(discussion => discussion.threadId);

describe("the Inbox discussion index", () => {
  it("is one owner row for a discussion with two comments, with its passage, newest line and unread count", async () => {
    const f = await fixture();
    const thread = await f.start();
    await f.reply(thread.id, "Reader again");

    const page = await f.inbox(f.ownerCaller);
    expect(page.shared).toEqual([]);
    expect(page.nextCursor).toBeNull();
    expect(page.discussions).toEqual([expect.objectContaining({
      threadId: thread.id, kind: "OWNER", documentId: f.documentId, sourceId: f.sourceId,
      documentTitle: "Review", quote: "secret passage", commentCount: 2, unreadCount: 2,
      status: "OPEN", following: false, mentioned: false,
      href: `/w/${f.workspace.id}/knowledge/${f.sourceId}/${f.documentId}?thread=${thread.id}`,
    })]);
    expect(page.discussions[0].latest).toMatchObject({ authorName: "Reader", excerpt: "Reader again" });
  });

  it("keeps the reader's reply as the owner row's line while the owner's own reply moves its time", async () => {
    const f = await fixture();
    const thread = await f.start();
    await f.reply(thread.id, "Reader again");
    await f.ownerReply(thread.id, "Owner answers");

    const [row] = (await f.inbox(f.ownerCaller)).discussions;
    expect(row).toMatchObject({ commentCount: 3, latest: expect.objectContaining({ authorName: "Reader", excerpt: "Reader again" }) });
    expect(row.latestAt.getTime()).toBeGreaterThan(row.latest.createdAt.getTime());
  });

  it("lists a followed discussion as one row, with the owner's reply as its line", async () => {
    const f = await fixture();
    const thread = await f.start();
    await f.ownerReply(thread.id, "Owner answers");

    const page = await f.inbox(f.readerCaller, { kind: "follow" });
    expect(page.discussions).toEqual([expect.objectContaining({
      threadId: thread.id, kind: "FOLLOW", following: true, mentioned: false,
      documentTitle: "Review", quote: "secret passage", commentCount: 2, unreadCount: 1, status: "OPEN",
      token: f.token, href: `/s/${f.token}?thread=${thread.id}`,
    })]);
    expect(page.discussions[0].latest).toMatchObject({ authorName: "Owner", excerpt: "Owner answers" });
  });

  it("groups a discussion's mentions into one row, and merges a mention with its follow into one row with both flags", async () => {
    const f = await fixture();
    const thread = await f.start();
    await f.reply(thread.id, "Mentioned, look", [f.mentionedId.id]);

    const mentionPage = await f.inbox(f.mentionedCaller, { kind: "mention" });
    expect(mentionPage.discussions).toEqual([expect.objectContaining({
      threadId: thread.id, kind: "MENTION", mentioned: true,
      documentTitle: "Review", quote: "secret passage", commentCount: 2, unreadCount: 1, status: "OPEN",
      token: f.token, href: `/s/${f.token}?thread=${thread.id}`,
    })]);
    // The mention also made the reader follow the discussion, so the All tab shows one row, not two.
    expect((await f.inbox(f.mentionedCaller)).discussions).toEqual([
      expect.objectContaining({ threadId: thread.id, following: true, mentioned: true, commentCount: 2 }),
    ]);
  });

  it("keeps one owner row when the owner is named in their own discussion, without counting the mention twice", async () => {
    const f = await fixture();
    const thread = await f.start();
    const stored = await f.uow.run(r => r.reviewThreads.findById(thread.id));
    if (!stored?.originShareLinkId) throw new Error("fixture discussion has no originating share link");
    // `normalizeMentions` never records the Workspace owner, so the fixture names them directly.
    await f.uow.run(r => r.reviewMentions.insertMany([{
      commentId: thread.comments[0].id, mentionedUserId: f.ownerId.id, shareLinkId: stored.originShareLinkId!,
      createdAt: f.time.clock(), readAt: null,
    }]));

    const page = await f.inbox(f.ownerCaller, { kind: "mention" });
    expect(page.discussions).toEqual([expect.objectContaining({ threadId: thread.id, kind: "OWNER", mentioned: true, unreadCount: 1 })]);
  });

  it("applies the status filter to owner and followed rows before returning the page", async () => {
    const f = await fixture();
    const open = await f.start();
    const resolved = await f.start();
    await f.service.setResolution(f.ownerCaller, { documentId: f.documentId, threadId: resolved.id, status: "RESOLVED" });

    expect(ids(await f.inbox(f.ownerCaller, { status: "open" }))).toEqual([open.id]);
    expect(ids(await f.inbox(f.ownerCaller, { status: "resolved" }))).toEqual([resolved.id]);
    expect(ids(await f.inbox(f.readerCaller, { kind: "follow", status: "resolved" }))).toEqual([resolved.id]);
  });

  it("returns the one discussion for a threadId lookup even when the page's cursor is empty, and nothing when the filters exclude it", async () => {
    const f = await fixture();
    const thread = await f.start();

    const past = { latestAt: new Date(0), threadId: uuidv7() };
    expect(ids(await f.inbox(f.ownerCaller, { before: past }))).toEqual([]);
    expect(ids(await f.inbox(f.ownerCaller, { before: past, threadId: thread.id }))).toEqual([thread.id]);

    await f.service.setResolution(f.ownerCaller, { documentId: f.documentId, threadId: thread.id, status: "RESOLVED" });
    expect(ids(await f.inbox(f.ownerCaller, { status: "open", threadId: thread.id }))).toEqual([]);
    expect(ids(await f.inbox(f.ownerCaller, { status: "resolved", threadId: thread.id }))).toEqual([thread.id]);
    expect(ids(await f.inbox(f.ownerCaller, { threadId: uuidv7() }))).toEqual([]);
    expect(ids(await f.inbox(f.ownerCaller, { threadId: "not-a-uuid" }))).toEqual([]);
  });

  it("pages the owner source by the last row's time and thread, and has no cursor for link-only rows", async () => {
    const f = await fixture();
    // Three writers keep each under the hourly and per-creator limits.
    const callers = [f.readerCaller, f.mentionedCaller, f.otherCaller];
    const threads = [];
    for (let index = 0; index < 51; index += 1) threads.push(await f.start(callers[index % callers.length]));

    const first = await f.inbox(f.ownerCaller, { kind: "owner" });
    expect(first.discussions).toHaveLength(50);
    const last = first.discussions.at(-1)!;
    expect(first.nextCursor).toEqual({ latestAt: last.latestAt.toISOString(), threadId: last.threadId });

    const rest = await f.inbox(f.ownerCaller, {
      kind: "owner", before: { latestAt: new Date(first.nextCursor!.latestAt), threadId: first.nextCursor!.threadId },
    });
    expect(ids(rest)).toEqual([threads[0].id]);
    expect(rest.nextCursor).toBeNull();

    // A followed discussion is part of the bounded first-page set: a later page carries no link rows.
    await f.ownerReply(threads[0].id);
    const readerPage = await f.inbox(f.readerCaller, { kind: "follow", before: { latestAt: new Date(0), threadId: uuidv7() } });
    expect(readerPage.discussions).toEqual([]);
  });

  it("drops a revoked link's discussion from the index, while Shares > Discussions still names it as unavailable", async () => {
    const f = await fixture();
    const thread = await f.start();
    await f.ownerReply(thread.id, "PRIVATE ANSWER");
    await f.shares.revoke(f.ownerCaller, f.link.id);

    expect((await f.inbox(f.readerCaller)).discussions).toEqual([]);
    expect((await f.service.listFollowedDiscussions(f.readerCaller)).items).toEqual([{ threadId: thread.id, linkAvailable: false }]);
  });

  it("shows unread named shares in their own section only on the default first page", async () => {
    const f = await fixture();
    await f.shares.create(f.ownerCaller, { documentId: f.documentId, recipients: [f.recipientId.id] });

    const page = await f.inbox(f.recipientCaller);
    expect(page.discussions).toEqual([]);
    expect(page.shared).toEqual([expect.objectContaining({
      kind: "SHARED_WITH_YOU", documentTitle: "Review", authorName: "Owner", linkAvailable: true,
    })]);

    expect((await f.inbox(f.recipientCaller, { kind: "owner" })).shared).toEqual([]);
    expect((await f.inbox(f.recipientCaller, { status: "open" })).shared).toEqual([]);
    expect((await f.inbox(f.recipientCaller, { unread: true })).shared).toEqual([]);
    expect((await f.inbox(f.recipientCaller, { before: { latestAt: new Date(), threadId: uuidv7() } })).shared).toEqual([]);
  });

  it("marks the discussion read across the owner's notices, the reader's follow and the callers' mentions, idempotently", async () => {
    const f = await fixture();
    const thread = await f.start();
    await f.ownerReply(thread.id);
    await f.ownerReply(thread.id, "Mentioned, look", [f.mentionedId.id]);

    expect(ids(await f.inbox(f.ownerCaller, { unread: true }))).toEqual([thread.id]);
    expect(ids(await f.inbox(f.readerCaller, { unread: true }))).toEqual([thread.id]);
    expect(ids(await f.inbox(f.mentionedCaller, { unread: true }))).toEqual([thread.id]);

    await f.service.markDiscussionRead(f.readerCaller, thread.id);
    expect((await f.inbox(f.readerCaller, { unread: true })).discussions).toEqual([]);
    expect((await f.inbox(f.readerCaller, { kind: "follow" })).discussions).toEqual([
      expect.objectContaining({ threadId: thread.id, unreadCount: 0, following: true }),
    ]);

    await f.service.markDiscussionRead(f.mentionedCaller, thread.id);
    expect((await f.inbox(f.mentionedCaller, { unread: true })).discussions).toEqual([]);
    expect((await f.inbox(f.mentionedCaller, { kind: "mention" })).discussions).toEqual([
      expect.objectContaining({ threadId: thread.id, unreadCount: 0, mentioned: true }),
    ]);

    await f.service.markDiscussionRead(f.ownerCaller, thread.id);
    await f.service.markDiscussionRead(f.ownerCaller, thread.id);
    expect((await f.inbox(f.ownerCaller, { kind: "owner", unread: true })).discussions).toEqual([]);

    await expect(f.service.markDiscussionRead(f.ownerCaller, uuidv7())).resolves.toBeUndefined();
    await expect(f.service.markDiscussionRead(f.ownerCaller, "not-a-uuid")).resolves.toBeUndefined();
  });

  it("never lists another Workspace's discussion", async () => {
    const f = await fixture();
    const thread = await f.start();
    const otherOwnerId = { ...f.ownerId, id: uuidv7(), emp_id: `OTHER-${uuidv7()}`, name: "Elsewhere" };
    await f.uow.run(r => r.users.upsertIdentity(otherOwnerId));
    const otherOwner = callerFromIdentity(otherOwnerId);
    const { workspace } = await new PersonalWorkspaceService(f.uow).ensurePersonalWorkspace(otherOwnerId.id);
    const sourceId = await ensureDefaultHubSource(f.uow, otherOwner, workspace.id);
    const otherDocument = await new HubKnowledgeCommandServiceImpl(f.uow).createDocument(otherOwner, {
      sourceId, parentId: null, title: "Elsewhere", markdown: "A secret passage here.", metadata: {},
    });
    const otherLink = await f.shares.create(otherOwner, { documentId: otherDocument.documentId });
    await f.service.createForLink(f.readerCaller, {
      token: otherLink.path.slice(3), expectedRevisionId: otherDocument.revisionId, anchor: f.anchor, body: "From elsewhere", idempotencyKey: randomUUID(),
    });

    expect(ids(await f.inbox(f.ownerCaller))).toEqual([thread.id]);
    const otherPage = await f.inbox(otherOwner);
    expect(otherPage.discussions).toHaveLength(1);
    expect(otherPage.discussions[0]).toMatchObject({ documentTitle: "Elsewhere", documentId: otherDocument.documentId });
  });
});
