import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { callerFromIdentity, type CallerContext } from "@/modules/identity/domain/caller-context";
import type { UserIdentity } from "@/modules/identity/domain/user-identity";
import { HubKnowledgeCommandServiceImpl } from "@/modules/knowledge/application/hub-knowledge-command-service";
import { KnowledgeLinkServiceImpl } from "@/modules/knowledge/application/knowledge-link-service";
import { KnowledgeQueryServiceImpl } from "@/modules/knowledge/application/knowledge-query-service";
import { ensureDefaultHubSource } from "@/modules/sources/application/ensure-default-hub-source";
import { createTeamWorkspaceInsert } from "@/modules/workspaces/domain/workspace";
import { createDirectMembership } from "@/modules/workspaces/domain/workspace-membership";
import { uuidv7 } from "@/shared/ids/uuidv7";
import { buildKnowledgeTree, reorderStep } from "@/lib/knowledge-navigation";
import { createDocumentForAnySource } from "../fixtures/knowledge";

const injected = vi.hoisted(() => ({ caller: null as unknown, services: null as unknown }));
vi.mock("@/server/composition", () => ({
  applicationServices: () => ({ ...(injected.services as object), establishTrustedCaller: async () => ({ caller: injected.caller }) }),
}));

import { POST as archiveDocument } from "@/app/api/documents/[documentId]/archive/route";
import { POST as restoreDocument } from "@/app/api/documents/[documentId]/restore/route";
import { POST as archiveFolder } from "@/app/api/tree-nodes/[nodeId]/archive/route";
import { PATCH as patchTreeNode } from "@/app/api/tree-nodes/[nodeId]/route";
import { POST as restoreFolder } from "@/app/api/tree-nodes/[nodeId]/restore/route";
import { POST as createDocument } from "@/app/api/workspaces/[workspaceId]/documents/route";
import { POST as createFolder } from "@/app/api/workspaces/[workspaceId]/folders/route";

/**
 * Organizing from the web (daily-driver spec §7.1): folders, rename, archive and restore, and a new
 * document's folder. Each route is called as a handler, over real services and a real database,
 * as the caller a request would have. The service decides what happens; these tests are for the
 * routes handing it the right thing and answering what it says — every authorization axis once:
 * capability (a viewer), ownership (SOURCE_MANAGED), lifecycle (an archived source), and
 * membership (someone who is not in the workspace, who must learn nothing).
 *
 * A viewer is refused with the same 404 as an outsider, not a 403: content writers keep the
 * Phase 1 contract, where a caller without `document.write` gets `WorkspaceAccessDeniedError`
 * (workspace-mutation-guard.ts), and the existing document writes answer the same way. What these
 * tests hold is that the refusal happens and that nothing is written.
 */

let pool: Pool;
let unitOfWork: MariaDbUnitOfWork;
let hub: HubKnowledgeCommandServiceImpl;
let queries: KnowledgeQueryServiceImpl;
let links: KnowledgeLinkServiceImpl;

beforeAll(() => {
  pool = createDatabasePool(databaseConfig("test"));
  unitOfWork = new MariaDbUnitOfWork(pool);
  hub = new HubKnowledgeCommandServiceImpl(unitOfWork);
  queries = new KnowledgeQueryServiceImpl(unitOfWork);
  links = new KnowledgeLinkServiceImpl(unitOfWork);
  injected.services = { unitOfWork, hub, queries, links };
});
afterAll(async () => { await pool.end(); });

function as(caller: CallerContext) { injected.caller = caller; }
const request = (body?: unknown, method = "POST") =>
  new Request("http://hub.test/api", { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { "content-type": "application/json" } });
const inWorkspace = (workspaceId: string) => ({ params: Promise.resolve({ workspaceId }) });
const ofNode = (nodeId: string) => ({ params: Promise.resolve({ nodeId }) });
const ofDocument = (documentId: string) => ({ params: Promise.resolve({ documentId }) });

async function expectError(response: Response, status: number, code: string) {
  const body = await response.json();
  expect({ status: response.status, code: body.error?.code }).toEqual({ status, code });
  expect(response.headers.get("cache-control")).toBe("private, no-store");
}

function identity(label: string): UserIdentity {
  const id = uuidv7();
  return { id, emp_id: `ORG-${label}-${id}`, name: `Organize ${label}`, org_code: "ORG" };
}

type World = {
  workspaceId: string;
  owner: CallerContext;
  viewer: CallerContext;
  outsider: CallerContext;
  /** The workspace's own Hub source, "Notes". */
  notes: string;
};

/** A Team workspace with an owner and a viewer, and an outsider who is in no workspace at all. */
async function world(): Promise<World> {
  const [owner, viewer, outsider] = [identity("owner"), identity("viewer"), identity("outsider")];
  const workspaceId = uuidv7();
  const now = new Date();
  await unitOfWork.run(async (repositories) => {
    for (const person of [owner, viewer, outsider]) await repositories.users.upsertIdentity(person);
    await repositories.workspaces.insert(createTeamWorkspaceInsert({ id: workspaceId, name: `Organize ${workspaceId}`, createdBy: owner.id, now }));
    await repositories.workspaceMemberships.insert(createDirectMembership({ workspaceId, userId: owner.id, role: "OWNER", createdBy: owner.id, now }));
    await repositories.workspaceMemberships.insert(createDirectMembership({ workspaceId, userId: viewer.id, role: "VIEWER", createdBy: owner.id, now }));
  });
  const ownerCaller = callerFromIdentity(owner);
  const notes = await ensureDefaultHubSource(unitOfWork, ownerCaller, workspaceId);
  return { workspaceId, owner: ownerCaller, viewer: callerFromIdentity(viewer), outsider: callerFromIdentity(outsider), notes };
}

/** Another source in the workspace, with a folder and a document in it, written straight to the tables: the routes cannot make these. */
async function addSource(w: World, options: { managed?: boolean; archived?: boolean } = {}) {
  const sourceId = uuidv7();
  const folderId = uuidv7();
  const now = new Date();
  const person = w.owner.identity.id;
  await unitOfWork.run(async (repositories) => {
    await repositories.sources.insert({
      id: sourceId, name: `Extra ${sourceId}`, workspaceId: w.workspaceId,
      sourceType: options.managed ? "FOLDER_SYNC" : "HUB", ownership: options.managed ? "SOURCE_MANAGED" : "HUB_MANAGED",
      status: "ACTIVE", syncVersion: 0, createdBy: person, updatedBy: person, archivedBy: null, archivedAt: null, createdAt: now, updatedAt: now,
    });
    await repositories.tree.insert({ id: folderId, sourceId, parentId: null, nodeType: "FOLDER", name: "Existing folder", documentId: null, position: 0, status: "ACTIVE", updatedBy: person, archivedBy: null, archivedAt: null });
  });
  const { documentId } = await createDocumentForAnySource(pool, sourceId, folderId, w.owner.identity);
  if (options.archived) {
    await pool.query("UPDATE knowledge_sources SET status = 'ARCHIVED', archived_by = ?, archived_at = NOW(6) WHERE id = ?", [person, sourceId]);
  }
  return { sourceId, folderId, documentId };
}

async function tree(w: World, sourceId: string) {
  return queries.listTree(w.owner, sourceId, { includeArchived: true });
}
async function folderNamed(w: World, sourceId: string, label: string) {
  const found = (await tree(w, sourceId)).find((item) => item.type === "folder" && item.label === label);
  if (!found) throw new Error(`No folder "${label}" in the tree.`);
  return found;
}

async function makeFolder(w: World, name: string, extra: { parentId?: string } = {}) {
  as(w.owner);
  const response = await createFolder(request({ name, ...extra }), inWorkspace(w.workspaceId));
  expect(response.status).toBe(201);
  return (await response.json()) as { treeNodeId: string; sourceId: string };
}

async function makeDocument(w: World, title: string, markdown = "body", parentId?: string) {
  as(w.owner);
  const response = await createDocument(request({ title, markdown, ...(parentId ? { parentId } : {}) }), inWorkspace(w.workspaceId));
  expect(response.status).toBe(201);
  return (await response.json()) as { documentId: string; sourceId: string };
}

describe("creating a folder", () => {
  it("puts it at the top of the workspace's own Hub source when nothing else is said", async () => {
    const w = await world();
    const created = await makeFolder(w, "  Runbooks  ");
    expect(created.sourceId).toBe(w.notes);
    expect(await tree(w, w.notes)).toMatchObject([{ type: "folder", id: created.treeNodeId, label: "Runbooks", parentId: null, position: 0, status: "ACTIVE" }]);
  });

  it("nests one inside another, and puts each new sibling last", async () => {
    const w = await world();
    const parent = await makeFolder(w, "Parent");
    const first = await makeFolder(w, "First", { parentId: parent.treeNodeId });
    const second = await makeFolder(w, "Second", { parentId: parent.treeNodeId });
    const items = await tree(w, w.notes);
    expect(items.filter((item) => item.parentId === parent.treeNodeId).sort((a, b) => a.position - b.position).map((item) => item.id)).toEqual([first.treeNodeId, second.treeNodeId]);
  });

  it("takes a source named in the body, when it is this workspace's", async () => {
    const w = await world();
    const other = await addSource(w);
    as(w.owner);
    const response = await createFolder(request({ name: "In the other", sourceId: other.sourceId }), inWorkspace(w.workspaceId));
    expect(response.status).toBe(201);
    expect((await response.json()).sourceId).toBe(other.sourceId);
  });

  it("does not take a source that is in another workspace the caller also belongs to: the path names the workspace", async () => {
    const mine = await world();
    const theirs = await world();
    await unitOfWork.run((repositories) =>
      repositories.workspaceMemberships.insert(createDirectMembership({ workspaceId: theirs.workspaceId, userId: mine.owner.identity.id, role: "OWNER", createdBy: mine.owner.identity.id, now: new Date() })),
    );
    // The caller may write in both. The service would allow it; the route must not, because this URL is `mine`.
    as(mine.owner);
    await expectError(await createFolder(request({ name: "Misfiled", sourceId: theirs.notes }), inWorkspace(mine.workspaceId)), 404, "NOT_FOUND");
    expect(await tree(theirs, theirs.notes)).toEqual([]);
    // And the same request against the right workspace is fine.
    expect((await createFolder(request({ name: "Filed", sourceId: theirs.notes }), inWorkspace(theirs.workspaceId))).status).toBe(201);
  });

  it("does not take a source that is in a workspace the caller is not in, and says only that it is not found", async () => {
    const mine = await world();
    const theirs = await world();
    as(mine.owner);
    await expectError(await createFolder(request({ name: "Sneaky", sourceId: theirs.notes }), inWorkspace(mine.workspaceId)), 404, "NOT_FOUND");
    // Nothing was written there, by the caller's rights in `mine` or otherwise.
    expect(await tree(theirs, theirs.notes)).toEqual([]);
  });

  it("does not take a parent that is in another source of the workspace", async () => {
    const w = await world();
    const other = await addSource(w);
    as(w.owner);
    await expectError(await createFolder(request({ name: "Astray", parentId: other.folderId }), inWorkspace(w.workspaceId)), 409, "INVALID_PARENT");
  });

  it("does not take a parent that is archived", async () => {
    const w = await world();
    const parent = await makeFolder(w, "Will be archived");
    await hub.archiveFolder(w.owner, parent.treeNodeId);
    as(w.owner);
    await expectError(await createFolder(request({ name: "Child", parentId: parent.treeNodeId }), inWorkspace(w.workspaceId)), 409, "INVALID_PARENT");
  });

  it("answers 404 for a parent that does not exist", async () => {
    const w = await world();
    as(w.owner);
    await expectError(await createFolder(request({ name: "Orphan", parentId: uuidv7() }), inWorkspace(w.workspaceId)), 404, "NOT_FOUND");
  });

  it("refuses SOURCE_MANAGED content", async () => {
    const w = await world();
    const managed = await addSource(w, { managed: true });
    as(w.owner);
    await expectError(await createFolder(request({ name: "Nope", sourceId: managed.sourceId }), inWorkspace(w.workspaceId)), 409, "SOURCE_MANAGED_READ_ONLY");
    expect((await tree(w, managed.sourceId)).filter((item) => item.type === "folder")).toHaveLength(1);
  });

  it("refuses an archived source", async () => {
    const w = await world();
    const archived = await addSource(w, { archived: true });
    as(w.owner);
    await expectError(await createFolder(request({ name: "Nope", sourceId: archived.sourceId }), inWorkspace(w.workspaceId)), 409, "SOURCE_ARCHIVED");
  });

  it("refuses a viewer, and creates nothing", async () => {
    const w = await world();
    as(w.viewer);
    await expectError(await createFolder(request({ name: "Nope" }), inWorkspace(w.workspaceId)), 404, "NOT_FOUND");
    await expectError(await createFolder(request({ name: "Nope", sourceId: w.notes }), inWorkspace(w.workspaceId)), 404, "NOT_FOUND");
    expect(await tree(w, w.notes)).toEqual([]);
  });

  it("tells someone outside the workspace nothing but that it is not found", async () => {
    const w = await world();
    as(w.outsider);
    await expectError(await createFolder(request({ name: "Nope" }), inWorkspace(w.workspaceId)), 404, "NOT_FOUND");
    await expectError(await createFolder(request({ name: "Nope", sourceId: w.notes }), inWorkspace(w.workspaceId)), 404, "NOT_FOUND");
    expect(await tree(w, w.notes)).toEqual([]);
  });

  it.each([
    ["an empty name", { name: "" }, 400, "VALIDATION_ERROR"],
    ["a blank name", { name: "   " }, 400, "VALIDATION_ERROR"],
    ["no name", {}, 400, "INVALID_REQUEST"],
    ["a name that is not text", { name: 5 }, 400, "INVALID_REQUEST"],
    ["a name past the column's length", { name: "x".repeat(513) }, 400, "INVALID_REQUEST"],
    ["a parent that is not an ID", { name: "A", parentId: "not-an-id" }, 400, "INVALID_REQUEST"],
    ["a source that is not an ID", { name: "A", sourceId: "not-an-id" }, 400, "INVALID_REQUEST"],
  ])("answers 400 for %s", async (_what, body, status, code) => {
    const w = await world();
    as(w.owner);
    await expectError(await createFolder(request(body), inWorkspace(w.workspaceId)), status, code);
    expect(await tree(w, w.notes)).toEqual([]);
  });

  it("answers 400 for a workspace ID that is not an ID, before anything is looked up", async () => {
    const w = await world();
    as(w.owner);
    await expectError(await createFolder(request({ name: "A" }), inWorkspace("not-an-id")), 400, "INVALID_REQUEST");
  });

  it("answers 400 for a body that is not JSON, or not an object", async () => {
    const w = await world();
    as(w.owner);
    await expectError(await createFolder(new Request("http://hub.test/api", { method: "POST", body: "{not json" }), inWorkspace(w.workspaceId)), 400, "INVALID_REQUEST");
    await expectError(await createFolder(request([{ name: "A" }]), inWorkspace(w.workspaceId)), 400, "INVALID_REQUEST");
  });

  it("stores the longest name the column holds", async () => {
    const w = await world();
    const name = "x".repeat(512);
    await makeFolder(w, name);
    expect((await tree(w, w.notes))[0].label).toBe(name);
  });
});

describe("renaming a folder", () => {
  it("renames it, and only it", async () => {
    const w = await world();
    const folder = await makeFolder(w, "Before");
    const sibling = await makeFolder(w, "Sibling");
    as(w.owner);
    const response = await patchTreeNode(request({ name: " After " }, "PATCH"), ofNode(folder.treeNodeId));
    expect(response.status).toBe(204);
    const items = await tree(w, w.notes);
    expect(items.find((item) => item.id === folder.treeNodeId)?.label).toBe("After");
    expect(items.find((item) => item.id === sibling.treeNodeId)?.label).toBe("Sibling");
  });

  it("refuses a viewer, and changes nothing", async () => {
    const w = await world();
    const folder = await makeFolder(w, "Before");
    as(w.viewer);
    await expectError(await patchTreeNode(request({ name: "After" }, "PATCH"), ofNode(folder.treeNodeId)), 404, "NOT_FOUND");
    expect((await folderNamed(w, w.notes, "Before")).id).toBe(folder.treeNodeId);
  });

  it("tells someone outside the workspace nothing but that it is not found — the same as for a node that is not there", async () => {
    const w = await world();
    const folder = await makeFolder(w, "Before");
    as(w.outsider);
    const denied = await patchTreeNode(request({ name: "After" }, "PATCH"), ofNode(folder.treeNodeId));
    const missing = await patchTreeNode(request({ name: "After" }, "PATCH"), ofNode(uuidv7()));
    await expectError(denied.clone(), 404, "NOT_FOUND");
    expect(await denied.json()).toEqual(await missing.json());
  });

  it("refuses SOURCE_MANAGED content", async () => {
    const w = await world();
    const managed = await addSource(w, { managed: true });
    as(w.owner);
    await expectError(await patchTreeNode(request({ name: "After" }, "PATCH"), ofNode(managed.folderId)), 409, "SOURCE_MANAGED_READ_ONLY");
    expect((await folderNamed(w, managed.sourceId, "Existing folder")).id).toBe(managed.folderId);
  });

  it("refuses an archived source", async () => {
    const w = await world();
    const archived = await addSource(w, { archived: true });
    as(w.owner);
    await expectError(await patchTreeNode(request({ name: "After" }, "PATCH"), ofNode(archived.folderId)), 409, "SOURCE_ARCHIVED");
  });

  it("refuses an archived folder, and a document's node", async () => {
    const w = await world();
    const folder = await makeFolder(w, "Folder");
    const document = await makeDocument(w, "A document");
    const documentNode = (await tree(w, w.notes)).find((item) => item.type === "document" && item.documentId === document.documentId)!;
    await hub.archiveFolder(w.owner, folder.treeNodeId);
    as(w.owner);
    await expectError(await patchTreeNode(request({ name: "After" }, "PATCH"), ofNode(folder.treeNodeId)), 400, "VALIDATION_ERROR");
    await expectError(await patchTreeNode(request({ name: "After" }, "PATCH"), ofNode(documentNode.id)), 400, "VALIDATION_ERROR");
  });

  it.each([
    ["nothing to change", {}],
    ["a name together with a place", { name: "After", parentId: null }],
    ["a blank name", { name: " " }],
    ["a name past the column's length", { name: "x".repeat(513) }],
  ])("answers 400 for %s", async (_what, body) => {
    const w = await world();
    const folder = await makeFolder(w, "Before");
    as(w.owner);
    const response = await patchTreeNode(request(body, "PATCH"), ofNode(folder.treeNodeId));
    expect(response.status).toBe(400);
    expect((await folderNamed(w, w.notes, "Before")).id).toBe(folder.treeNodeId);
  });

  it("answers 400 for an ID that is not an ID, before anything is looked up", async () => {
    const w = await world();
    as(w.owner);
    await expectError(await patchTreeNode(request({ name: "A" }, "PATCH"), ofNode("not-an-id")), 400, "INVALID_REQUEST");
  });
});

/** The children of one parent in order, with the positions they hold — archived ones included, as the table does. */
async function order(w: World, sourceId: string, parentId: string | null) {
  return (await tree(w, sourceId))
    .filter((item) => item.parentId === parentId)
    .sort((a, b) => a.position - b.position)
    .map((item) => ({ label: item.label, position: item.position }));
}
async function nodeOf(w: World, documentId: string) {
  const found = (await tree(w, w.notes)).find((item) => item.type === "document" && item.documentId === documentId);
  if (!found) throw new Error("No node for that document.");
  return found.id;
}
async function revisionCount(documentId: string) {
  const rows = (await pool.query("SELECT COUNT(*) AS c FROM knowledge_revisions WHERE document_id = ?", [documentId])) as { c: bigint | number }[];
  return Number(rows[0].c);
}

/** Notes with A, B and a folder F at the top (in that order), and a document D already inside F. */
async function arranged() {
  const w = await world();
  const a = await makeDocument(w, "A");
  const b = await makeDocument(w, "B");
  const folder = await makeFolder(w, "F");
  const d = await makeDocument(w, "D", "body", folder.treeNodeId);
  return { w, a, b, d, folder: folder.treeNodeId, bNode: await nodeOf(w, b.documentId) };
}

describe("moving a node", () => {
  it("puts a document last in the folder it is moved into, and closes the gap it left", async () => {
    const { w, b, folder, bNode } = await arranged();
    as(w.owner);
    expect((await patchTreeNode(request({ parentId: folder }, "PATCH"), ofNode(bNode))).status).toBe(204);
    expect(await order(w, w.notes, folder)).toEqual([{ label: "D", position: 0 }, { label: "B", position: 1 }]);
    expect(await order(w, w.notes, null)).toEqual([{ label: "A", position: 0 }, { label: "F", position: 1 }]);
    // Only where it is changed: same document, same revision.
    expect(await revisionCount(b.documentId)).toBe(1);
    expect(await nodeOf(w, b.documentId)).toBe(bNode);
  });

  it("puts it at the place it is given", async () => {
    const { w, folder, bNode } = await arranged();
    as(w.owner);
    expect((await patchTreeNode(request({ parentId: folder, position: 0 }, "PATCH"), ofNode(bNode))).status).toBe(204);
    expect(await order(w, w.notes, folder)).toEqual([{ label: "B", position: 0 }, { label: "D", position: 1 }]);
  });

  it("counts an archived sibling in the place it is given, because the group is every sibling", async () => {
    const { w, d, folder, bNode } = await arranged();
    const extra = await makeDocument(w, "E", "body", folder);
    await hub.archiveDocument(w.owner, extra.documentId);
    // The group is D, E (archived). Index 1 is between them, however many are in view.
    as(w.owner);
    expect((await patchTreeNode(request({ parentId: folder, position: 1 }, "PATCH"), ofNode(bNode))).status).toBe(204);
    expect(await order(w, w.notes, folder)).toEqual([{ label: "D", position: 0 }, { label: "B", position: 1 }, { label: "E", position: 2 }]);
    expect(d.documentId).toBeTruthy();
  });

  it("takes a document back to the top level with a null parent, last", async () => {
    const { w, d, folder } = await arranged();
    as(w.owner);
    expect((await patchTreeNode(request({ parentId: null }, "PATCH"), ofNode(await nodeOf(w, d.documentId)))).status).toBe(204);
    expect(await order(w, w.notes, null)).toEqual([{ label: "A", position: 0 }, { label: "B", position: 1 }, { label: "F", position: 2 }, { label: "D", position: 3 }]);
    expect(await order(w, w.notes, folder)).toEqual([]);
  });

  it("moves a folder with everything in it", async () => {
    const { w, d, folder } = await arranged();
    const other = await makeFolder(w, "G");
    as(w.owner);
    expect((await patchTreeNode(request({ parentId: other.treeNodeId }, "PATCH"), ofNode(folder))).status).toBe(204);
    expect(await order(w, w.notes, other.treeNodeId)).toEqual([{ label: "F", position: 0 }]);
    // D is still in F: nothing under it was touched.
    expect((await tree(w, w.notes)).find((item) => item.type === "document" && item.documentId === d.documentId)?.parentId).toBe(folder);
  });

  it.each([
    ["itself", (n: { folder: string; inner: string }) => n.folder],
    ["a folder it holds", (n: { folder: string; inner: string }) => n.inner],
  ])("refuses to put a folder inside %s", async (_what, destination) => {
    const { w, folder } = await arranged();
    const inner = await makeFolder(w, "Inner", { parentId: folder });
    as(w.owner);
    await expectError(await patchTreeNode(request({ parentId: destination({ folder, inner: inner.treeNodeId }) }, "PATCH"), ofNode(folder)), 409, "TREE_CYCLE");
    expect((await tree(w, w.notes)).find((item) => item.id === folder)?.parentId).toBeNull();
  });

  it("refuses a destination in another source", async () => {
    const { w, bNode } = await arranged();
    const other = await addSource(w);
    as(w.owner);
    await expectError(await patchTreeNode(request({ parentId: other.folderId }, "PATCH"), ofNode(bNode)), 409, "CROSS_SOURCE_MOVE");
    expect((await tree(w, w.notes)).find((item) => item.id === bNode)?.parentId).toBeNull();
  });

  it("refuses a destination that is archived, or is not a folder", async () => {
    const { w, a, folder, bNode } = await arranged();
    const gone = await makeFolder(w, "Gone");
    await hub.archiveFolder(w.owner, gone.treeNodeId);
    as(w.owner);
    await expectError(await patchTreeNode(request({ parentId: gone.treeNodeId }, "PATCH"), ofNode(bNode)), 409, "INVALID_PARENT");
    await expectError(await patchTreeNode(request({ parentId: await nodeOf(w, a.documentId) }, "PATCH"), ofNode(bNode)), 409, "INVALID_PARENT");
    expect(await order(w, w.notes, folder)).toEqual([{ label: "D", position: 0 }]);
  });

  it("answers 404 for a destination that is not there", async () => {
    const { w, bNode } = await arranged();
    as(w.owner);
    await expectError(await patchTreeNode(request({ parentId: uuidv7() }, "PATCH"), ofNode(bNode)), 404, "NOT_FOUND");
  });

  it("refuses an archived node", async () => {
    const { w, b, folder, bNode } = await arranged();
    await hub.archiveDocument(w.owner, b.documentId);
    as(w.owner);
    await expectError(await patchTreeNode(request({ parentId: folder }, "PATCH"), ofNode(bNode)), 400, "VALIDATION_ERROR");
  });

  it("refuses a viewer, and changes nothing", async () => {
    const { w, folder, bNode } = await arranged();
    as(w.viewer);
    await expectError(await patchTreeNode(request({ parentId: folder }, "PATCH"), ofNode(bNode)), 404, "NOT_FOUND");
    expect(await order(w, w.notes, folder)).toEqual([{ label: "D", position: 0 }]);
  });

  it("tells someone outside the workspace nothing but that it is not found — the same as for a node that is not there", async () => {
    const { w, folder, bNode } = await arranged();
    as(w.outsider);
    const denied = await patchTreeNode(request({ parentId: folder }, "PATCH"), ofNode(bNode));
    const missing = await patchTreeNode(request({ parentId: folder }, "PATCH"), ofNode(uuidv7()));
    await expectError(denied.clone(), 404, "NOT_FOUND");
    expect(await denied.json()).toEqual(await missing.json());
  });

  it("refuses SOURCE_MANAGED content, and an archived source", async () => {
    const w = await world();
    const managed = await addSource(w, { managed: true });
    const archived = await addSource(w, { archived: true });
    as(w.owner);
    await expectError(await patchTreeNode(request({ parentId: null }, "PATCH"), ofNode(managed.folderId)), 409, "SOURCE_MANAGED_READ_ONLY");
    await expectError(await patchTreeNode(request({ parentId: null }, "PATCH"), ofNode(archived.folderId)), 409, "SOURCE_ARCHIVED");
  });

  it.each([
    ["a parent that is not an ID", { parentId: "not-an-id" }],
    ["a place below zero", { parentId: null, position: -1 }],
    ["a place that is not a whole number", { parentId: null, position: 1.5 }],
    ["a place that is not a number", { parentId: null, position: "0" }],
  ])("answers 400 for %s", async (_what, body) => {
    const { w, bNode } = await arranged();
    as(w.owner);
    await expectError(await patchTreeNode(request(body, "PATCH"), ofNode(bNode)), 400, "INVALID_REQUEST");
    expect(await order(w, w.notes, null)).toEqual([{ label: "A", position: 0 }, { label: "B", position: 1 }, { label: "F", position: 2 }]);
  });
});

describe("reordering among siblings", () => {
  async function three() {
    const w = await world();
    const docs: Record<string, string> = {};
    for (const title of ["A", "B", "C"]) docs[title] = (await makeDocument(w, title)).documentId;
    return { w, docs, aNode: await nodeOf(w, docs.A), cNode: await nodeOf(w, docs.C) };
  }

  it("puts a node at the place it is given, and renumbers the rest contiguously", async () => {
    const { w, cNode } = await three();
    as(w.owner);
    expect((await patchTreeNode(request({ position: 0 }, "PATCH"), ofNode(cNode))).status).toBe(204);
    expect(await order(w, w.notes, null)).toEqual([{ label: "C", position: 0 }, { label: "A", position: 1 }, { label: "B", position: 2 }]);
  });

  it("puts a place past the end at the end", async () => {
    const { w, aNode } = await three();
    as(w.owner);
    expect((await patchTreeNode(request({ position: 99 }, "PATCH"), ofNode(aNode))).status).toBe(204);
    expect(await order(w, w.notes, null)).toEqual([{ label: "B", position: 0 }, { label: "C", position: 1 }, { label: "A", position: 2 }]);
  });

  it("keeps the node where it is in the tree: only the order changes, and no revision is written", async () => {
    const w = await world();
    const folder = await makeFolder(w, "F");
    const first = await makeDocument(w, "First", "body", folder.treeNodeId);
    await makeDocument(w, "Second", "body", folder.treeNodeId);
    as(w.owner);
    expect((await patchTreeNode(request({ position: 1 }, "PATCH"), ofNode(await nodeOf(w, first.documentId)))).status).toBe(204);
    expect(await order(w, w.notes, folder.treeNodeId)).toEqual([{ label: "Second", position: 0 }, { label: "First", position: 1 }]);
    expect(await revisionCount(first.documentId)).toBe(1);
  });

  it("refuses a viewer, an outsider, SOURCE_MANAGED content, an archived source and an archived node", async () => {
    const { w, docs, cNode } = await three();
    const managed = await addSource(w, { managed: true });
    const archivedSource = await addSource(w, { archived: true });
    await hub.archiveDocument(w.owner, docs.B);
    const bNode = await nodeOf(w, docs.B);
    as(w.viewer);
    await expectError(await patchTreeNode(request({ position: 0 }, "PATCH"), ofNode(cNode)), 404, "NOT_FOUND");
    as(w.outsider);
    await expectError(await patchTreeNode(request({ position: 0 }, "PATCH"), ofNode(cNode)), 404, "NOT_FOUND");
    as(w.owner);
    await expectError(await patchTreeNode(request({ position: 0 }, "PATCH"), ofNode(managed.folderId)), 409, "SOURCE_MANAGED_READ_ONLY");
    await expectError(await patchTreeNode(request({ position: 0 }, "PATCH"), ofNode(archivedSource.folderId)), 409, "SOURCE_ARCHIVED");
    await expectError(await patchTreeNode(request({ position: 0 }, "PATCH"), ofNode(bNode)), 400, "VALIDATION_ERROR");
    expect(await order(w, w.notes, null)).toEqual([{ label: "A", position: 0 }, { label: "B", position: 1 }, { label: "C", position: 2 }]);
  });

  it.each([
    ["a place below zero", { position: -1 }],
    ["a place that is not a whole number", { position: 0.5 }],
    ["a place that is null", { position: null }],
  ])("answers 400 for %s", async (_what, body) => {
    const { w, cNode } = await three();
    as(w.owner);
    await expectError(await patchTreeNode(request(body, "PATCH"), ofNode(cNode)), 400, "INVALID_REQUEST");
  });
});

describe("the step the tree asks for, against the real service", () => {
  it("puts a node on the far side of its neighbour in view, whatever archived siblings are hidden between them", async () => {
    // Six documents; B and E are archived, so the reader sees A, C, D, F — and the server counts all six.
    const w = await world();
    const docs: Record<string, string> = {};
    for (const title of ["A", "B", "C", "D", "E", "F"]) docs[title] = (await makeDocument(w, title)).documentId;
    await hub.archiveDocument(w.owner, docs.B);
    await hub.archiveDocument(w.owner, docs.E);
    const nodes: Record<string, string> = {};
    for (const title of ["A", "C", "D", "F"]) nodes[title] = await nodeOf(w, docs[title]);

    const model = ["A", "C", "D", "F"];
    // Seeded, so a failure is the same failure next time (mulberry32; the low bits of a plain LCG alternate, which would repeat the same few moves).
    let state = 7;
    const random = () => {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const next = (bound: number) => Math.floor(random() * bound);
    let moves = 0;
    as(w.owner);
    for (let round = 0; round < 60; round += 1) {
      const title = model[next(model.length)];
      const direction = next(2) === 0 ? -1 : 1;
      const view = await queries.listTree(w.owner, w.notes);
      const step = reorderStep(buildKnowledgeTree(view), nodes[title], direction);
      const at = model.indexOf(title);
      const other = at + direction;
      if (other < 0 || other >= model.length) {
        expect(step?.kind).toBe("edge");
        continue;
      }
      if (step?.kind !== "move") throw new Error(`Round ${round}: expected a step for ${title}.`);
      [model[at], model[other]] = [model[other], model[at]];
      expect((await patchTreeNode(request({ position: step.position }, "PATCH"), ofNode(nodes[title]))).status).toBe(204);
      expect((await queries.listTree(w.owner, w.notes)).map((item) => item.label)).toEqual(model);
      moves += 1;
    }
    // A run that mostly bounced off the ends would prove little.
    expect(moves).toBeGreaterThan(30);
  });
});

describe("archiving and restoring a folder", () => {
  it("archives an empty folder, and restores it to where it was", async () => {
    const w = await world();
    const first = await makeFolder(w, "First");
    const second = await makeFolder(w, "Second");
    as(w.owner);
    expect((await archiveFolder(request(), ofNode(first.treeNodeId))).status).toBe(204);
    expect((await tree(w, w.notes)).find((item) => item.id === first.treeNodeId)?.status).toBe("ARCHIVED");
    // Not shown unless asked for: the default tree is only what is active.
    expect((await queries.listTree(w.owner, w.notes)).map((item) => item.id)).toEqual([second.treeNodeId]);

    expect((await restoreFolder(request(), ofNode(first.treeNodeId))).status).toBe(204);
    const restored = (await tree(w, w.notes)).find((item) => item.id === first.treeNodeId)!;
    expect(restored).toMatchObject({ status: "ACTIVE", position: 0 });
  });

  it("is idempotent both ways", async () => {
    const w = await world();
    const folder = await makeFolder(w, "Folder");
    as(w.owner);
    expect((await archiveFolder(request(), ofNode(folder.treeNodeId))).status).toBe(204);
    expect((await archiveFolder(request(), ofNode(folder.treeNodeId))).status).toBe(204);
    expect((await restoreFolder(request(), ofNode(folder.treeNodeId))).status).toBe(204);
    expect((await restoreFolder(request(), ofNode(folder.treeNodeId))).status).toBe(204);
  });

  it("refuses to archive a folder that still holds something active, and touches nothing", async () => {
    const w = await world();
    const folder = await makeFolder(w, "Full");
    const child = await makeDocument(w, "Inside", "body", folder.treeNodeId);
    as(w.owner);
    await expectError(await archiveFolder(request(), ofNode(folder.treeNodeId)), 409, "FOLDER_NOT_EMPTY");
    const items = await tree(w, w.notes);
    expect(items.find((item) => item.id === folder.treeNodeId)?.status).toBe("ACTIVE");
    expect(items.find((item) => item.type === "document" && item.documentId === child.documentId)?.status).toBe("ACTIVE");
  });

  it("archives it once what was inside is archived", async () => {
    const w = await world();
    const folder = await makeFolder(w, "Emptied");
    const child = await makeDocument(w, "Inside", "body", folder.treeNodeId);
    as(w.owner);
    expect((await archiveDocument(request(), ofDocument(child.documentId))).status).toBe(200);
    expect((await archiveFolder(request(), ofNode(folder.treeNodeId))).status).toBe(204);
  });

  it("refuses to restore a folder into an archived parent", async () => {
    const w = await world();
    const parent = await makeFolder(w, "Parent");
    const child = await makeFolder(w, "Child", { parentId: parent.treeNodeId });
    as(w.owner);
    await archiveFolder(request(), ofNode(child.treeNodeId));
    await archiveFolder(request(), ofNode(parent.treeNodeId));
    await expectError(await restoreFolder(request(), ofNode(child.treeNodeId)), 409, "INVALID_PARENT");
    expect((await tree(w, w.notes)).find((item) => item.id === child.treeNodeId)?.status).toBe("ARCHIVED");
  });

  it("refuses a viewer", async () => {
    const w = await world();
    const folder = await makeFolder(w, "Folder");
    as(w.viewer);
    await expectError(await archiveFolder(request(), ofNode(folder.treeNodeId)), 404, "NOT_FOUND");
    await hub.archiveFolder(w.owner, folder.treeNodeId);
    await expectError(await restoreFolder(request(), ofNode(folder.treeNodeId)), 404, "NOT_FOUND");
  });

  it("tells someone outside the workspace nothing but that it is not found", async () => {
    const w = await world();
    const folder = await makeFolder(w, "Folder");
    as(w.outsider);
    await expectError(await archiveFolder(request(), ofNode(folder.treeNodeId)), 404, "NOT_FOUND");
    await expectError(await restoreFolder(request(), ofNode(folder.treeNodeId)), 404, "NOT_FOUND");
    expect((await tree(w, w.notes))[0].status).toBe("ACTIVE");
  });

  it("refuses SOURCE_MANAGED content and an archived source", async () => {
    const w = await world();
    const managed = await addSource(w, { managed: true });
    const archived = await addSource(w, { archived: true });
    as(w.owner);
    await expectError(await archiveFolder(request(), ofNode(managed.folderId)), 409, "SOURCE_MANAGED_READ_ONLY");
    await expectError(await restoreFolder(request(), ofNode(managed.folderId)), 409, "SOURCE_MANAGED_READ_ONLY");
    await expectError(await archiveFolder(request(), ofNode(archived.folderId)), 409, "SOURCE_ARCHIVED");
  });

  it("answers 400 for something that is not a folder, and for an ID that is not an ID; 404 for one that is not there", async () => {
    const w = await world();
    const document = await makeDocument(w, "A document");
    const documentNode = (await tree(w, w.notes)).find((item) => item.type === "document" && item.documentId === document.documentId)!;
    as(w.owner);
    await expectError(await archiveFolder(request(), ofNode(documentNode.id)), 400, "VALIDATION_ERROR");
    await expectError(await archiveFolder(request(), ofNode("not-an-id")), 400, "INVALID_REQUEST");
    await expectError(await archiveFolder(request(), ofNode(uuidv7())), 404, "NOT_FOUND");
  });
});

describe("archiving and restoring a document", () => {
  it("archives it and restores it to the same place, with every revision untouched", async () => {
    const w = await world();
    const folder = await makeFolder(w, "Folder");
    const first = await makeDocument(w, "First", "one", folder.treeNodeId);
    const second = await makeDocument(w, "Second", "two", folder.treeNodeId);
    const before = await queries.listRevisions(w.owner, first.documentId);
    const positionOf = async (documentId: string) => (await tree(w, w.notes)).find((item) => item.type === "document" && item.documentId === documentId)!.position;
    const wasAt = await positionOf(first.documentId);

    as(w.owner);
    const archived = await archiveDocument(request(), ofDocument(first.documentId));
    expect(archived.status).toBe(200);
    expect((await queries.getDocument(w.owner, first.documentId, { includeArchived: true })).status).toBe("ARCHIVED");
    expect((await queries.listTree(w.owner, w.notes)).some((item) => item.type === "document" && item.documentId === first.documentId)).toBe(false);
    // Reading it needs asking for archived; the default read does not find it.
    await expect(queries.getDocument(w.owner, first.documentId)).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });

    expect((await restoreDocument(request(), ofDocument(first.documentId))).status).toBe(204);
    expect((await queries.getDocument(w.owner, first.documentId)).status).toBe("ACTIVE");
    expect(await positionOf(first.documentId)).toBe(wasAt);
    expect(await queries.listRevisions(w.owner, first.documentId)).toEqual(before);
    expect((await queries.getDocument(w.owner, second.documentId)).status).toBe("ACTIVE");
  });

  it("is idempotent both ways", async () => {
    const w = await world();
    const document = await makeDocument(w, "Doc");
    as(w.owner);
    expect((await archiveDocument(request(), ofDocument(document.documentId))).status).toBe(200);
    expect((await archiveDocument(request(), ofDocument(document.documentId))).status).toBe(200);
    expect((await restoreDocument(request(), ofDocument(document.documentId))).status).toBe(204);
    expect((await restoreDocument(request(), ofDocument(document.documentId))).status).toBe(204);
  });

  it("says how many documents linked to it, and the links do stop resolving until it is restored", async () => {
    const w = await world();
    const stamp = uuidv7();
    const target = await makeDocument(w, `Target ${stamp}`);
    const a = await makeDocument(w, `Links here A ${stamp}`, `see [[Target ${stamp}]]`);
    const b = await makeDocument(w, `Links here B ${stamp}`, `also [[Target ${stamp}]]`);
    const resolutionOf = async (documentId: string) => {
      const view = await links.getDocumentLinks(w.owner, documentId);
      return view.outgoing.find((link) => link.target === `Target ${stamp}`)?.resolution.status;
    };
    expect(await resolutionOf(a.documentId)).toBe("RESOLVED");

    as(w.owner);
    const response = await archiveDocument(request(), ofDocument(target.documentId));
    expect(await response.json()).toEqual({ backlinks: 2 });
    expect(await resolutionOf(a.documentId)).toBe("UNRESOLVED");
    expect(await resolutionOf(b.documentId)).toBe("UNRESOLVED");

    await restoreDocument(request(), ofDocument(target.documentId));
    expect(await resolutionOf(a.documentId)).toBe("RESOLVED");
    expect(await resolutionOf(b.documentId)).toBe("RESOLVED");
  });

  it("says zero when nothing linked to it", async () => {
    const w = await world();
    const document = await makeDocument(w, "Alone");
    as(w.owner);
    expect(await (await archiveDocument(request(), ofDocument(document.documentId))).json()).toEqual({ backlinks: 0 });
  });

  it("refuses to restore a document whose folder is archived", async () => {
    const w = await world();
    const folder = await makeFolder(w, "Folder");
    const document = await makeDocument(w, "Doc", "body", folder.treeNodeId);
    as(w.owner);
    await archiveDocument(request(), ofDocument(document.documentId));
    await archiveFolder(request(), ofNode(folder.treeNodeId));
    await expectError(await restoreDocument(request(), ofDocument(document.documentId)), 409, "INVALID_PARENT");
    expect((await queries.getDocument(w.owner, document.documentId, { includeArchived: true })).status).toBe("ARCHIVED");
  });

  it("refuses a viewer, and changes nothing", async () => {
    const w = await world();
    const document = await makeDocument(w, "Doc");
    as(w.viewer);
    await expectError(await archiveDocument(request(), ofDocument(document.documentId)), 404, "NOT_FOUND");
    expect((await queries.getDocument(w.owner, document.documentId)).status).toBe("ACTIVE");
    await hub.archiveDocument(w.owner, document.documentId);
    await expectError(await restoreDocument(request(), ofDocument(document.documentId)), 404, "NOT_FOUND");
  });

  it("tells someone outside the workspace nothing — not even how many documents link to it", async () => {
    const w = await world();
    const stamp = uuidv7();
    const target = await makeDocument(w, `Target ${stamp}`);
    await makeDocument(w, `Linker ${stamp}`, `[[Target ${stamp}]]`);
    as(w.outsider);
    const denied = await archiveDocument(request(), ofDocument(target.documentId));
    const missing = await archiveDocument(request(), ofDocument(uuidv7()));
    await expectError(denied.clone(), 404, "NOT_FOUND");
    expect(await denied.json()).toEqual(await missing.json());
    await expectError(await restoreDocument(request(), ofDocument(target.documentId)), 404, "NOT_FOUND");
    expect((await queries.getDocument(w.owner, target.documentId)).status).toBe("ACTIVE");
  });

  it("refuses SOURCE_MANAGED content and an archived source", async () => {
    const w = await world();
    const managed = await addSource(w, { managed: true });
    const archived = await addSource(w, { archived: true });
    as(w.owner);
    await expectError(await archiveDocument(request(), ofDocument(managed.documentId)), 409, "SOURCE_MANAGED_READ_ONLY");
    await expectError(await restoreDocument(request(), ofDocument(managed.documentId)), 409, "SOURCE_MANAGED_READ_ONLY");
    await expectError(await archiveDocument(request(), ofDocument(archived.documentId)), 409, "SOURCE_ARCHIVED");
    expect((await queries.getDocument(w.owner, managed.documentId)).status).toBe("ACTIVE");
  });

  it("answers 400 for an ID that is not an ID, and 404 for one that is not there", async () => {
    const w = await world();
    as(w.owner);
    await expectError(await archiveDocument(request(), ofDocument("not-an-id")), 400, "INVALID_REQUEST");
    await expectError(await restoreDocument(request(), ofDocument("not-an-id")), 400, "INVALID_REQUEST");
    await expectError(await archiveDocument(request(), ofDocument(uuidv7())), 404, "NOT_FOUND");
  });
});

describe("a new document's folder", () => {
  it("goes at the top unless a folder is given, and last in the folder when one is", async () => {
    const w = await world();
    const folder = await makeFolder(w, "Folder");
    const top = await makeDocument(w, "At the top");
    const first = await makeDocument(w, "First inside", "x", folder.treeNodeId);
    const second = await makeDocument(w, "Second inside", "x", folder.treeNodeId);
    const items = await tree(w, w.notes);
    const nodeOf = (documentId: string) => items.find((item) => item.type === "document" && item.documentId === documentId)!;
    expect(nodeOf(top.documentId).parentId).toBeNull();
    expect(nodeOf(first.documentId).parentId).toBe(folder.treeNodeId);
    expect(nodeOf(second.documentId).parentId).toBe(folder.treeNodeId);
    expect(nodeOf(first.documentId).position).toBeLessThan(nodeOf(second.documentId).position);
  });

  it("does not go into an archived folder, or one in another source, and answers 404 for one that is not there", async () => {
    const w = await world();
    const archived = await makeFolder(w, "Archived");
    await hub.archiveFolder(w.owner, archived.treeNodeId);
    const other = await addSource(w);
    as(w.owner);
    await expectError(await createDocument(request({ title: "A", markdown: "x", parentId: archived.treeNodeId }), inWorkspace(w.workspaceId)), 409, "INVALID_PARENT");
    await expectError(await createDocument(request({ title: "A", markdown: "x", parentId: other.folderId }), inWorkspace(w.workspaceId)), 409, "INVALID_PARENT");
    await expectError(await createDocument(request({ title: "A", markdown: "x", parentId: uuidv7() }), inWorkspace(w.workspaceId)), 404, "NOT_FOUND");
  });

  it("answers 400 for a parent that is not an ID, and creates nothing", async () => {
    const w = await world();
    as(w.owner);
    await expectError(await createDocument(request({ title: "A", markdown: "x", parentId: "not-an-id" }), inWorkspace(w.workspaceId)), 400, "INVALID_REQUEST");
    expect((await tree(w, w.notes)).filter((item) => item.type === "document")).toEqual([]);
  });

  it("refuses a viewer", async () => {
    const w = await world();
    const folder = await makeFolder(w, "Folder");
    as(w.viewer);
    await expectError(await createDocument(request({ title: "A", markdown: "x", parentId: folder.treeNodeId }), inWorkspace(w.workspaceId)), 404, "NOT_FOUND");
  });
});
