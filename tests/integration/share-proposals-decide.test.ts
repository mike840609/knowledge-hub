import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { RandomShareTokenIssuer } from "@/infrastructure/security/random-share-token-issuer";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
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

/** Mention proposals spec, "Owner decision API" and "Lifecycle": the owner approves or declines a proposed recipient. */

let pool: Pool;
beforeAll(() => { pool = createDatabasePool(databaseConfig("test")); });
afterAll(async () => { await pool.end(); });

const uow = () => new MariaDbUnitOfWork(pool);
const shares = () => new DocumentShareService(uow(), new RandomShareTokenIssuer());
const notFound = { code: "SHARE_LINK_NOT_FOUND" };
const MARKDOWN = "A secret passage here.";

async function newUser(name: string, prefix = "PROPOSAL-DECIDE"): Promise<UserIdentity> {
  const id = uuidv7();
  const identity = { id, emp_id: `${prefix}-${id}`, name, org_code: "PROPOSE" };
  await uow().run(r => r.users.upsertIdentity(identity));
  return identity;
}

async function setup() {
  const owner = await newUser("Decide Owner");
  const caller = callerFromIdentity(owner);
  const { workspace } = await new PersonalWorkspaceService(uow()).ensurePersonalWorkspace(owner.id);
  const sourceId = await ensureDefaultHubSource(uow(), caller, workspace.id);
  const hub = new HubKnowledgeCommandServiceImpl(uow());
  const doc = await hub.createDocument(caller, { sourceId, parentId: null, title: "Doc", markdown: MARKDOWN, metadata: {} });
  const [alice, carol] = [await newUser("Alice"), await newUser("Carol")];
  const link = await shares().create(caller, { documentId: doc.documentId, label: "Named", recipients: [alice.id] });
  const block = projectReviewBlocks(MARKDOWN)[0];
  const anchor: ReviewAnchor = { schemaVersion: 1, blockPath: block.path, blockKind: block.kind, startUtf16: 2, endUtf16: 16, exact: "secret passage", prefix: "A ", suffix: " here." };
  const review = new DocumentReviewService(uow(), () => new Date(), () => true);

  /** A thread Alice opens through `token`; returns its id and first comment's id. */
  const thread = async (token = link.path.slice(3)) => {
    const view = await review.createForLink(callerFromIdentity(alice), { token, expectedRevisionId: doc.revisionId, anchor, body: "Alice asks", idempotencyKey: randomUUID() });
    const [row] = await pool.query("SELECT id FROM document_review_comments WHERE thread_id=? LIMIT 1", [view.id]);
    return { threadId: view.id, commentId: String(row.id) };
  };
  /** A stored mention of `userId` in `commentId` through `linkId` — what Task 3's write path will store. */
  const mention = (commentId: string, userId: string, linkId = link.id) =>
    uow().run(r => r.reviewMentions.insertMany([{ commentId, mentionedUserId: userId, shareLinkId: linkId, createdAt: new Date(), readAt: null }]));
  const propose = async (userId: string, commentId: string, linkId = link.id) => {
    const id = uuidv7();
    await uow().run(r => r.shareProposals.insertIfAbsent({ id, shareLinkId: linkId, userId, proposedBy: alice.id, commentId, createdAt: new Date() }));
    return id;
  };
  const proposal = (id: string) => uow().run(r => r.shareProposals.findById(id));
  return { owner, caller, workspaceId: workspace.id, documentId: doc.documentId, alice, carol, link, thread, mention, propose, proposal };
}
type Fixture = Awaited<ReturnType<typeof setup>>;

async function recipients(linkId: string): Promise<string[]> {
  const rows = await pool.query<Array<{ user_id: string }>>("SELECT user_id FROM document_share_link_recipients WHERE share_link_id=?", [linkId]);
  return rows.map(row => String(row.user_id));
}

async function auditPayloads(workspaceId: string, eventType: string): Promise<Array<Record<string, unknown>>> {
  const rows = await pool.query<Array<{ payload: unknown }>>("SELECT payload FROM workspace_audit_events WHERE workspace_id = ? AND event_type = ? ORDER BY created_at, id", [workspaceId, eventType]);
  return rows.map(row => (typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload) as Record<string, unknown>);
}

async function follows(userId: string): Promise<Array<{ threadId: string; shareLinkId: string; following: boolean }>> {
  const rows = await pool.query<Array<{ thread_id: string; share_link_id: string; following: number }>>(
    "SELECT thread_id, share_link_id, following FROM review_thread_follows WHERE user_id=?", [userId]);
  return rows.map(row => ({ threadId: String(row.thread_id), shareLinkId: String(row.share_link_id), following: Number(row.following) === 1 }))
    .sort((a, b) => a.threadId.localeCompare(b.threadId));
}

/** A proposal for Carol, made by Alice's mention in a new thread through the NAMED link. */
async function pendingCarol(f: Fixture) {
  const first = await f.thread();
  await f.mention(first.commentId, f.carol.id);
  return { first, proposalId: await f.propose(f.carol.id, first.commentId) };
}

describe("approving a proposal", () => {
  it("adds the recipient, audits it, follows every thread a mention through the link names them in, and marks it APPROVED", async () => {
    const f = await setup();
    const { first, proposalId } = await pendingCarol(f);
    const second = await f.thread();
    await f.mention(second.commentId, f.carol.id);
    // A mention through another link of the document is not this link's to follow.
    const bearer = await shares().create(f.caller, { documentId: f.documentId });
    const elsewhere = await f.thread(bearer.path.slice(3));
    await f.mention(elsewhere.commentId, f.carol.id, bearer.id);

    await shares().approveProposal(f.caller, f.link.id, proposalId);

    expect((await recipients(f.link.id)).sort()).toEqual([f.alice.id, f.carol.id].sort());
    expect(await auditPayloads(f.workspaceId, "DOCUMENT_SHARE_RECIPIENT_ADDED")).toEqual([{ userId: f.carol.id }]);
    expect(await follows(f.carol.id)).toEqual([first.threadId, second.threadId].sort().map(threadId => ({ threadId, shareLinkId: f.link.id, following: true })));
    expect(await f.proposal(proposalId)).toMatchObject({ status: "APPROVED", decidedBy: f.owner.id, decidedAt: expect.any(Date) });
    await expect(shares().readShared(f.link.path.slice(3), { viewerId: f.carol.id, recordView: false })).resolves.toMatchObject({ kind: "DOCUMENT" });
  });

  it("is a no-op the second time, and a decline after it answers not-found", async () => {
    const f = await setup();
    const { proposalId } = await pendingCarol(f);
    await shares().approveProposal(f.caller, f.link.id, proposalId);
    await shares().approveProposal(f.caller, f.link.id, proposalId);
    expect(await auditPayloads(f.workspaceId, "DOCUMENT_SHARE_RECIPIENT_ADDED")).toHaveLength(1);
    await expect(shares().declineProposal(f.caller, f.link.id, proposalId)).rejects.toMatchObject(notFound);
    expect(await f.proposal(proposalId)).toMatchObject({ status: "APPROVED" });
  });

  it("at the recipient limit fails with the limit message and leaves the proposal PENDING", async () => {
    const f = await setup();
    const { proposalId } = await pendingCarol(f);
    const fillers = await Promise.all(Array.from({ length: MAX_NAMED_SHARE_RECIPIENTS - 1 }, (_, i) => newUser(`Filler ${i}`, "PROPOSAL-CAP")));
    await shares().addRecipients(f.caller, f.link.id, fillers.map(user => user.id));
    await expect(shares().approveProposal(f.caller, f.link.id, proposalId))
      .rejects.toMatchObject({ code: "INVALID_REQUEST", message: `A link can name at most ${MAX_NAMED_SHARE_RECIPIENTS} recipients.` });
    expect(await f.proposal(proposalId)).toMatchObject({ status: "PENDING", decidedBy: null });
    expect(await recipients(f.link.id)).not.toContain(f.carol.id);
    expect(await follows(f.carol.id)).toEqual([]);
  });
});

describe("declining a proposal", () => {
  it("marks it DECLINED with an audit event, names nobody and follows nothing", async () => {
    const f = await setup();
    const { proposalId } = await pendingCarol(f);
    await shares().declineProposal(f.caller, f.link.id, proposalId);
    expect(await f.proposal(proposalId)).toMatchObject({ status: "DECLINED", decidedBy: f.owner.id });
    expect(await auditPayloads(f.workspaceId, "DOCUMENT_SHARE_PROPOSAL_DECLINED")).toEqual([{ proposalId, userId: f.carol.id }]);
    expect(await recipients(f.link.id)).toEqual([f.alice.id]);
    expect(await follows(f.carol.id)).toEqual([]);
    await expect(shares().readShared(f.link.path.slice(3), { viewerId: f.carol.id, recordView: false })).rejects.toMatchObject(notFound);
  });

  it("is a no-op the second time, and an approve after it answers not-found", async () => {
    const f = await setup();
    const { proposalId } = await pendingCarol(f);
    await shares().declineProposal(f.caller, f.link.id, proposalId);
    await shares().declineProposal(f.caller, f.link.id, proposalId);
    expect(await auditPayloads(f.workspaceId, "DOCUMENT_SHARE_PROPOSAL_DECLINED")).toHaveLength(1);
    await expect(shares().approveProposal(f.caller, f.link.id, proposalId)).rejects.toMatchObject(notFound);
    expect(await recipients(f.link.id)).toEqual([f.alice.id]);
  });
});

describe("who may decide, and on what", () => {
  it("refuses the proposer, a recipient of the link, and a stranger as not-found", async () => {
    const f = await setup();
    const { proposalId } = await pendingCarol(f);
    for (const someone of [f.alice, f.carol, await newUser("Stranger")]) {
      await expect(shares().approveProposal(callerFromIdentity(someone), f.link.id, proposalId)).rejects.toMatchObject(notFound);
      await expect(shares().declineProposal(callerFromIdentity(someone), f.link.id, proposalId)).rejects.toMatchObject(notFound);
      await expect(shares().listProposals(callerFromIdentity(someone), f.link.id)).rejects.toMatchObject(notFound);
    }
    expect(await f.proposal(proposalId)).toMatchObject({ status: "PENDING" });
  });

  it("answers a revoked link as not-found", async () => {
    const f = await setup();
    const { proposalId } = await pendingCarol(f);
    await shares().revoke(f.caller, f.link.id);
    await expect(shares().approveProposal(f.caller, f.link.id, proposalId)).rejects.toMatchObject(notFound);
    await expect(shares().declineProposal(f.caller, f.link.id, proposalId)).rejects.toMatchObject(notFound);
    await expect(shares().listProposals(f.caller, f.link.id)).rejects.toMatchObject(notFound);
    expect(await f.proposal(proposalId)).toMatchObject({ status: "PENDING" });
  });

  it("answers a link whose document is archived as not-found", async () => {
    const f = await setup();
    const { proposalId } = await pendingCarol(f);
    await new HubKnowledgeCommandServiceImpl(uow()).archiveDocument(f.caller, f.documentId);
    await expect(shares().approveProposal(f.caller, f.link.id, proposalId)).rejects.toMatchObject(notFound);
    await expect(shares().declineProposal(f.caller, f.link.id, proposalId)).rejects.toMatchObject(notFound);
    expect(await f.proposal(proposalId)).toMatchObject({ status: "PENDING" });
  });

  it("answers a proposal of another link, an unknown proposal, and malformed ids as not-found", async () => {
    const f = await setup();
    const { first, proposalId } = await pendingCarol(f);
    const other = await shares().create(f.caller, { documentId: f.documentId, recipients: [f.alice.id] });
    const otherProposal = await f.propose(f.carol.id, first.commentId, other.id);
    for (const [linkId, id] of [[f.link.id, otherProposal], [f.link.id, uuidv7()], ["nope", proposalId], [f.link.id, "nope"]]) {
      await expect(shares().approveProposal(f.caller, linkId, id)).rejects.toMatchObject(notFound);
      await expect(shares().declineProposal(f.caller, linkId, id)).rejects.toMatchObject(notFound);
    }
    expect(await f.proposal(otherProposal)).toMatchObject({ status: "PENDING" });
  });
});

describe("listing proposals", () => {
  it("lists PENDING proposals only, oldest first, with the person and the proposer's current name", async () => {
    const f = await setup();
    const { proposalId } = await pendingCarol(f);
    const dave = await newUser("Dave");
    const erin = await newUser("Erin");
    const second = await f.thread();
    const daveProposal = await f.propose(dave.id, second.commentId);
    const erinProposal = await f.propose(erin.id, second.commentId);
    await shares().declineProposal(f.caller, f.link.id, erinProposal);

    const listed = await shares().listProposals(f.caller, f.link.id);
    expect(listed).toEqual([
      { id: proposalId, userId: f.carol.id, name: "Carol", nameEn: null, empId: f.carol.emp_id, orgCode: "PROPOSE", proposedByName: "Alice", createdAt: expect.any(Date) },
      { id: daveProposal, userId: dave.id, name: "Dave", nameEn: null, empId: dave.emp_id, orgCode: "PROPOSE", proposedByName: "Alice", createdAt: expect.any(Date) },
    ]);
  });
});

describe("adding from Manage", () => {
  it("marks a pending proposal for the added person APPROVED and follows their mentioned threads", async () => {
    const f = await setup();
    const { first, proposalId } = await pendingCarol(f);
    await shares().addRecipients(f.caller, f.link.id, [f.carol.id]);
    expect(await f.proposal(proposalId)).toMatchObject({ status: "APPROVED", decidedBy: f.owner.id });
    expect(await follows(f.carol.id)).toEqual([{ threadId: first.threadId, shareLinkId: f.link.id, following: true }]);
    expect(await shares().listProposals(f.caller, f.link.id)).toEqual([]);
  });
});
