import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { HubKnowledgeCommandServiceImpl } from "@/modules/knowledge/application/hub-knowledge-command-service";
import { KnowledgeLinkServiceImpl } from "@/modules/knowledge/application/knowledge-link-service";
import { KnowledgeQueryServiceImpl } from "@/modules/knowledge/application/knowledge-query-service";
import { ApplyFolderImportService } from "@/modules/sources/application/apply-folder-import";
import { CreateFolderImportService, type ImportManifestEntry } from "@/modules/sources/application/create-folder-import";
import { ensureDefaultHubSource } from "@/modules/sources/application/ensure-default-hub-source";
import { FinalizeFolderImportService } from "@/modules/sources/application/finalize-folder-import";
import { UploadFolderImportEntriesService } from "@/modules/sources/application/upload-folder-import-entries";
import { DEFAULT_IMPORT_LIMITS } from "@/modules/sources/domain/import-limits";
import { buildKnowledgeTree, type KnowledgeTreeNode } from "@/lib/knowledge-navigation";
import { createSourceFixture, fixtureCaller } from "../fixtures/knowledge";

const injected = vi.hoisted(() => ({ caller: null as unknown, services: null as unknown }));
vi.mock("@/server/composition", () => ({
  applicationServices: () => ({ ...(injected.services as object), establishTrustedCaller: async () => ({ caller: injected.caller }) }),
}));

import { POST as archiveDocument } from "@/app/api/documents/[documentId]/archive/route";
import { POST as restoreDocument } from "@/app/api/documents/[documentId]/restore/route";
import { POST as archiveFolder } from "@/app/api/tree-nodes/[nodeId]/archive/route";
import { PATCH as patchTreeNode } from "@/app/api/tree-nodes/[nodeId]/route";
import { POST as createDocument } from "@/app/api/workspaces/[workspaceId]/documents/route";
import { POST as createFolder } from "@/app/api/workspaces/[workspaceId]/folders/route";

/**
 * Arranging the Hub's own notes and syncing a folder are two writers to one workspace, and the
 * organize routes (daily-driver spec §7) take a tree node's ID from the URL. What keeps them apart is
 * ownership: the sync's writers demand a SOURCE_MANAGED source, the Hub's a HUB_MANAGED one, and a source
 * is one or the other for life. This holds that from the outside, over real services and a real
 * database, in both directions:
 *
 *  - what the Hub arranges leaves a synced source exactly as it was, row for row;
 *  - what a sync applies leaves the Hub's notes exactly as they were, row for row;
 *  - the Hub's attempts on synced nodes are refused, and leave nothing behind that a later sync trips on;
 *  - and a sync ends in the same place whether or not the Hub was busy in between.
 *
 * The one thing a Hub change may do to synced content is read-time: a link in a synced document that
 * names a Hub document by title stops resolving while that document is archived (links resolve to active
 * documents only). Nothing is written to the synced source for that, which is checked too.
 */

let pool: Pool;
let unitOfWork: MariaDbUnitOfWork;
let hub: HubKnowledgeCommandServiceImpl;
let queries: KnowledgeQueryServiceImpl;
let links: KnowledgeLinkServiceImpl;
const clock = () => new Date("2026-09-12T13:00:00.000Z");

beforeAll(() => {
  pool = createDatabasePool(databaseConfig("test"));
  unitOfWork = new MariaDbUnitOfWork(pool);
  hub = new HubKnowledgeCommandServiceImpl(unitOfWork);
  queries = new KnowledgeQueryServiceImpl(unitOfWork);
  links = new KnowledgeLinkServiceImpl(unitOfWork);
  injected.services = { unitOfWork, hub, queries, links };
});
afterAll(async () => { await pool.end(); });
// A creator may hold only so many READY snapshots, and the files that run before this one leave some
// (the import specs clear them the same way): what is asked here is about the sync, not the quota.
beforeEach(async () => {
  await pool.query("DELETE FROM source_import_snapshot_entries");
  await pool.query("DELETE FROM source_import_snapshots");
});

const caller = fixtureCaller();
const request = (body?: unknown, method = "POST") =>
  new Request("http://hub.test/api", { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { "content-type": "application/json" } });
const inWorkspace = (workspaceId: string) => ({ params: Promise.resolve({ workspaceId }) });
const ofNode = (nodeId: string) => ({ params: Promise.resolve({ nodeId }) });
const ofDocument = (documentId: string) => ({ params: Promise.resolve({ documentId }) });

async function status(response: Response): Promise<{ status: number; code?: string }> {
  if (response.status === 204 || response.status === 200 || response.status === 201) return { status: response.status };
  return { status: response.status, code: ((await response.json()) as { error?: { code?: string } }).error?.code };
}

// ---------------------------------------------------------------- the Hub's side, through the routes

type World = { workspaceId: string; notes: string };

/**
 * A workspace whose Hub notes already have two things at their top level, made before anything is
 * synced. That order matters to what is checked: a node's ID is time-ordered and ties in position are
 * broken by it, so a synced source made *after* these would be renumbered first if a placement ever
 * counted another source's siblings as its own.
 */
async function world(): Promise<World> {
  const fixture = await createSourceFixture(pool);
  injected.caller = caller;
  const notes = await ensureDefaultHubSource(unitOfWork, caller, fixture.workspaceId);
  const w = { workspaceId: fixture.workspaceId, notes };
  await folder(w, "Early folder");
  await note(w, "Early note");
  return w;
}

async function folder(w: World, name: string, parentId?: string): Promise<string> {
  injected.caller = caller;
  const response = await createFolder(request({ name, ...(parentId ? { parentId } : {}) }), inWorkspace(w.workspaceId));
  expect(response.status).toBe(201);
  return ((await response.json()) as { treeNodeId: string }).treeNodeId;
}

async function note(w: World, title: string, parentId?: string, markdown = `Body of ${title}.`): Promise<{ documentId: string; nodeId: string }> {
  injected.caller = caller;
  const response = await createDocument(request({ title, markdown, ...(parentId ? { parentId } : {}) }), inWorkspace(w.workspaceId));
  expect(response.status).toBe(201);
  const { documentId } = (await response.json()) as { documentId: string };
  const node = (await queries.listTree(caller, w.notes, { includeArchived: true })).find((item) => item.type === "document" && item.documentId === documentId);
  return { documentId, nodeId: node!.id };
}

async function patch(nodeId: string, body: unknown) {
  injected.caller = caller;
  return status(await patchTreeNode(request(body, "PATCH"), ofNode(nodeId)));
}

/**
 * A round of the Hub arranging its notes, as a reader would: folders and documents made, a document moved
 * into a folder and one to the front of the top level, a folder renamed and moved inside another, a
 * document archived and brought back, a folder archived. `round` keeps the names of two rounds apart.
 */
async function arrange(w: World, round: number) {
  const projects = await folder(w, `Projects ${round}`);
  const inbox = await folder(w, `Inbox ${round}`);
  const spare = await folder(w, `Spare ${round}`);
  const plan = await note(w, `Plan ${round}`, projects);
  const todo = await note(w, `Todo ${round}`, inbox);
  const loose = await note(w, `Loose ${round}`);
  const first = await note(w, `First ${round}`);
  expect(await patch(loose.nodeId, { parentId: projects })).toEqual({ status: 204 });
  // To the very front of the Hub's own top level, and left there. A placement that counted a synced
  // source's top level as its own siblings would renumber that source's nodes to make room at the front;
  // and it has to stay there, because moving it back to the end would renumber them back and hide it.
  expect(await patch(first.nodeId, { position: 0 })).toEqual({ status: 204 });
  expect(await patch(inbox, { name: `Inbox renamed ${round}` })).toEqual({ status: 204 });
  expect(await patch(projects, { parentId: inbox })).toEqual({ status: 204 });
  injected.caller = caller;
  // Archiving a document answers with how many documents linked to it (200), and the rest with nothing (204).
  expect((await status(await archiveDocument(request(), ofDocument(todo.documentId)))).status).toBe(200);
  expect((await status(await restoreDocument(request(), ofDocument(todo.documentId)))).status).toBe(204);
  expect((await status(await archiveFolder(request(), ofNode(spare)))).status).toBe(204);
  return { projects, inbox, spare, plan, todo, loose, first };
}

// ---------------------------------------------------------------- the sync's side, through the import services

function importServices() {
  return {
    create: new CreateFolderImportService(unitOfWork, { limits: DEFAULT_IMPORT_LIMITS, now: clock }),
    upload: new UploadFolderImportEntriesService(unitOfWork, { limits: DEFAULT_IMPORT_LIMITS, now: clock }),
    finalize: new FinalizeFolderImportService(unitOfWork, { limits: DEFAULT_IMPORT_LIMITS, now: clock }),
    apply: new ApplyFolderImportService(unitOfWork, { now: clock }),
  };
}

type SyncFile = { path: string; text: string };

function manifestOf(files: SyncFile[]) {
  return files.map((file, index) => {
    const bytes = new TextEncoder().encode(file.text);
    return { entry: { uploadKey: `f${index}`, relativePath: file.path, kind: "MARKDOWN", size: bytes.byteLength } as ImportManifestEntry, bytes };
  });
}

async function firstSync(workspaceId: string, files: SyncFile[]): Promise<string> {
  const { create, upload, finalize, apply } = importServices();
  const manifest = manifestOf(files);
  const session = await create.createInitial(caller, { workspaceId, sourceName: "Imported Wiki", rootName: "wiki", manifest: manifest.map((item) => item.entry) });
  await upload.upload(caller, { snapshotId: session.snapshotId, entries: manifest.map((item, index) => ({ uploadKey: `f${index}`, bytes: item.bytes })) });
  await finalize.finalize(caller, session.snapshotId);
  const result = await apply.apply(caller, session.snapshotId);
  if (result.kind !== "APPLIED") throw new Error("expected the first sync to apply");
  return result.sourceId;
}

async function sync(sourceId: string, files: SyncFile[]): Promise<number> {
  const { create, upload, finalize, apply } = importServices();
  const manifest = manifestOf(files);
  const session = await create.createResync(caller, { sourceId, rootName: "wiki", manifest: manifest.map((item) => item.entry) });
  await upload.upload(caller, { snapshotId: session.snapshotId, entries: manifest.map((item, index) => ({ uploadKey: `f${index}`, bytes: item.bytes })) });
  const preview = await finalize.finalize(caller, session.snapshotId);
  expect(preview.hasBlockers).toBe(false);
  const result = await apply.apply(caller, session.snapshotId);
  if (result.kind !== "APPLIED") throw new Error("expected the sync to apply");
  return result.resultVersion;
}

const V1: SyncFile[] = [
  { path: "docs/a.md", text: "# A\n\nSee [[Hub note]] and [[B]].\n" },
  { path: "docs/b.md", text: "# B\n\nbody b\n" },
  { path: "docs/c.md", text: "# C\n\nbody c\n" },
  { path: "guides/g.md", text: "# G\n\nbody g\n" },
];
/** a changed, b gone, d new, c moved to another folder. */
const V2: SyncFile[] = [
  { path: "docs/a.md", text: "# A\n\nSee [[Hub note]] and [[B]]. Changed.\n" },
  { path: "docs/d.md", text: "# D\n\nbody d\n" },
  { path: "guides/deep/c.md", text: "# C\n\nbody c\n" },
  { path: "guides/g.md", text: "# G\n\nbody g\n" },
];
/** b comes back somewhere else, d goes, a changes again. */
const V3: SyncFile[] = [
  { path: "docs/a.md", text: "# A\n\nSee [[Hub note]] and [[B]]. Changed twice.\n" },
  { path: "other/b.md", text: "# B\n\nbody b\n" },
  { path: "guides/deep/c.md", text: "# C\n\nbody c\n" },
  { path: "guides/g.md", text: "# G\n\nbody g\n" },
];

// ---------------------------------------------------------------- reading state back

const plain = (value: unknown) => JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? item.toString() : item));

/**
 * Every row the writers of one source can touch, whole — timestamps and `updated_by` included, so a
 * write that changes nothing a reader could see still shows: the source, its tree, its documents and
 * their revisions and link index, and (for a synced source) its entries and sync runs.
 */
async function stateOf(sourceId: string): Promise<string> {
  const rows = (sql: string) => pool.query(sql, [sourceId]);
  return plain({
    source: await rows("SELECT * FROM knowledge_sources WHERE id = ?"),
    tree: await rows("SELECT * FROM knowledge_tree_nodes WHERE source_id = ? ORDER BY id"),
    documents: await rows("SELECT * FROM knowledge_documents WHERE source_id = ? ORDER BY id"),
    revisions: await rows("SELECT r.* FROM knowledge_revisions r JOIN knowledge_documents d ON d.id = r.document_id WHERE d.source_id = ? ORDER BY r.id"),
    linkIndex: await rows("SELECT l.* FROM knowledge_link_index l JOIN knowledge_documents d ON d.id = l.document_id WHERE d.source_id = ? ORDER BY l.document_id"),
    documentLinks: await rows("SELECT l.* FROM knowledge_document_links l JOIN knowledge_documents d ON d.id = l.document_id WHERE d.source_id = ? ORDER BY l.document_id, l.ordinal"),
    entries: await rows("SELECT * FROM source_entries WHERE source_id = ? ORDER BY id"),
    syncRuns: await rows("SELECT * FROM sync_runs WHERE source_id = ? ORDER BY id"),
  });
}

/** What a reader sees of a source, with no IDs or times: the tree in order, and what each document holds. */
async function shapeOf(sourceId: string) {
  const items = await queries.listTree(caller, sourceId, { includeArchived: true });
  const nested = (nodes: KnowledgeTreeNode[]): unknown[] =>
    nodes.map((node) => [node.item.type, node.item.label, node.item.status, nested(node.children)]);
  const entries = await pool.query<{ source_path: string; entry_type: string; status: string }[]>(
    "SELECT source_path, entry_type, status FROM source_entries WHERE source_id = ? ORDER BY source_path",
    [sourceId],
  );
  const revisions = await pool.query<{ title: string; revisions: bigint }[]>(
    `SELECT cr.title AS title, (SELECT COUNT(*) FROM knowledge_revisions x WHERE x.document_id = d.id) AS revisions
     FROM knowledge_documents d JOIN knowledge_revisions cr ON cr.id = d.current_revision_id
     WHERE d.source_id = ? ORDER BY cr.title`,
    [sourceId],
  );
  const version = (await pool.query<{ sync_version: number }[]>("SELECT sync_version FROM knowledge_sources WHERE id = ?", [sourceId]))[0].sync_version;
  return plain({ tree: nested(buildKnowledgeTree(items)), entries, revisions, version });
}

async function synced(sourceId: string) {
  const items = await queries.listTree(caller, sourceId, { includeArchived: true });
  const find = (label: string) => items.find((item) => item.label === label)!;
  return { find };
}

// ----------------------------------------------------------------------------------------------

describe("the Hub arranging its notes, and a synced source in the same workspace", () => {
  it("leaves the synced source as it was, row for row", async () => {
    const w = await world();
    const sourceId = await firstSync(w.workspaceId, V1);
    const before = await stateOf(sourceId);
    // There is something to compare: the source's tree, documents and entries are in what is read back.
    const rows = JSON.parse(before) as Record<string, unknown[]>;
    expect(rows.tree.length).toBeGreaterThanOrEqual(6);
    expect(rows.documents).toHaveLength(4);
    expect(rows.entries.length).toBeGreaterThanOrEqual(4);

    await arrange(w, 1);
    await arrange(w, 2);

    expect(await stateOf(sourceId)).toBe(before);
  });

  it("still lets a sync apply as it would have, version by version, after the Hub has arranged", async () => {
    const w = await world();
    const sourceId = await firstSync(w.workspaceId, V1);
    await arrange(w, 1);
    expect(await sync(sourceId, V2)).toBe(2);
    await arrange(w, 2);
    expect(await sync(sourceId, V3)).toBe(3);
    const entries = await pool.query<{ source_path: string; status: string }[]>("SELECT source_path, status FROM source_entries WHERE source_id = ? AND entry_type = 'DOCUMENT' ORDER BY source_path", [sourceId]);
    expect(entries.filter((entry) => entry.status === "ACTIVE").map((entry) => entry.source_path)).toEqual(["docs/a.md", "guides/deep/c.md", "guides/g.md", "other/b.md"]);
  });
});

describe("a sync, and the Hub's notes in the same workspace", () => {
  it("leaves the Hub's notes as the Hub arranged them, row for row", async () => {
    const w = await world();
    const sourceId = await firstSync(w.workspaceId, V1);
    await arrange(w, 1);
    const before = await stateOf(w.notes);

    expect(await sync(sourceId, V2)).toBe(2);
    expect(await stateOf(w.notes)).toBe(before);
    expect(await sync(sourceId, V3)).toBe(3);
    expect(await stateOf(w.notes)).toBe(before);
  });
});

describe("the Hub's attempts on synced nodes", () => {
  it("are refused, change nothing, and leave nothing a later sync trips on", async () => {
    const w = await world();
    const sourceId = await firstSync(w.workspaceId, V1);
    const hubNote = (await arrange(w, 1)).plan;
    const before = await stateOf(sourceId);
    const notesBefore = await stateOf(w.notes);
    const { find } = await synced(sourceId);
    const syncedFolder = find("docs");
    const syncedDocument = find("A");
    const syncedDocumentId = syncedDocument.type === "document" ? syncedDocument.documentId : "";

    const refused = { status: 409, code: "SOURCE_MANAGED_READ_ONLY" };
    expect(await patch(syncedFolder.id, { name: "renamed" })).toEqual(refused);
    expect(await patch(syncedFolder.id, { parentId: null })).toEqual(refused);
    expect(await patch(syncedFolder.id, { position: 0 })).toEqual(refused);
    expect(await patch(syncedDocument.id, { parentId: syncedFolder.id, position: 0 })).toEqual(refused);
    expect(await patch(syncedDocument.id, { position: 1 })).toEqual(refused);
    injected.caller = caller;
    expect(await status(await archiveFolder(request(), ofNode(syncedFolder.id)))).toEqual(refused);
    expect(await status(await archiveDocument(request(), ofDocument(syncedDocumentId)))).toEqual(refused);
    expect(await status(await restoreDocument(request(), ofDocument(syncedDocumentId)))).toEqual(refused);
    // Making something in a synced source is refused too, by source or by parent.
    expect(await status(await createFolder(request({ name: "Nope", sourceId }), inWorkspace(w.workspaceId)))).toEqual(refused);
    expect((await status(await createFolder(request({ name: "Nope", parentId: syncedFolder.id }), inWorkspace(w.workspaceId)))).status).toBe(409);
    expect((await status(await createDocument(request({ title: "Nope", markdown: "x", parentId: syncedFolder.id }), inWorkspace(w.workspaceId)))).status).toBe(409);
    // And a Hub node cannot be put into a synced folder either.
    expect((await patch(hubNote.nodeId, { parentId: syncedFolder.id })).status).toBe(409);

    expect(await stateOf(sourceId)).toBe(before);
    expect(await stateOf(w.notes)).toBe(notesBefore);
    // The refusals left no lock, no half-written position; the next sync applies as it would have.
    expect(await sync(sourceId, V2)).toBe(2);
  });
});

describe("a sync's outcome", () => {
  async function sequence(interleaved: boolean) {
    const w = await world();
    const sourceId = await firstSync(w.workspaceId, V1);
    if (interleaved) await arrange(w, 1);
    await sync(sourceId, V2);
    if (interleaved) await arrange(w, 2);
    await sync(sourceId, V3);
    if (interleaved) await arrange(w, 3);
    return shapeOf(sourceId);
  }

  it("is the same whether or not the Hub was busy in between: what the reader sees of the synced source, its entries, revisions and version", async () => {
    const alone = await sequence(false);
    const withHub = await sequence(true);
    expect(withHub).toBe(alone);
    // The comparison is of something: the moves, the return of a file elsewhere and a version 3 are in it.
    expect(alone).toContain("other/b.md");
    expect(alone).toContain('"version":3');
  });
});

describe("the one read-time effect of a Hub change on synced content", () => {
  it("is that a link in a synced document to a Hub document stops resolving while that document is archived, with nothing written to the synced source", async () => {
    const w = await world();
    const sourceId = await firstSync(w.workspaceId, V1);
    const target = await note(w, "Hub note");
    const documentId = (await pool.query<{ document_id: string }[]>("SELECT document_id FROM source_entries WHERE source_id = ? AND source_path = 'docs/a.md'", [sourceId]))[0].document_id;
    const before = await stateOf(sourceId);
    const hubLink = async () => (await links.getDocumentLinks(caller, documentId)).outgoing.find((link) => link.target === "Hub note")?.resolution.status;

    expect(await hubLink()).toBe("RESOLVED");
    injected.caller = caller;
    expect((await status(await archiveDocument(request(), ofDocument(target.documentId)))).status).toBe(200);
    expect(await hubLink()).toBe("UNRESOLVED");
    expect(await stateOf(sourceId)).toBe(before);
    expect((await status(await restoreDocument(request(), ofDocument(target.documentId)))).status).toBe(204);
    expect(await hubLink()).toBe("RESOLVED");
    expect(await stateOf(sourceId)).toBe(before);
  });
});
