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
import { ensureDefaultHubSource } from "@/modules/sources/application/ensure-default-hub-source";
import { PersonalWorkspaceService } from "@/modules/workspaces/application/personal-workspace-service";
import { uuidv7 } from "@/shared/ids/uuidv7";

/**
 * Named-recipient share spec, "Inbox": adding someone to a NAMED link puts "<owner> shared <title> with you"
 * in their Inbox, judged on every request; a link that stops opening leaves an entry that names nothing,
 * and removing the recipient deletes it.
 */
let pool: Pool;
beforeAll(() => { pool = createDatabasePool(databaseConfig("test")); });
afterAll(async () => { await pool.end(); });

const unitOfWork = () => new MariaDbUnitOfWork(pool);

async function newUser(name: string): Promise<UserIdentity> {
  const id = uuidv7();
  const identity = { id, emp_id: `NAMED-INBOX-${id}`, name, org_code: "SHARE" };
  const uow = unitOfWork();
  await uow.run((r) => r.users.upsertIdentity(identity));
  await new PersonalWorkspaceService(uow).ensurePersonalWorkspace(id);
  return identity;
}

async function setup() {
  const owner = await newUser("Inbox Owner");
  const uow = unitOfWork();
  const { workspace } = await new PersonalWorkspaceService(uow).ensurePersonalWorkspace(owner.id);
  const caller = callerFromIdentity(owner);
  const sourceId = await ensureDefaultHubSource(uow, caller, workspace.id);
  const hub = new HubKnowledgeCommandServiceImpl(uow);
  const { treeNodeId: folderNodeId } = await hub.createFolder(caller, { sourceId, parentId: null, name: "Reading list" });
  const doc = await hub.createDocument(caller, { sourceId, parentId: folderNodeId, title: "Quarterly plan", markdown: "Body", metadata: {} });
  const alice = await newUser("Alice");
  const bob = await newUser("Bob");
  const shares = new DocumentShareService(uow, new RandomShareTokenIssuer());
  const review = new DocumentReviewService(uow);
  const alicePersonal = await uow.run((r) => r.workspaces.findPersonalByOwnerUserId(alice.id));
  return { owner, caller, folderNodeId, documentId: doc.documentId, alice, bob, aliceCaller: callerFromIdentity(alice), bobCaller: callerFromIdentity(bob), aliceWorkspaceId: alicePersonal!.id, shares, review, hub };
}
type Fixture = Awaited<ReturnType<typeof setup>>;

const shared = (f: Fixture, who: "aliceCaller" | "bobCaller" = "aliceCaller") =>
  f.review.listUnreadForOwner(f[who]).then((r) => r.notifications.filter((n) => n.kind === "SHARED_WITH_YOU"));
const badge = (f: Fixture, who: "aliceCaller" | "bobCaller" = "aliceCaller") => f.review.countUnreadForOwner(f[who]).then((r) => r.count);

describe("a document shared with a named recipient", () => {
  it("appears unread with the document's title and the owner's name, counted in the badge", async () => {
    const f = await setup();
    const view = await f.shares.create(f.caller, { documentId: f.documentId, recipients: [f.alice.id] });
    const token = view.path.slice(3);
    expect(await shared(f)).toEqual([expect.objectContaining({
      id: `shared:${view.id}`, kind: "SHARED_WITH_YOU", documentTitle: "Quarterly plan", authorName: "Inbox Owner",
      linkAvailable: true, readAt: null, href: `/w/${f.aliceWorkspaceId}/shares/${token}`,
    })]);
    expect(await badge(f)).toBe(1);
    expect(await shared(f, "bobCaller")).toEqual([]);
    expect(await badge(f, "bobCaller")).toBe(0);
    const activity = (await f.review.listActivityForOwner(f.aliceCaller)).notifications.filter((n) => n.kind === "SHARED_WITH_YOU");
    expect(activity).toHaveLength(1);
  });

  it("is read by marking it, and only for the recipient it names", async () => {
    const f = await setup();
    const view = await f.shares.create(f.caller, { documentId: f.documentId, recipients: [f.alice.id, f.bob.id] });
    await f.review.markEventRead(f.aliceCaller, `shared:${view.id}`);
    expect(await shared(f)).toEqual([]);
    expect(await badge(f)).toBe(0);
    const activity = (await f.review.listActivityForOwner(f.aliceCaller)).notifications.filter((n) => n.kind === "SHARED_WITH_YOU");
    expect(activity).toEqual([expect.objectContaining({ linkAvailable: true, readAt: expect.any(Date) })]);
    // Bob's is still unread; a stranger marking the id changes nothing, and a malformed id is no error.
    expect(await badge(f, "bobCaller")).toBe(1);
    await f.review.markEventRead(f.bobCaller, `shared:${uuidv7()}`);
    await f.review.markEventRead(f.bobCaller, "shared:not-a-uuid");
    await f.review.markEventRead(f.caller, `shared:${view.id}`);
    expect(await badge(f, "bobCaller")).toBe(1);
  });

  it("marks everything read with mark-all", async () => {
    const f = await setup();
    await f.shares.create(f.caller, { documentId: f.documentId, recipients: [f.alice.id] });
    await f.review.markAllActivityRead(f.aliceCaller);
    expect(await badge(f)).toBe(0);
  });

  it("names nothing and counts nothing once the link is revoked", async () => {
    const f = await setup();
    const view = await f.shares.create(f.caller, { documentId: f.documentId, recipients: [f.alice.id] });
    await f.shares.revoke(f.caller, view.id);
    expect(await shared(f)).toEqual([]);
    expect(await badge(f)).toBe(0);
    const activity = (await f.review.listActivityForOwner(f.aliceCaller)).notifications.filter((n) => n.kind === "SHARED_WITH_YOU");
    expect(activity).toEqual([expect.objectContaining({ id: `shared:${view.id}`, linkAvailable: false, documentTitle: "", authorName: undefined })]);
    expect(activity[0].readAt).not.toBeNull();
    expect(activity[0]).not.toHaveProperty("href");
  });

  it("disappears when the recipient is removed, and a re-added one is unread again", async () => {
    const f = await setup();
    const view = await f.shares.create(f.caller, { documentId: f.documentId, recipients: [f.alice.id] });
    await f.review.markEventRead(f.aliceCaller, `shared:${view.id}`);
    await f.shares.removeRecipient(f.caller, view.id, f.alice.id);
    expect((await f.review.listActivityForOwner(f.aliceCaller)).notifications.filter((n) => n.kind === "SHARED_WITH_YOU")).toEqual([]);
    expect(await badge(f)).toBe(0);
    await f.shares.addRecipients(f.caller, view.id, [f.alice.id]);
    expect(await shared(f)).toEqual([expect.objectContaining({ id: `shared:${view.id}`, readAt: null })]);
    expect(await badge(f)).toBe(1);
  });

  it("names nothing once the document is archived", async () => {
    const f = await setup();
    const view = await f.shares.create(f.caller, { documentId: f.documentId, recipients: [f.alice.id] });
    await f.hub.archiveDocument(f.caller, f.documentId);
    expect(await badge(f)).toBe(0);
    const activity = (await f.review.listActivityForOwner(f.aliceCaller)).notifications.filter((n) => n.kind === "SHARED_WITH_YOU");
    expect(activity).toEqual([expect.objectContaining({ id: `shared:${view.id}`, linkAvailable: false, documentTitle: "" })]);
  });
});

describe("a folder shared with a named recipient", () => {
  it("is titled by the folder, links to the share page without a document, and goes dead on revoke", async () => {
    const f = await setup();
    const view = await f.shares.createForFolder(f.caller, { folderNodeId: f.folderNodeId, recipients: [f.alice.id] });
    expect(await shared(f)).toEqual([expect.objectContaining({
      documentTitle: "Reading list", authorName: "Inbox Owner", linkAvailable: true, href: `/w/${f.aliceWorkspaceId}/shares/${view.path.slice(3)}`,
    })]);
    expect(await badge(f)).toBe(1);
    await f.shares.revoke(f.caller, view.id);
    expect(await shared(f)).toEqual([]);
    expect(await badge(f)).toBe(0);
  });
});
