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
import type { DocumentShareLink } from "@/modules/knowledge/domain/document-share-link";
import { projectReviewBlocks } from "@/modules/knowledge/domain/review-anchor";
import { ensureDefaultHubSource } from "@/modules/sources/application/ensure-default-hub-source";
import { PersonalWorkspaceService } from "@/modules/workspaces/application/personal-workspace-service";
import { uuidv7 } from "@/shared/ids/uuidv7";

let pool: Pool;
beforeAll(() => { pool = createDatabasePool(databaseConfig("test")); });
afterAll(async () => { await pool.end(); });

const uow = () => new MariaDbUnitOfWork(pool);
const T0 = Date.UTC(2026, 10, 3, 9, 0);
const at = (seconds: number) => new Date(T0 + seconds * 1000);
const identity = (name: string) => ({ id: uuidv7(), emp_id: randomUUID(), name, org_code: "PROPOSAL" });

async function fixture() {
  const [ownerId, writerId, carolId, daveId] = ["Owner", "Writer", "Carol", "Dave"].map(identity);
  await uow().run(async r => { for (const user of [ownerId, writerId, carolId, daveId]) await r.users.upsertIdentity(user); });
  const owner = callerFromIdentity(ownerId);
  const { workspace } = await new PersonalWorkspaceService(uow()).ensurePersonalWorkspace(ownerId.id);
  const sourceId = await ensureDefaultHubSource(uow(), owner, workspace.id);
  const commands = new HubKnowledgeCommandServiceImpl(uow());
  const created = await commands.createDocument(owner, { sourceId, parentId: null, title: "Doc", markdown: "A secret passage here.", metadata: {} });
  const bearer = await new DocumentShareService(uow(), new RandomShareTokenIssuer()).create(owner, { documentId: created.documentId });
  const block = projectReviewBlocks("A secret passage here.")[0];
  const anchor: ReviewAnchor = { schemaVersion: 1, blockPath: block.path, blockKind: block.kind, startUtf16: 2, endUtf16: 16, exact: "secret passage", prefix: "A ", suffix: " here." };
  const review = new DocumentReviewService(uow(), () => at(0), () => true);
  const commentId = async () => {
    const thread = await review.createForLink(callerFromIdentity(writerId), { token: bearer.path.slice(3), expectedRevisionId: created.revisionId, anchor, body: "Writer asks", idempotencyKey: randomUUID() });
    const [row] = await pool.query("SELECT id FROM document_review_comments WHERE thread_id=? LIMIT 1", [thread.id]);
    return String(row.id);
  };
  const namedLink = async (): Promise<string> => {
    const link: DocumentShareLink = {
      id: uuidv7(), target: { kind: "DOCUMENT", documentId: created.documentId }, token: randomUUID(), label: null, audience: "NAMED",
      createdBy: ownerId.id, createdAt: at(0), expiresAt: null, revokedBy: null, revokedAt: null,
    };
    await uow().run(r => r.shareLinks.insert(link));
    return link.id;
  };
  const propose = async (linkId: string, userId: string, proposedBy = writerId.id, seconds = 1) => {
    const id = uuidv7();
    const inserted = await uow().run(async r => r.shareProposals.insertIfAbsent({ id, shareLinkId: linkId, userId, proposedBy, commentId: await commentId(), createdAt: at(seconds) }));
    return { id, inserted };
  };
  return { owner: ownerId.id, writer: writerId.id, carol: carolId.id, dave: daveId.id, namedLink, propose };
}

const run = <T>(work: (r: Parameters<Parameters<MariaDbUnitOfWork["run"]>[0]>[0]["shareProposals"]) => Promise<T>) => uow().run(r => work(r.shareProposals));

describe("share proposals repository", () => {
  it("stores a PENDING proposal and answers false for a second row on the same (link, user)", async () => {
    const f = await fixture();
    const link = await f.namedLink();
    const first = await f.propose(link, f.carol);
    expect(first.inserted).toBe(true);
    expect(await run(s => s.findById(first.id))).toEqual({
      id: first.id, shareLinkId: link, userId: f.carol, proposedBy: f.writer, commentId: expect.any(String), status: "PENDING",
      createdAt: at(1), decidedBy: null, decidedAt: null, ownerReadAt: null, proposedReadAt: null, proposerReadAt: null,
    });
    expect((await f.propose(link, f.carol, f.dave)).inserted).toBe(false);
    expect(await run(s => s.listByLink(link))).toHaveLength(1);
    expect((await f.propose(await f.namedLink(), f.carol)).inserted).toBe(true);
  });

  it("returns null for an unknown id", async () => {
    expect(await run(s => s.findById(randomUUID()))).toBeNull();
    expect(await uow().run(r => r.shareProposals.lockById(randomUUID()))).toBeNull();
  });

  it("decides only from PENDING and records who and when", async () => {
    const f = await fixture();
    const link = await f.namedLink();
    const { id } = await f.propose(link, f.carol);
    expect(await run(s => s.decide(id, "DECLINED", f.owner, at(5)))).toBe(true);
    expect(await run(s => s.decide(id, "DECLINED", f.owner, at(6)))).toBe(false);
    expect(await run(s => s.decide(id, "APPROVED", f.owner, at(7)))).toBe(false);
    expect(await run(s => s.findById(id))).toMatchObject({ status: "DECLINED", decidedBy: f.owner, decidedAt: at(5) });
  });

  it("refuses a new proposal for a declined person (the decline is final)", async () => {
    const f = await fixture();
    const link = await f.namedLink();
    const { id } = await f.propose(link, f.carol);
    await run(s => s.decide(id, "DECLINED", f.owner, at(5)));
    expect((await f.propose(link, f.carol)).inserted).toBe(false);
    expect(await run(s => s.listByLink(link, "PENDING"))).toEqual([]);
  });

  it("counts PENDING proposals of one link only", async () => {
    const f = await fixture();
    const link = await f.namedLink();
    expect(await run(s => s.countPending(link))).toBe(0);
    const a = await f.propose(link, f.carol), b = await f.propose(link, f.dave);
    await f.propose(await f.namedLink(), f.carol);
    expect(await run(s => s.countPending(link))).toBe(2);
    await run(s => s.decide(a.id, "APPROVED", f.owner, at(5)));
    await run(s => s.decide(b.id, "DECLINED", f.owner, at(5)));
    expect(await run(s => s.countPending(link))).toBe(0);
  });

  it("lists a link's proposals, optionally by status, oldest first", async () => {
    const f = await fixture();
    const link = await f.namedLink();
    const a = await f.propose(link, f.carol, f.writer, 1), b = await f.propose(link, f.dave, f.writer, 2);
    await run(s => s.decide(a.id, "APPROVED", f.owner, at(5)));
    expect((await run(s => s.listByLink(link))).map(p => p.id)).toEqual([a.id, b.id]);
    expect((await run(s => s.listByLink(link, "PENDING"))).map(p => p.id)).toEqual([b.id]);
    expect((await run(s => s.listByLink(link, "APPROVED"))).map(p => p.id)).toEqual([a.id]);
  });

  it("approvePending flips only the PENDING row of that person", async () => {
    const f = await fixture();
    const link = await f.namedLink();
    const carol = await f.propose(link, f.carol), dave = await f.propose(link, f.dave);
    await run(s => s.decide(dave.id, "DECLINED", f.owner, at(4)));
    await run(s => s.approvePending(link, f.carol, f.owner, at(5)));
    await run(s => s.approvePending(link, f.dave, f.owner, at(6)));
    expect(await run(s => s.findById(carol.id))).toMatchObject({ status: "APPROVED", decidedBy: f.owner, decidedAt: at(5) });
    expect(await run(s => s.findById(dave.id))).toMatchObject({ status: "DECLINED", decidedAt: at(4) });
    await run(s => s.approvePending(link, randomUUID(), f.owner, at(7)));
  });

  it("locks a row by id inside a transaction", async () => {
    const f = await fixture();
    const { id } = await f.propose(await f.namedLink(), f.carol);
    const locked = await uow().run(r => r.shareProposals.lockById(id));
    expect(locked).toMatchObject({ id, status: "PENDING" });
  });

  it("lists for the owner those proposals on links they created, newest first", async () => {
    const f = await fixture();
    const link = await f.namedLink();
    const a = await f.propose(link, f.carol, f.writer, 1), b = await f.propose(link, f.dave, f.writer, 2);
    const other = await fixture();
    await other.propose(await other.namedLink(), other.carol);
    expect((await run(s => s.listForOwner(f.owner, 10))).map(p => p.id)).toEqual([b.id, a.id]);
    expect(await run(s => s.listForOwner(f.owner, 1))).toHaveLength(1);
    expect(await run(s => s.listForOwner(f.writer, 10))).toEqual([]);
  });

  it("lists for the proposed person every status, newest first", async () => {
    const f = await fixture();
    const first = await f.propose(await f.namedLink(), f.carol, f.writer, 1), second = await f.propose(await f.namedLink(), f.carol, f.writer, 2);
    await run(s => s.decide(first.id, "DECLINED", f.owner, at(5)));
    await f.propose(await f.namedLink(), f.dave);
    expect((await run(s => s.listForProposed(f.carol, 10))).map(p => p.id)).toEqual([second.id, first.id]);
    expect(await run(s => s.listForProposed(f.carol, 1))).toHaveLength(1);
  });

  it("lists for the proposer decided rows only", async () => {
    const f = await fixture();
    const link = await f.namedLink();
    const pending = await f.propose(link, f.carol, f.writer, 1), approved = await f.propose(link, f.dave, f.writer, 2);
    await run(s => s.decide(approved.id, "APPROVED", f.owner, at(5)));
    const listed = await run(s => s.listForProposer(f.writer, 10));
    expect(listed.map(p => p.id)).toEqual([approved.id]);
    expect(listed.map(p => p.id)).not.toContain(pending.id);
    expect(await run(s => s.listForProposer(f.owner, 10))).toEqual([]);
  });

  it("markRead sets only the named party's column, once", async () => {
    const f = await fixture();
    const { id } = await f.propose(await f.namedLink(), f.carol);
    await run(s => s.markRead(id, "OWNER", at(10)));
    expect(await run(s => s.findById(id))).toMatchObject({ ownerReadAt: at(10), proposedReadAt: null, proposerReadAt: null });
    await run(s => s.markRead(id, "OWNER", at(20)));
    await run(s => s.markRead(id, "PROPOSED", at(11)));
    await run(s => s.markRead(id, "PROPOSER", at(12)));
    expect(await run(s => s.findById(id))).toMatchObject({ ownerReadAt: at(10), proposedReadAt: at(11), proposerReadAt: at(12) });
  });

  it("markAllRead sets each column where the user is that party, leaves others, and keeps earlier reads", async () => {
    const f = await fixture();
    const link = await f.namedLink();
    const forCarol = await f.propose(link, f.carol, f.writer, 1);
    const forDave = await f.propose(link, f.dave, f.carol, 2);
    await run(s => s.markRead(forCarol.id, "PROPOSED", at(3)));
    await run(s => s.markAllRead(f.carol, at(9)));
    expect(await run(s => s.findById(forCarol.id))).toMatchObject({ ownerReadAt: null, proposedReadAt: at(3), proposerReadAt: null });
    expect(await run(s => s.findById(forDave.id))).toMatchObject({ ownerReadAt: null, proposedReadAt: null, proposerReadAt: at(9) });
    await run(s => s.markAllRead(f.owner, at(10)));
    expect(await run(s => s.findById(forCarol.id))).toMatchObject({ ownerReadAt: at(10), proposedReadAt: at(3), proposerReadAt: null });
    expect(await run(s => s.findById(forDave.id))).toMatchObject({ ownerReadAt: at(10), proposerReadAt: at(9) });
    await run(s => s.markAllRead(f.writer, at(11)));
    expect(await run(s => s.findById(forCarol.id))).toMatchObject({ proposerReadAt: at(11) });
    expect(await run(s => s.findById(forDave.id))).toMatchObject({ proposerReadAt: at(9), proposedReadAt: null });
  });
});
