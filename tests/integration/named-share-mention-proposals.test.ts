import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { RandomShareTokenIssuer } from "@/infrastructure/security/random-share-token-issuer";
import { callerFromIdentity, type CallerContext } from "@/modules/identity/domain/caller-context";
import type { UserIdentity } from "@/modules/identity/domain/user-identity";
import { DocumentReviewService } from "@/modules/knowledge/application/document-review-service";
import { DocumentShareService } from "@/modules/knowledge/application/document-share-service";
import { HubKnowledgeCommandServiceImpl } from "@/modules/knowledge/application/hub-knowledge-command-service";
import type { ReviewAnchor } from "@/modules/knowledge/domain/document-review";
import { MAX_NAMED_SHARE_RECIPIENTS } from "@/modules/knowledge/domain/document-share-link";
import { projectReviewBlocks } from "@/modules/knowledge/domain/review-anchor";
import { ensureDefaultHubSource } from "@/modules/sources/application/ensure-default-hub-source";
import { PersonalWorkspaceService } from "@/modules/workspaces/application/personal-workspace-service";
import { uuidv7 } from "@/shared/ids/uuidv7";

/**
 * Mention proposals spec, "Write path" and "Mention candidates": a recipient's mention of someone a NAMED link
 * does not name stores the (dead) mention and a PENDING proposal, and grants nothing; the owner's mention adds them.
 */
let pool: Pool;
beforeAll(() => { pool = createDatabasePool(databaseConfig("test")); });
afterAll(async () => { await pool.end(); });

const uow = () => new MariaDbUnitOfWork(pool);
const shares = () => new DocumentShareService(uow(), new RandomShareTokenIssuer());
const review = () => new DocumentReviewService(uow(), () => new Date(), () => true);
const notFound = { code: "SHARE_LINK_NOT_FOUND" };
const full = { code: "INVALID_REQUEST", message: `A link can name at most ${MAX_NAMED_SHARE_RECIPIENTS} recipients.` };
const MARKDOWN = "A secret passage here.";

async function newUser(name: string, tag: string): Promise<UserIdentity> {
  const id = uuidv7();
  const identity = { id, emp_id: `PROPOSE-WRITE-${id}`, name: `${tag} ${name}`, org_code: "PROPOSE" };
  await uow().run(r => r.users.upsertIdentity(identity));
  return identity;
}

async function setup() {
  // A shared word in every name, so one query matches recipients and outsiders alike.
  const tag = `Propose${randomUUID().slice(0, 8)}`;
  const owner = await newUser("Owner", tag);
  const ownerCaller = callerFromIdentity(owner);
  const { workspace } = await new PersonalWorkspaceService(uow()).ensurePersonalWorkspace(owner.id);
  const sourceId = await ensureDefaultHubSource(uow(), ownerCaller, workspace.id);
  const doc = await new HubKnowledgeCommandServiceImpl(uow()).createDocument(ownerCaller, { sourceId, parentId: null, title: "Doc", markdown: MARKDOWN, metadata: {} });
  const [alice, bob, carol] = [await newUser("Alice", tag), await newUser("Bob", tag), await newUser("Carol", tag)];
  const link = await shares().create(ownerCaller, { documentId: doc.documentId, label: "Named", recipients: [alice.id, bob.id] });
  const token = link.path.slice(3);
  const block = projectReviewBlocks(MARKDOWN)[0];
  const anchor: ReviewAnchor = { schemaVersion: 1, blockPath: block.path, blockKind: block.kind, startUtf16: 2, endUtf16: 16, exact: "secret passage", prefix: "A ", suffix: " here." };
  const aliceCaller = callerFromIdentity(alice);
  const start = (caller: CallerContext, mentions?: string[], viaToken = token) =>
    review().createForLink(caller, { token: viaToken, expectedRevisionId: doc.revisionId, anchor, body: "A question", idempotencyKey: randomUUID(), mentions });
  const reply = (caller: CallerContext, threadId: string, mentions?: string[]) =>
    review().replyForLink(caller, { token, threadId, body: "An answer", idempotencyKey: randomUUID(), mentions });
  const ownerStart = (mentions: string[], mentionLinkId = link.id) => review().createForOwner(ownerCaller, {
    documentId: doc.documentId, expectedRevisionId: doc.revisionId, anchor, body: "Look", idempotencyKey: randomUUID(), mentions, mentionLinkId,
  });
  const ownerReply = (threadId: string, mentions: string[]) => review().replyForOwner(ownerCaller, {
    documentId: doc.documentId, threadId, body: "Owner answers", idempotencyKey: randomUUID(), mentions, mentionLinkId: link.id,
  });
  return { tag, owner, ownerCaller, workspaceId: workspace.id, doc, alice, aliceCaller, bob, carol, link, token, start, reply, ownerStart, ownerReply };
}
type Fixture = Awaited<ReturnType<typeof setup>>;

async function recipients(linkId: string): Promise<string[]> {
  const rows = await pool.query<Array<{ user_id: string }>>("SELECT user_id FROM document_share_link_recipients WHERE share_link_id=?", [linkId]);
  return rows.map(row => String(row.user_id)).sort();
}
async function proposals(linkId: string) {
  const rows = await pool.query<Array<{ user_id: string; proposed_by: string; comment_id: string; status: string }>>(
    "SELECT user_id, proposed_by, comment_id, status FROM document_share_link_proposals WHERE share_link_id=? ORDER BY created_at, id", [linkId]);
  return rows.map(row => ({ userId: String(row.user_id), proposedBy: String(row.proposed_by), commentId: String(row.comment_id), status: String(row.status) }));
}
async function mentions(documentId: string) {
  const rows = await pool.query<Array<{ id: string; link: string; comment: string }>>(
    "SELECT m.mentioned_user_id AS id, m.share_link_id AS link, m.comment_id AS comment FROM review_comment_mentions m JOIN document_review_comments c ON c.id=m.comment_id JOIN document_review_threads t ON t.id=c.thread_id WHERE t.document_id=? ORDER BY c.created_at, c.id, m.mentioned_user_id",
    [documentId]);
  return rows.map(row => ({ userId: String(row.id), shareLinkId: String(row.link), commentId: String(row.comment) }));
}
async function follows(userId: string) {
  const rows = await pool.query<Array<{ thread_id: string; share_link_id: string }>>("SELECT thread_id, share_link_id FROM review_thread_follows WHERE user_id=? AND following=1", [userId]);
  return rows.map(row => ({ threadId: String(row.thread_id), shareLinkId: String(row.share_link_id) }));
}
async function threadCount(documentId: string): Promise<number> {
  const [row] = await pool.query<Array<{ n: bigint }>>("SELECT COUNT(*) AS n FROM document_review_threads WHERE document_id=?", [documentId]);
  return Number(row.n);
}
async function firstCommentId(threadId: string): Promise<string> {
  const [row] = await pool.query<Array<{ id: string }>>("SELECT id FROM document_review_comments WHERE thread_id=? ORDER BY created_at, id LIMIT 1", [threadId]);
  return String(row.id);
}
/** The outsider can open nothing the link opens: not the document (`/s/:token`, the Hub reader), not its discussion. */
async function expectShutOut(f: Fixture, user: UserIdentity) {
  await expect(shares().readShared(f.token, { viewerId: user.id, recordView: false })).rejects.toMatchObject(notFound);
  await expect(shares().readShared(f.token, { recordView: false })).rejects.toMatchObject(notFound);
  await expect(review().queryForLink(callerFromIdentity(user), f.token)).rejects.toMatchObject(notFound);
  await expect(review().queryForLink(null, f.token)).rejects.toMatchObject(notFound);
}

describe("a recipient mentioning someone the NAMED link does not name", () => {
  it("stores the comment, the mention and one PENDING proposal, and grants nothing", async () => {
    const f = await setup();
    const thread = await f.start(f.aliceCaller, [f.carol.id]);
    const commentId = thread.comments[0].id;
    expect(await mentions(f.doc.documentId)).toEqual([{ userId: f.carol.id, shareLinkId: f.link.id, commentId }]);
    expect(await proposals(f.link.id)).toEqual([{ userId: f.carol.id, proposedBy: f.alice.id, commentId, status: "PENDING" }]);
    expect(await recipients(f.link.id)).toEqual([f.alice.id, f.bob.id].sort());
    expect(await follows(f.carol.id)).toEqual([]);
    await expectShutOut(f, f.carol);
    // The writer still follows their own discussion, as any link write does.
    expect(await follows(f.alice.id)).toEqual([{ threadId: thread.id, shareLinkId: f.link.id }]);
  });

  it("follows the recipients it names and proposes only the outsider", async () => {
    const f = await setup();
    const thread = await f.start(f.aliceCaller, [f.bob.id, f.carol.id]);
    expect((await mentions(f.doc.documentId)).map(m => m.userId).sort()).toEqual([f.bob.id, f.carol.id].sort());
    expect((await proposals(f.link.id)).map(p => p.userId)).toEqual([f.carol.id]);
    expect(await follows(f.bob.id)).toEqual([{ threadId: thread.id, shareLinkId: f.link.id }]);
    expect(await follows(f.carol.id)).toEqual([]);
  });

  it("proposes a person once, whoever mentions them again and wherever", async () => {
    const f = await setup();
    const first = await f.start(f.aliceCaller, [f.carol.id]);
    const second = await f.start(callerFromIdentity(f.bob), [f.carol.id]);
    await f.reply(f.aliceCaller, second.id, [f.carol.id]);
    expect(await proposals(f.link.id)).toEqual([{ userId: f.carol.id, proposedBy: f.alice.id, commentId: first.comments[0].id, status: "PENDING" }]);
    expect((await mentions(f.doc.documentId)).filter(m => m.userId === f.carol.id)).toHaveLength(3);
    expect(await follows(f.carol.id)).toEqual([]);
  });

  it("after a decline stores the dead mention and proposes nothing new", async () => {
    const f = await setup();
    await f.start(f.aliceCaller, [f.carol.id]);
    const [{ id }] = await shares().listProposals(f.ownerCaller, f.link.id);
    await shares().declineProposal(f.ownerCaller, f.link.id, id);
    await f.start(f.aliceCaller, [f.carol.id]);
    expect((await proposals(f.link.id)).map(p => p.status)).toEqual(["DECLINED"]);
    expect((await mentions(f.doc.documentId)).filter(m => m.userId === f.carol.id)).toHaveLength(2);
    expect(await follows(f.carol.id)).toEqual([]);
    await expectShutOut(f, f.carol);
  });

  it("proposes nobody the link already names, even one added while a proposal was pending", async () => {
    const f = await setup();
    await f.start(f.aliceCaller, [f.carol.id]);
    // Review Focus 1: added directly from Manage; the pending proposal is approved, not left behind.
    await shares().addRecipients(f.ownerCaller, f.link.id, [f.carol.id]);
    const thread = await f.start(f.aliceCaller, [f.carol.id]);
    expect((await proposals(f.link.id)).map(p => p.status)).toEqual(["APPROVED"]);
    expect(await follows(f.carol.id)).toContainEqual({ threadId: thread.id, shareLinkId: f.link.id });
  });

  it("is refused when recipients and pending proposals would pass the limit, writing nothing", async () => {
    const f = await setup();
    // Review Focus 5: 46 recipients, ten mentions of which six are outsiders.
    const fillers = await Promise.all(Array.from({ length: 44 }, (_, i) => newUser(`Filler ${i}`, f.tag)));
    await shares().addRecipients(f.ownerCaller, f.link.id, fillers.map(u => u.id));
    expect(await recipients(f.link.id)).toHaveLength(46);
    const outsiders = await Promise.all(Array.from({ length: 6 }, (_, i) => newUser(`Outsider ${i}`, f.tag)));
    const named = [f.bob.id, ...fillers.slice(0, 3).map(u => u.id), ...outsiders.map(u => u.id)];
    expect(named).toHaveLength(10);
    await expect(f.start(f.aliceCaller, named)).rejects.toMatchObject(full);
    expect(await threadCount(f.doc.documentId)).toBe(0);
    expect(await mentions(f.doc.documentId)).toEqual([]);
    expect(await proposals(f.link.id)).toEqual([]);
    expect(await follows(f.alice.id)).toEqual([]);
  });

  it("counts pending proposals toward the limit, and not declined ones", async () => {
    const f = await setup();
    const fillers = await Promise.all(Array.from({ length: MAX_NAMED_SHARE_RECIPIENTS - 4 }, (_, i) => newUser(`Filler ${i}`, f.tag)));
    await shares().addRecipients(f.ownerCaller, f.link.id, fillers.map(u => u.id));
    const [pending, declined, more, last] = [await newUser("Pending", f.tag), await newUser("Declined", f.tag), await newUser("More", f.tag), await newUser("Last", f.tag)];
    // 48 recipients + 2 proposed: exactly the limit.
    const thread = await f.start(f.aliceCaller, [pending.id, declined.id]);
    const decline = (await shares().listProposals(f.ownerCaller, f.link.id)).find(p => p.userId === declined.id)!;
    await shares().declineProposal(f.ownerCaller, f.link.id, decline.id);
    await shares().addRecipients(f.ownerCaller, f.link.id, [last.id]);
    // 49 recipients + 1 pending: one more is one too many.
    await expect(f.reply(f.aliceCaller, thread.id, [more.id])).rejects.toMatchObject(full);
    await expect(f.start(f.aliceCaller, [more.id])).rejects.toMatchObject(full);
    // Mentioning the already pending and the declined person proposes nobody new, so it is not refused.
    await f.reply(f.aliceCaller, thread.id, [pending.id, declined.id]);
    expect((await proposals(f.link.id)).map(p => [p.userId, p.status])).toEqual(expect.arrayContaining([[pending.id, "PENDING"], [declined.id, "DECLINED"]]));
    expect((await proposals(f.link.id)).map(p => p.userId)).not.toContain(more.id);
  });
});

describe("the owner mentioning someone the NAMED link does not name", () => {
  it("through the Hub reader adds them: recipient, audit, follow, live mention, and a pending proposal APPROVED", async () => {
    const f = await setup();
    await f.start(f.aliceCaller, [f.carol.id]);
    const thread = await f.start(f.ownerCaller, [f.carol.id]);
    expect(await recipients(f.link.id)).toEqual([f.alice.id, f.bob.id, f.carol.id].sort());
    expect((await proposals(f.link.id)).map(p => p.status)).toEqual(["APPROVED"]);
    expect(await follows(f.carol.id)).toContainEqual({ threadId: thread.id, shareLinkId: f.link.id });
    await expect(shares().readShared(f.token, { viewerId: f.carol.id, recordView: false })).resolves.toMatchObject({ kind: "DOCUMENT" });
    const unread = (await review().listUnreadForOwner(callerFromIdentity(f.carol))).notifications;
    expect(unread.filter(n => n.kind === "MENTION" && n.linkAvailable).map(n => n.threadId)).toContain(thread.id);
    expect(unread.some(n => n.kind === "SHARED_WITH_YOU")).toBe(true);
    const [row] = await pool.query<Array<{ n: bigint }>>("SELECT COUNT(*) AS n FROM workspace_audit_events WHERE workspace_id=? AND event_type='DOCUMENT_SHARE_RECIPIENT_ADDED' AND JSON_VALUE(payload,'$.userId')=?", [f.workspaceId, f.carol.id]);
    expect(Number(row.n)).toBe(1);
  });

  it("from the Workspace view handing over the NAMED link adds them, on a new thread and a reply", async () => {
    const f = await setup();
    const thread = await f.ownerStart([f.carol.id]);
    expect(await recipients(f.link.id)).toContain(f.carol.id);
    expect(await follows(f.carol.id)).toEqual([{ threadId: thread.id, shareLinkId: f.link.id }]);
    const dave = await newUser("Dave", f.tag);
    await f.ownerReply(thread.id, [dave.id]);
    expect(await recipients(f.link.id)).toContain(dave.id);
    expect(await follows(dave.id)).toEqual([{ threadId: thread.id, shareLinkId: f.link.id }]);
    expect(await proposals(f.link.id)).toEqual([]);
  });

  it("past the recipient limit is refused, writing nothing", async () => {
    const f = await setup();
    const fillers = await Promise.all(Array.from({ length: 44 }, (_, i) => newUser(`Filler ${i}`, f.tag)));
    await shares().addRecipients(f.ownerCaller, f.link.id, fillers.map(u => u.id));
    const outsiders = await Promise.all(Array.from({ length: 6 }, (_, i) => newUser(`Outsider ${i}`, f.tag)));
    await expect(f.ownerStart(outsiders.map(u => u.id))).rejects.toMatchObject(full);
    await expect(f.start(f.ownerCaller, outsiders.map(u => u.id))).rejects.toMatchObject(full);
    expect(await recipients(f.link.id)).toHaveLength(46);
    expect(await threadCount(f.doc.documentId)).toBe(0);
    expect(await mentions(f.doc.documentId)).toEqual([]);
  });

  it("is offered every live link of the document, NAMED ones whoever is mentioned, with its audience", async () => {
    const f = await setup();
    const bearer = await shares().create(f.ownerCaller, { documentId: f.doc.documentId });
    const { links } = await review().mentionLinksForOwner(f.ownerCaller, { documentId: f.doc.documentId });
    expect(links).toEqual(expect.arrayContaining([
      { id: f.link.id, label: "Named", audience: "NAMED", targetKind: "DOCUMENT" },
      { id: bearer.id, label: null, audience: "LINK", targetKind: "DOCUMENT" },
    ]));
    expect(links).toHaveLength(2);
  });
});

describe("an anyone-with-the-link mention", () => {
  it("is unchanged: the person follows and nothing is proposed", async () => {
    const f = await setup();
    const bearer = await shares().create(f.ownerCaller, { documentId: f.doc.documentId });
    const thread = await f.start(f.aliceCaller, [f.carol.id], bearer.path.slice(3));
    expect(await follows(f.carol.id)).toEqual([{ threadId: thread.id, shareLinkId: bearer.id }]);
    expect(await proposals(bearer.id)).toEqual([]);
    expect(await firstCommentId(thread.id)).toBe(thread.comments[0].id);
  });
});

describe("mention candidates on a NAMED link", () => {
  it("offer recipients first, then other Hub users flagged as needing the owner's approval", async () => {
    const f = await setup();
    const { candidates } = await review().searchMentionCandidates(f.aliceCaller, { query: f.tag, token: f.token });
    expect(candidates[0]).toMatchObject({ id: f.bob.id, needsApproval: false });
    expect(candidates).toContainEqual(expect.objectContaining({ id: f.carol.id, needsApproval: true }));
    // Never the writer or the owner.
    expect(candidates.map(c => c.id)).not.toContain(f.alice.id);
    expect(candidates.map(c => c.id)).not.toContain(f.owner.id);
    expect(new Set(candidates.map(c => c.id)).size).toBe(candidates.length);
  });

  it("need no approval when the owner asks, through the link or the Workspace view", async () => {
    const f = await setup();
    const viaLink = (await review().searchMentionCandidates(f.ownerCaller, { query: f.tag, token: f.token })).candidates;
    expect(viaLink.map(c => c.id)).toEqual(expect.arrayContaining([f.alice.id, f.bob.id, f.carol.id]));
    expect(viaLink.every(c => c.needsApproval === false)).toBe(true);
    const viaView = (await review().searchMentionCandidates(f.ownerCaller, { query: f.tag, documentId: f.doc.documentId })).candidates;
    expect(viaView.every(c => c.needsApproval === false)).toBe(true);
  });

  it("are still refused to a stranger, as a dead link is", async () => {
    const f = await setup();
    await expect(review().searchMentionCandidates(callerFromIdentity(f.carol), { query: f.tag, token: f.token })).rejects.toMatchObject(notFound);
  });
});
