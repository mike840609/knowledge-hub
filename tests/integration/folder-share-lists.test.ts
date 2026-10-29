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
import { SavedShareService } from "@/modules/knowledge/application/saved-share-service";
import type { ReviewAnchor } from "@/modules/knowledge/domain/document-review";
import { projectReviewBlocks } from "@/modules/knowledge/domain/review-anchor";
import { ensureDefaultHubSource } from "@/modules/sources/application/ensure-default-hub-source";
import { PersonalWorkspaceService } from "@/modules/workspaces/application/personal-workspace-service";
import { uuidv7 } from "@/shared/ids/uuidv7";

/** Saved shares, My shares and the unread badge for folder links (folder share spec §7, §8). */
let pool: Pool;
beforeAll(() => { pool = createDatabasePool(databaseConfig("test")); });
afterAll(async () => { await pool.end(); });

const MARKDOWN = "A secret passage here.";
const DAY = 24 * 60 * 60 * 1000;

async function personal(name: string, uow: MariaDbUnitOfWork) {
  const id = uuidv7();
  const identity = { id, emp_id: randomUUID(), name, org_code: "FOLDER-LISTS" };
  await uow.run(r => r.users.upsertIdentity(identity));
  const { workspace } = await new PersonalWorkspaceService(uow).ensurePersonalWorkspace(id);
  const caller = callerFromIdentity(identity);
  return { caller, workspaceId: workspace.id, sourceId: await ensureDefaultHubSource(uow, caller, workspace.id) };
}

/**
 * Owner's My Space: Shared/ { Welcome, FAQ }, and Outside at the root.
 * Reader and a stranger each have their own My Space.
 */
async function fixture() {
  const uow = new MariaDbUnitOfWork(pool);
  let now = Date.now();
  const clock = () => new Date(now);
  const advance = (ms: number) => { now += ms; };
  const owner = await personal("Folder Lists Owner", uow), reader = await personal("Folder Lists Reader", uow), stranger = await personal("Folder Lists Stranger", uow);
  const hub = new HubKnowledgeCommandServiceImpl(uow);
  const doc = (parentId: string | null, title: string) => hub.createDocument(owner.caller, { sourceId: owner.sourceId, parentId, title, markdown: MARKDOWN, metadata: {} });
  const { treeNodeId: folderNodeId } = await hub.createFolder(owner.caller, { sourceId: owner.sourceId, parentId: null, name: "Handbook" });
  const welcome = await doc(folderNodeId, "Welcome"), faq = await doc(folderNodeId, "FAQ"), outside = await doc(null, "Outside");
  const shares = new DocumentShareService(uow, new RandomShareTokenIssuer(), clock);
  const saved = new SavedShareService(uow, clock);
  const review = new DocumentReviewService(uow, clock, () => true);
  const link = await shares.createForFolder(owner.caller, { folderNodeId, label: "Onboarding pack" });
  const token = link.path.slice("/s/".length);
  const mine = async (input: { q?: string; status?: string } = { status: "all" }) => (await shares.listManagement(owner.caller, owner.workspaceId, { status: "all", ...input })).items;
  const savedList = async (input: { q?: string; status?: string } = {}) => (await saved.list(reader.caller, reader.workspaceId, input)).items;
  const anchor = (() => {
    const block = projectReviewBlocks(MARKDOWN)[0];
    return { schemaVersion: 1, blockPath: block.path, blockKind: block.kind, startUtf16: 2, endUtf16: 16, exact: "secret passage", prefix: "A ", suffix: " here." } satisfies ReviewAnchor;
  })();
  /** A folder archives only once empty, so its documents go first. */
  const archiveFolder = async () => {
    for (const { documentId } of [welcome, faq]) await hub.archiveDocument(owner.caller, documentId).catch(() => undefined);
    await hub.archiveFolder(owner.caller, folderNodeId);
  };
  const restoreFolder = () => hub.restoreFolder(owner.caller, folderNodeId);
  const comment = async (on: { documentId: string; revisionId: string }, linkToken: string, body = "A question") => {
    const thread = await review.createForLink(reader.caller, { token: linkToken, documentId: linkToken === token ? on.documentId : undefined, expectedRevisionId: on.revisionId, anchor, body, idempotencyKey: randomUUID() });
    advance(1000);
    return thread;
  };
  return { uow, hub, owner, reader, stranger, folderNodeId, welcome, faq, outside, shares, saved, review, link, token, mine, savedList, comment, advance, archiveFolder, restoreFolder };
}

describe("saving a folder link", () => {
  it("saves the folder's name as the title and opens the link while it lives", async () => {
    const f = await fixture();
    await expect(f.saved.save(f.reader.caller, f.token)).resolves.toMatchObject({ saved: true });
    expect(await f.savedList()).toEqual([expect.objectContaining({ kind: "FOLDER", title: "Handbook", sharedByName: "Folder Lists Owner", status: "available", path: f.link.path, updatedAt: null })]);
    expect(await f.savedList({ q: "Handbook" })).toHaveLength(1);
  });

  it("shows the folder's new name while the link opens, and the saved one once it dies", async () => {
    const f = await fixture();
    await f.saved.save(f.reader.caller, f.token);
    await f.hub.renameFolder(f.owner.caller, { nodeId: f.folderNodeId, name: "Renamed handbook" });
    expect((await f.savedList())[0]).toMatchObject({ title: "Renamed handbook", status: "available" });
    expect(await f.savedList({ q: "Renamed" })).toHaveLength(1);
    expect(await f.savedList({ q: "Handbook" })).toHaveLength(1);

    await f.shares.revoke(f.owner.caller, f.link.id);
    await f.hub.renameFolder(f.owner.caller, { nodeId: f.folderNodeId, name: "Private rename" });
    expect(await f.savedList()).toEqual([expect.objectContaining({ kind: "FOLDER", title: "Handbook", status: "unavailable", path: null })]);
    expect(await f.savedList({ q: "Handbook" })).toHaveLength(1);
    expect(await f.savedList({ q: "Private" })).toEqual([]);
    expect(await f.savedList({ q: "Renamed" })).toEqual([]);
  });

  it("turns expired once the link's lifetime passes, and unavailable when the folder is archived", async () => {
    const f = await fixture();
    await f.saved.save(f.reader.caller, f.token);
    await f.archiveFolder();
    expect((await f.savedList())[0]).toMatchObject({ title: "Handbook", status: "unavailable", path: null });
    await f.restoreFolder();
    expect((await f.savedList())[0]).toMatchObject({ status: "available" });
    f.advance(31 * DAY);
    expect((await f.savedList())[0]).toMatchObject({ title: "Handbook", status: "expired", path: null });
  });

  it("refuses a dead folder link like any other", async () => {
    const f = await fixture();
    const refused = { code: "SHARE_LINK_NOT_FOUND" };
    await f.archiveFolder();
    await expect(f.saved.save(f.reader.caller, f.token)).rejects.toMatchObject(refused);
    await f.restoreFolder();
    await f.shares.revoke(f.owner.caller, f.link.id);
    await expect(f.saved.save(f.reader.caller, f.token)).rejects.toMatchObject(refused);
    expect(await f.savedList()).toEqual([]);
  });

  it("keeps a document link's saved row a DOCUMENT with its own title", async () => {
    const f = await fixture();
    const documentLink = await f.shares.create(f.owner.caller, { documentId: f.outside.documentId });
    await f.saved.save(f.reader.caller, documentLink.path.slice("/s/".length));
    expect(await f.savedList()).toEqual([expect.objectContaining({ kind: "DOCUMENT", title: "Outside", status: "available" })]);
  });
});

describe("My shares lists folder links", () => {
  it("lists an active folder link with the folder's name, kind and source", async () => {
    const f = await fixture();
    const documentLink = await f.shares.create(f.owner.caller, { documentId: f.outside.documentId });
    const items = await f.mine();
    expect(items.find(item => item.id === f.link.id)).toMatchObject({ kind: "FOLDER", title: "Handbook", documentId: null, folderNodeId: f.folderNodeId, sourceId: f.owner.sourceId, label: "Onboarding pack", path: f.link.path, status: "active", totalViews: 0 });
    expect(items.find(item => item.id === documentLink.id)).toMatchObject({ kind: "DOCUMENT", title: "Outside", documentId: f.outside.documentId, folderNodeId: null, status: "active" });
  });

  it("counts a folder link's views", async () => {
    const f = await fixture();
    await f.shares.readShared(f.token);
    await f.shares.readShared(f.token, { documentId: f.welcome.documentId });
    expect((await f.mine())[0]).toMatchObject({ id: f.link.id, totalViews: 2 });
  });

  it("follows the bearer rules for revoked, expired and unavailable", async () => {
    const f = await fixture();
    const statuses = async () => (await f.mine({ status: "all" })).filter(item => item.id === f.link.id).map(item => item.status);
    expect(await statuses()).toEqual(["active"]);
    await f.archiveFolder();
    expect(await statuses()).toEqual(["unavailable"]);
    expect(await f.mine({ status: "unavailable" })).toHaveLength(1);
    expect(await f.mine({ status: "active" })).toEqual([]);
    await f.restoreFolder();
    f.advance(31 * DAY);
    expect(await statuses()).toEqual(["expired"]);
    expect(await f.mine({ status: "expired" })).toHaveLength(1);
    await f.shares.revoke(f.owner.caller, f.link.id);
    expect(await statuses()).toEqual(["revoked"]);
    expect(await f.mine({ status: "revoked" })).toHaveLength(1);
  });

  it("finds a folder link by the folder's name and by its label, and not by a stranger", async () => {
    const f = await fixture();
    expect((await f.mine({ q: "Handbook" })).map(item => item.id)).toEqual([f.link.id]);
    expect((await f.mine({ q: "onboarding" })).map(item => item.id)).toEqual([f.link.id]);
    expect(await f.mine({ q: "nothing like it" })).toEqual([]);
    await f.hub.renameFolder(f.owner.caller, { nodeId: f.folderNodeId, name: "Field guide" });
    expect((await f.mine({ q: "Field" })).map(item => item.id)).toEqual([f.link.id]);
    await expect(f.shares.listManagement(f.stranger.caller, f.owner.workspaceId, { status: "all" })).rejects.toBeDefined();
    expect((await f.shares.listManagement(f.stranger.caller, f.stranger.workspaceId, { status: "all" })).items).toEqual([]);
  });
});

describe("the unread badge for a folder link", () => {
  it("gives comments on two documents through one folder link a single row keyed by the link", async () => {
    const f = await fixture();
    const documentLink = await f.shares.create(f.owner.caller, { documentId: f.welcome.documentId });
    await f.comment(f.welcome, f.token, "On the welcome page");
    const latest = await f.comment(f.faq, f.token, "On the FAQ");
    const own = await f.comment(f.welcome, documentLink.path.slice("/s/".length), "Through the document's own link");
    const counts = await f.review.listUnreadShareCountsForOwner(f.owner.caller);
    expect(counts).toHaveLength(2);
    expect(counts).toContainEqual({ shareLinkId: f.link.id, documentId: f.faq.documentId, unreadCount: 2, latestThreadId: latest.id });
    expect(counts).toContainEqual({ shareLinkId: null, documentId: f.welcome.documentId, unreadCount: 1, latestThreadId: own.id });
    expect(await f.review.countUnreadForOwner(f.owner.caller)).toEqual({ count: 3 });
  });

  it("leaves a document link's count exactly as it was", async () => {
    const f = await fixture();
    const documentLink = await f.shares.create(f.owner.caller, { documentId: f.outside.documentId });
    const thread = await f.comment(f.outside, documentLink.path.slice("/s/".length));
    expect(await f.review.listUnreadShareCountsForOwner(f.owner.caller)).toEqual([{ shareLinkId: null, documentId: f.outside.documentId, unreadCount: 1, latestThreadId: thread.id }]);
  });

  it("drops a document's comments from the folder row once the owner has read them", async () => {
    const f = await fixture();
    await f.comment(f.welcome, f.token);
    await f.comment(f.faq, f.token);
    await f.uow.run(r => r.shareCommentEvents.markDocumentRead(f.owner.caller.identity.id, f.faq.documentId, new Date()));
    expect(await f.review.listUnreadShareCountsForOwner(f.owner.caller)).toEqual([expect.objectContaining({ shareLinkId: f.link.id, documentId: f.welcome.documentId, unreadCount: 1 })]);
  });
});
