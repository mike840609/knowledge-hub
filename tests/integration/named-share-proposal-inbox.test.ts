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
import { projectReviewBlocks } from "@/modules/knowledge/domain/review-anchor";
import type { ShareCommentNotificationView } from "@/modules/knowledge/domain/share-comment-event";
import { ensureDefaultHubSource } from "@/modules/sources/application/ensure-default-hub-source";
import { PersonalWorkspaceService } from "@/modules/workspaces/application/personal-workspace-service";
import { uuidv7 } from "@/shared/ids/uuidv7";

/**
 * Mention proposals spec, "Inbox" and "Folder NAMED links": a proposal is one entry for each party — the owner's
 * request, the proposed person's pending or declined notice, the proposer's decided notice — each judged per request
 * against the link. The proposed person learns the title and the proposer, never the comment.
 */
let pool: Pool;
beforeAll(() => { pool = createDatabasePool(databaseConfig("test")); });
afterAll(async () => { await pool.end(); });

const uow = () => new MariaDbUnitOfWork(pool);
const shares = () => new DocumentShareService(uow(), new RandomShareTokenIssuer());
const review = () => new DocumentReviewService(uow(), () => new Date(), () => true);
const MARKDOWN = "A secret passage here.";
const BODY = "Confidential remark about the plan";

async function newUser(name: string): Promise<UserIdentity> {
  const id = uuidv7();
  const identity = { id, emp_id: `PROPOSAL-INBOX-${id}`, name, org_code: "PROPOSE" };
  await uow().run(r => r.users.upsertIdentity(identity));
  await new PersonalWorkspaceService(uow()).ensurePersonalWorkspace(id);
  return identity;
}

async function setup(target: "DOCUMENT" | "FOLDER" = "DOCUMENT") {
  const owner = await newUser("Proposal Owner");
  const ownerCaller = callerFromIdentity(owner);
  const { workspace } = await new PersonalWorkspaceService(uow()).ensurePersonalWorkspace(owner.id);
  const sourceId = await ensureDefaultHubSource(uow(), ownerCaller, workspace.id);
  const hub = new HubKnowledgeCommandServiceImpl(uow());
  const { treeNodeId: folderNodeId } = await hub.createFolder(ownerCaller, { sourceId, parentId: null, name: "Team folder" });
  const doc = await hub.createDocument(ownerCaller, { sourceId, parentId: folderNodeId, title: "Quarterly plan", markdown: MARKDOWN, metadata: {} });
  const [alice, carol] = [await newUser("Alice Proposer"), await newUser("Carol Outsider")];
  const link = target === "DOCUMENT"
    ? await shares().create(ownerCaller, { documentId: doc.documentId, recipients: [alice.id] })
    : await shares().createForFolder(ownerCaller, { folderNodeId, recipients: [alice.id] });
  const block = projectReviewBlocks(MARKDOWN)[0];
  const anchor: ReviewAnchor = { schemaVersion: 1, blockPath: block.path, blockKind: block.kind, startUtf16: 2, endUtf16: 16, exact: "secret passage", prefix: "A ", suffix: " here." };
  const aliceCaller = callerFromIdentity(alice), carolCaller = callerFromIdentity(carol);
  /** Alice mentions Carol through the NAMED link: one PENDING proposal. */
  const propose = async () => {
    const thread = await review().createForLink(aliceCaller, {
      token: link.path.slice(3), documentId: target === "FOLDER" ? doc.documentId : undefined,
      expectedRevisionId: doc.revisionId, anchor, body: BODY, idempotencyKey: randomUUID(), mentions: [carol.id],
    });
    const [row] = await pool.query<Array<{ id: string }>>("SELECT id FROM document_share_link_proposals WHERE share_link_id=? AND user_id=?", [link.id, carol.id]);
    return { proposalId: String(row.id), thread };
  };
  return { owner, ownerCaller, hub, doc, link, alice, aliceCaller, carol, carolCaller, propose };
}
type Fixture = Awaited<ReturnType<typeof setup>>;

const isProposal = (view: ShareCommentNotificationView) => view.kind?.startsWith("PROPOSAL_") ?? false;
const unread = (caller: CallerContext) => review().listUnreadForOwner(caller).then(r => r.notifications);
const activity = (caller: CallerContext) => review().listActivityForOwner(caller).then(r => r.notifications);
const unreadProposals = (caller: CallerContext) => unread(caller).then(list => list.filter(isProposal));
const proposalActivity = (caller: CallerContext) => activity(caller).then(list => list.filter(isProposal));
const badge = (caller: CallerContext) => review().countUnreadForOwner(caller).then(r => r.count);

/** The badge counts exactly what the unread list lists, for every party. */
async function expectBadgeMatchesList(f: Fixture) {
  for (const caller of [f.ownerCaller, f.aliceCaller, f.carolCaller]) expect(await badge(caller)).toBe((await unread(caller)).length);
}
/** The proposed person's entries never carry the comment, a link or a token. */
function expectNothingOfTheComment(views: ShareCommentNotificationView[]) {
  for (const view of views) {
    expect(JSON.stringify(view)).not.toContain(BODY);
    expect(view.excerpt).toBe("");
    expect(view).not.toHaveProperty("href");
    expect(view).not.toHaveProperty("token");
    expect(view).not.toHaveProperty("shareLinkId");
    expect(view.commentId).toBe("");
    expect(view.threadId).toBe("");
  }
}

describe("a pending proposal", () => {
  it("asks the owner, with the proposer, the person, the title and the link to decide on", async () => {
    const f = await setup();
    const { proposalId } = await f.propose();
    expect(await unreadProposals(f.ownerCaller)).toEqual([expect.objectContaining({
      id: `proposal:OWNER:${proposalId}`, kind: "PROPOSAL_REQUEST", proposalId, proposalStatus: "PENDING",
      authorName: "Alice Proposer", personName: "Carol Outsider", documentTitle: "Quarterly plan", shareLinkId: f.link.id,
      targetKind: "DOCUMENT", linkAvailable: true, readAt: null,
    })]);
    expect(await unreadProposals(f.aliceCaller)).toEqual([]);
    await expectBadgeMatchesList(f);
  });

  it("tells the proposed person who and what, and nothing of the comment; their dead mention is not listed beside it", async () => {
    const f = await setup();
    const { proposalId } = await f.propose();
    const entries = await unreadProposals(f.carolCaller);
    expect(entries).toEqual([expect.objectContaining({
      id: `proposal:PROPOSED:${proposalId}`, kind: "PROPOSAL_PENDING", proposalId, proposalStatus: "PENDING",
      authorName: "Alice Proposer", documentTitle: "Quarterly plan", linkAvailable: true, readAt: null,
    })]);
    expect(entries[0]).not.toHaveProperty("personName");
    expectNothingOfTheComment(entries);
    const all = await activity(f.carolCaller);
    expect(all.filter(view => view.kind === "MENTION")).toEqual([]);
    expectNothingOfTheComment(all);
    expect(await badge(f.carolCaller)).toBe(1);
    await expectBadgeMatchesList(f);
  });
});

describe("an approved proposal", () => {
  it("tells the proposer, reads as decided for the owner, and leaves the person their share and a live mention", async () => {
    const f = await setup();
    const { proposalId } = await f.propose();
    await shares().approveProposal(f.ownerCaller, f.link.id, proposalId);
    expect(await unreadProposals(f.aliceCaller)).toEqual([expect.objectContaining({
      id: `proposal:PROPOSER:${proposalId}`, kind: "PROPOSAL_DECIDED", proposalId, proposalStatus: "APPROVED",
      personName: "Carol Outsider", documentTitle: "Quarterly plan", linkAvailable: true, readAt: null,
    })]);
    expect((await unreadProposals(f.aliceCaller))[0]).not.toHaveProperty("shareLinkId");
    expect(await unreadProposals(f.ownerCaller)).toEqual([]);
    expect(await proposalActivity(f.ownerCaller)).toEqual([expect.objectContaining({
      id: `proposal:OWNER:${proposalId}`, kind: "PROPOSAL_REQUEST", proposalStatus: "APPROVED", readAt: expect.any(Date),
    })]);
    expect(await proposalActivity(f.carolCaller)).toEqual([]);
    const carolsActivity = await activity(f.carolCaller);
    expect(carolsActivity.filter(view => view.kind === "SHARED_WITH_YOU")).toEqual([expect.objectContaining({ linkAvailable: true })]);
    expect(carolsActivity.filter(view => view.kind === "MENTION")).toEqual([expect.objectContaining({ linkAvailable: true, authorName: "Alice Proposer" })]);
    await expectBadgeMatchesList(f);
  });
});

describe("a declined proposal", () => {
  it("tells the proposed person and the proposer, neither with the comment", async () => {
    const f = await setup();
    const { proposalId } = await f.propose();
    await shares().declineProposal(f.ownerCaller, f.link.id, proposalId);
    const carols = await unreadProposals(f.carolCaller);
    expect(carols).toEqual([expect.objectContaining({
      id: `proposal:PROPOSED:${proposalId}`, kind: "PROPOSAL_DECIDED", proposalStatus: "DECLINED", documentTitle: "Quarterly plan", linkAvailable: true, readAt: null,
    })]);
    expect(carols[0]).not.toHaveProperty("personName");
    expectNothingOfTheComment(await activity(f.carolCaller));
    expect((await activity(f.carolCaller)).filter(view => view.kind === "MENTION")).toEqual([]);
    const alices = await unreadProposals(f.aliceCaller);
    expect(alices).toEqual([expect.objectContaining({
      id: `proposal:PROPOSER:${proposalId}`, kind: "PROPOSAL_DECIDED", proposalStatus: "DECLINED", personName: "Carol Outsider", readAt: null,
    })]);
    expect(JSON.stringify(alices)).not.toContain(BODY);
    expect(await unreadProposals(f.ownerCaller)).toEqual([]);
    expect(await proposalActivity(f.ownerCaller)).toEqual([expect.objectContaining({ proposalStatus: "DECLINED", readAt: expect.any(Date) })]);
    await expectBadgeMatchesList(f);
  });
});

describe("reading proposal entries", () => {
  it("marks one party's entry read, only for that party", async () => {
    const f = await setup();
    const { proposalId } = await f.propose();
    // Someone else's id, an unknown id and malformed ids change nothing and are no error.
    await review().markEventRead(f.aliceCaller, `proposal:OWNER:${proposalId}`);
    await review().markEventRead(f.aliceCaller, `proposal:PROPOSED:${proposalId}`);
    await review().markEventRead(f.ownerCaller, `proposal:PROPOSED:${uuidv7()}`);
    await review().markEventRead(f.ownerCaller, "proposal:OWNER:not-a-uuid");
    await review().markEventRead(f.ownerCaller, `proposal:SOMEONE:${proposalId}`);
    expect(await unreadProposals(f.ownerCaller)).toHaveLength(1);
    expect(await unreadProposals(f.carolCaller)).toHaveLength(1);
    await review().markEventRead(f.ownerCaller, `proposal:OWNER:${proposalId}`);
    expect(await unreadProposals(f.ownerCaller)).toEqual([]);
    expect(await proposalActivity(f.ownerCaller)).toEqual([expect.objectContaining({ proposalStatus: "PENDING", readAt: expect.any(Date) })]);
    expect(await unreadProposals(f.carolCaller)).toHaveLength(1);
    await review().markEventRead(f.carolCaller, `proposal:PROPOSED:${proposalId}`);
    expect(await unreadProposals(f.carolCaller)).toEqual([]);
    await expectBadgeMatchesList(f);
  });

  it("marks every party's entries read with mark-all", async () => {
    const f = await setup();
    await f.propose();
    for (const caller of [f.ownerCaller, f.carolCaller]) {
      await review().markAllActivityRead(caller);
      expect(await unreadProposals(caller)).toEqual([]);
      expect(await badge(caller)).toBe(0);
    }
  });

  it("brings a decision in unread after everything was marked read while it was pending", async () => {
    for (const decision of ["approve", "decline", "manage-add"] as const) {
      const f = await setup();
      const { proposalId } = await f.propose();
      for (const caller of [f.ownerCaller, f.aliceCaller, f.carolCaller]) await review().markAllActivityRead(caller);
      if (decision === "approve") await shares().approveProposal(f.ownerCaller, f.link.id, proposalId);
      if (decision === "decline") await shares().declineProposal(f.ownerCaller, f.link.id, proposalId);
      if (decision === "manage-add") await shares().addRecipients(f.ownerCaller, f.link.id, [f.carol.id]);
      const status = decision === "decline" ? "DECLINED" : "APPROVED";
      expect(await unreadProposals(f.aliceCaller)).toEqual([expect.objectContaining({ kind: "PROPOSAL_DECIDED", proposalStatus: status, readAt: null })]);
      expect(await unreadProposals(f.carolCaller)).toEqual(decision === "decline"
        ? [expect.objectContaining({ kind: "PROPOSAL_DECIDED", proposalStatus: "DECLINED", readAt: null })]
        : []);
      await expectBadgeMatchesList(f);
    }
  });
});

describe("a proposal whose link no longer opens", () => {
  it("names nothing and is never unread for any party once the link is revoked", async () => {
    const f = await setup();
    const { proposalId } = await f.propose();
    await shares().revoke(f.ownerCaller, f.link.id);
    for (const caller of [f.ownerCaller, f.carolCaller]) {
      expect(await unreadProposals(caller)).toEqual([]);
      const [entry] = await proposalActivity(caller);
      expect(entry).toMatchObject({ proposalId, linkAvailable: false, documentTitle: "", authorName: undefined, readAt: expect.any(Date) });
      expect(entry).not.toHaveProperty("personName");
      expect(entry).not.toHaveProperty("shareLinkId");
      expect(entry).not.toHaveProperty("targetKind");
    }
    await expectBadgeMatchesList(f);
  });

  it("names nothing for any party once the document is archived", async () => {
    const f = await setup();
    await f.propose();
    await f.hub.archiveDocument(f.ownerCaller, f.doc.documentId);
    for (const caller of [f.ownerCaller, f.carolCaller]) {
      expect(await proposalActivity(caller)).toEqual([expect.objectContaining({ linkAvailable: false, documentTitle: "" })]);
    }
    await expectBadgeMatchesList(f);
  });

  it("names nothing to a proposer removed from the link, while the owner can still decide", async () => {
    const f = await setup();
    const { proposalId } = await f.propose();
    await shares().removeRecipient(f.ownerCaller, f.link.id, f.alice.id);
    expect(await unreadProposals(f.ownerCaller)).toEqual([expect.objectContaining({ proposalId, linkAvailable: true, personName: "Carol Outsider" })]);
    await shares().approveProposal(f.ownerCaller, f.link.id, proposalId);
    expect(await unreadProposals(f.aliceCaller)).toEqual([]);
    const [entry] = await proposalActivity(f.aliceCaller);
    expect(entry).toMatchObject({ kind: "PROPOSAL_DECIDED", linkAvailable: false, documentTitle: "", readAt: expect.any(Date) });
    expect(entry).not.toHaveProperty("personName");
    await expectBadgeMatchesList(f);
  });
});

describe("a proposal on a folder link", () => {
  it("names the folder the link opens, not the document the comment is on", async () => {
    const f = await setup("FOLDER");
    await f.propose();
    expect(await unreadProposals(f.ownerCaller)).toEqual([expect.objectContaining({ kind: "PROPOSAL_REQUEST", documentTitle: "Team folder", targetKind: "FOLDER" })]);
    expect(await unreadProposals(f.carolCaller)).toEqual([expect.objectContaining({ kind: "PROPOSAL_PENDING", documentTitle: "Team folder", targetKind: "FOLDER" })]);
    await expectBadgeMatchesList(f);
  });
});
