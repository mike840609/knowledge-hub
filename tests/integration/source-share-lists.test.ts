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
import { SourceApplicationService } from "@/modules/sources/application/source-version-guard";
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
  const link = await shares.createForSource(owner.caller, { sourceId: owner.sourceId, label: "Onboarding pack" });
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

describe("Source share lists", () => {
  it("saves the Source title and returns it in My shares", async () => {
    const f = await fixture();
    await f.saved.save(f.reader.caller, f.token);
    const source = await f.uow.run(r => r.sourcePolicy.findById(f.owner.sourceId));
    expect((await f.savedList())[0]).toMatchObject({ kind: "SOURCE", title: source!.name, status: "available", path: f.link.path });
    expect((await f.mine()).find(item => item.id === f.link.id)).toMatchObject({ kind: "SOURCE", title: source!.name, sourceId: f.owner.sourceId, documentId: null, folderNodeId: null, status: "active", sourceName: null });
  });

  it("tracks the current Source name while open and preserves the saved name when revoked", async () => {
    const f = await fixture();
    const sources = new SourceApplicationService(f.uow);
    const source = await f.uow.run(r => r.sourcePolicy.findById(f.owner.sourceId));
    await f.saved.save(f.reader.caller, f.token);
    await sources.renameSource(f.owner.caller, f.owner.sourceId, "Renamed source");
    expect((await f.savedList())[0]).toMatchObject({ title: "Renamed source", status: "available" });
    expect(await f.savedList({ q: source!.name })).toHaveLength(1);
    expect(await f.savedList({ q: "Renamed source" })).toHaveLength(1);
    expect(await f.mine({ q: "Renamed source" })).toHaveLength(1);
    expect(await f.mine({ q: "Onboarding pack" })).toHaveLength(1);
    await f.shares.revoke(f.owner.caller, f.link.id);
    expect((await f.savedList())[0]).toMatchObject({ title: source!.name, status: "unavailable", path: null });
    expect(await f.savedList({ q: "Renamed source" })).toHaveLength(0);
    expect((await f.mine())[0]).toMatchObject({ status: "revoked" });
  });

  it("reflects source archival, restoration and expiry", async () => {
    const f = await fixture();
    const sources = new SourceApplicationService(f.uow);
    await f.saved.save(f.reader.caller, f.token);
    await sources.archiveSource(f.owner.caller, f.owner.sourceId);
    expect((await f.savedList())[0]).toMatchObject({ status: "unavailable" });
    expect((await f.mine())[0]).toMatchObject({ status: "unavailable" });
    await sources.restoreSource(f.owner.caller, f.owner.sourceId);
    expect((await f.mine())[0]).toMatchObject({ status: "active" });
    f.advance(31 * DAY);
    expect((await f.savedList())[0]).toMatchObject({ status: "expired" });
    expect((await f.mine())[0]).toMatchObject({ status: "expired" });
  });

  it("counts comments from different documents against the Source link", async () => {
    const f = await fixture();
    const documentLink = await f.shares.create(f.owner.caller, { documentId: f.welcome.documentId });
    await f.comment(f.welcome, f.token);
    await f.comment(f.faq, f.token);
    await f.comment(f.welcome, documentLink.path.slice("/s/".length));
    expect(await f.review.listUnreadShareCountsForOwner(f.owner.caller)).toEqual(expect.arrayContaining([
      expect.objectContaining({ shareLinkId: f.link.id, unreadCount: 2 }),
      expect.objectContaining({ shareLinkId: null, documentId: f.welcome.documentId, unreadCount: 1 }),
    ]));
  });
});
