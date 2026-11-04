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
import type { InboxOwnerQuery } from "@/modules/knowledge/ports/share-comment-event-repository";
import { ensureDefaultHubSource } from "@/modules/sources/application/ensure-default-hub-source";
import { PersonalWorkspaceService } from "@/modules/workspaces/application/personal-workspace-service";
import { uuidv7 } from "@/shared/ids/uuidv7";

let pool: Pool;
beforeAll(() => { pool = createDatabasePool(databaseConfig("test")); });
afterAll(async () => { await pool.end(); });

/** A clock that moves only when told, so a comment's time is never decided by two calls landing in one millisecond. */
function steppingClock() {
  let now = Date.UTC(2026, 9, 22, 9, 0);
  return { clock: () => new Date(now), tick: () => { now += 1000; } };
}

async function fixture() {
  const uow = new MariaDbUnitOfWork(pool);
  const identity = (name: string) => ({ id: uuidv7(), emp_id: randomUUID(), name, org_code: "REVIEW" });
  const ownerId = identity("Owner"), readerId = identity("Reader"), otherId = identity("Other");
  await uow.run(async r => { for (const user of [ownerId, readerId, otherId]) await r.users.upsertIdentity(user); });
  const owner = callerFromIdentity(ownerId), reader = callerFromIdentity(readerId);
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

  const start = async (body = "Reader asks") => {
    const thread = await service.createForLink(reader, { token, expectedRevisionId: created.revisionId, anchor, body, idempotencyKey: randomUUID() });
    time.tick();
    return thread;
  };
  const ownerReply = async (threadId: string, body = "Owner answers") => {
    await service.replyForOwner(owner, { documentId: created.documentId, threadId, body, idempotencyKey: randomUUID() });
    time.tick();
  };
  const readerReply = async (threadId: string, body: string) => {
    const at = time.clock();
    await service.replyForLink(reader, { token, threadId, body, idempotencyKey: randomUUID() });
    time.tick();
    return at;
  };
  /** The discussion every test starts from: a reader comment, the owner's reply, another reader comment. */
  const discussion = async () => {
    const thread = await start();
    await ownerReply(thread.id);
    const lastCommentAt = await readerReply(thread.id, "Reader again");
    return { thread, lastCommentAt };
  };

  const base = await discussion();
  const stored = await uow.run(r => r.reviewThreads.findById(base.thread.id));
  if (!stored?.originShareLinkId) throw new Error("fixture discussion has no originating share link");
  await uow.run(r => r.reviewMentions.insertMany([{
    commentId: base.thread.comments[0].id, mentionedUserId: ownerId.id, shareLinkId: stored.originShareLinkId!,
    createdAt: time.clock(), readAt: null,
  }]));

  /** A discussion on a different owner's private document, which must never reach the first owner. */
  const elsewhere = async () => {
    const otherOwnerId = identity("Other owner");
    await uow.run(r => r.users.upsertIdentity(otherOwnerId));
    const otherOwner = callerFromIdentity(otherOwnerId);
    const { workspace: otherWorkspace } = await new PersonalWorkspaceService(uow).ensurePersonalWorkspace(otherOwnerId.id);
    const otherSourceId = await ensureDefaultHubSource(uow, otherOwner, otherWorkspace.id);
    const otherDocument = await new HubKnowledgeCommandServiceImpl(uow).createDocument(otherOwner, { sourceId: otherSourceId, parentId: null, title: "Elsewhere", markdown: "A secret passage here.", metadata: {} });
    const otherLink = await shares.create(otherOwner, { documentId: otherDocument.documentId });
    const thread = await service.createForLink(reader, { token: otherLink.path.slice(3), expectedRevisionId: otherDocument.revisionId, anchor, body: "From elsewhere", idempotencyKey: randomUUID() });
    return { ownerUserId: otherOwnerId.id, thread };
  };

  return { uow, service, shares, owner, reader, ownerUserId: ownerId.id, otherId: otherId.id, workspace, sourceId, ...created, token, anchor, thread: base.thread, lastCommentAt: base.lastCommentAt, discussion, elsewhere };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

const summaries = (f: Fixture, over: Partial<InboxOwnerQuery> = {}) => f.uow.run(r => r.shareCommentEvents.listDiscussionSummaries({
  recipientUserId: f.ownerUserId, unreadOnly: false, mentionedOnly: false, limit: 50, ...over,
}));

describe("the owner discussion summary", () => {
  it("is one row per discussion, with the latest visible comment, its count and its unread count", async () => {
    const f = await fixture();
    const rows = await summaries(f);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      threadId: f.thread.id, documentId: f.documentId, sourceId: f.sourceId,
      documentTitle: "Review", quote: "secret passage", status: "OPEN",
      commentCount: 3, unreadCount: 2, mentioned: true,
    });
    expect(rows[0].latestAt).toEqual(f.lastCommentAt);
  });

  it("pages by the (latestAt, threadId) cursor, newest first", async () => {
    const f = await fixture();
    const second = await f.discussion();
    const first = await summaries(f, { limit: 1 });
    expect(first.map(row => row.threadId)).toEqual([second.thread.id]);
    expect(first[0].latestAt).toEqual(second.lastCommentAt);
    const next = await summaries(f, { limit: 1, before: { latestAt: first[0].latestAt, threadId: first[0].threadId } });
    expect(next.map(row => row.threadId)).toEqual([f.thread.id]);
  });

  it("filters unread discussions, mentioned discussions, thread ids and status in the query", async () => {
    const f = await fixture();
    const second = await f.discussion();
    expect((await summaries(f, { unreadOnly: true })).map(row => row.threadId).sort()).toEqual([f.thread.id, second.thread.id].sort());
    await f.service.markThreadRead(f.owner, f.documentId, f.thread.id);
    expect((await summaries(f, { unreadOnly: true })).map(row => row.threadId)).toEqual([second.thread.id]);
    const settled = (await summaries(f)).find(row => row.threadId === f.thread.id);
    expect(settled?.unreadCount).toBe(0);

    expect((await summaries(f, { mentionedOnly: true })).map(row => row.threadId)).toEqual([f.thread.id]);
    expect((await summaries(f, { threadIds: [second.thread.id] })).map(row => row.threadId)).toEqual([second.thread.id]);
    expect(await summaries(f, { threadIds: [] })).toEqual([]);

    await f.service.setResolution(f.owner, { documentId: f.documentId, threadId: f.thread.id, status: "RESOLVED" });
    expect((await summaries(f, { status: "OPEN" })).map(row => row.threadId)).toEqual([second.thread.id]);
    expect((await summaries(f, { status: "RESOLVED" })).map(row => row.threadId)).toEqual([f.thread.id]);
  });

  it("drops a hidden thread and a retracted one", async () => {
    const f = await fixture();
    await f.service.setVisibility(f.owner, { documentId: f.documentId, threadId: f.thread.id, visibility: "HIDDEN", reason: "spam" });
    expect(await summaries(f)).toEqual([]);
    await f.service.setVisibility(f.owner, { documentId: f.documentId, threadId: f.thread.id, visibility: "VISIBLE" });

    const comments = await f.uow.run(r => r.reviewComments.listByThread(f.thread.id));
    expect(comments).toHaveLength(3);
    for (const comment of comments) {
      if (comment.authorUserId === f.reader.identity.id) {
        await f.service.deleteForLink(f.reader, { token: f.token, threadId: f.thread.id, commentId: comment.id });
      } else {
        await f.service.deleteForOwner(f.owner, { documentId: f.documentId, threadId: f.thread.id, commentId: comment.id });
      }
    }
    expect(await summaries(f)).toEqual([]);
  });

  it("never lists another Workspace's discussion", async () => {
    const f = await fixture();
    const elsewhere = await f.elsewhere();
    expect((await summaries(f)).map(row => row.threadId)).toEqual([f.thread.id]);
    const otherRows = await f.uow.run(r => r.shareCommentEvents.listDiscussionSummaries({
      recipientUserId: elsewhere.ownerUserId, unreadOnly: false, mentionedOnly: false, limit: 50,
    }));
    expect(otherRows.map(row => row.threadId)).toEqual([elsewhere.thread.id]);
  });
});
