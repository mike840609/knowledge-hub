import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HubKnowledgeCommandServiceImpl } from "@/modules/knowledge/application/hub-knowledge-command-service";
import { createRevisionInTransaction } from "@/modules/knowledge/application/internal/create-revision";
import { bindSourceProjection } from "@/modules/sources/application/source-knowledge-projection-service";
import { bindPublicationProjection } from "@/modules/sources/application/publication-write-authority";
import { ensureDefaultHubSource } from "@/modules/sources/application/ensure-default-hub-source";
import { SourceApplicationService } from "@/modules/sources/application/source-version-guard";
import { uuidv7 } from "@/shared/ids/uuidv7";
import { createPublicationFixture, type PublicationFixture } from "../fixtures/publications";

let fixture: PublicationFixture;

beforeAll(async () => {
  fixture = await createPublicationFixture();
});
afterAll(async () => {
  await fixture.dispose();
});

type EventRow = {
  id: string;
  document_id: string | null;
  tree_node_id: string | null;
  source_id: string | null;
  kind: string;
  revision_id: string | null;
};

const EVENT_COLUMNS = "id, document_id, tree_node_id, source_id, kind, revision_id";

async function events(where: { documentId?: string; treeNodeId?: string; sourceId?: string } = {}): Promise<EventRow[]> {
  const clauses: string[] = [];
  const values: string[] = [];
  if (where.documentId) { clauses.push("document_id = ?"); values.push(where.documentId); }
  if (where.treeNodeId) { clauses.push("tree_node_id = ?"); values.push(where.treeNodeId); }
  if (where.sourceId) { clauses.push("source_id = ?"); values.push(where.sourceId); }
  return fixture.pool.query<EventRow[]>(
    `SELECT ${EVENT_COLUMNS} FROM publication_events
     ${clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : ""}`,
    values,
  );
}

/** Events written since `before`, compared by id so timestamps that tie at 1ms cannot reorder the result. */
async function addedSince(before: ReadonlySet<string>): Promise<EventRow[]> {
  return (await events()).filter((event) => !before.has(event.id));
}

async function eventIds(): Promise<Set<string>> {
  return new Set((await events()).map((event) => event.id));
}

async function revisionCount(documentId: string): Promise<number> {
  const [row] = await fixture.pool.query<{ total: number }[]>(
    "SELECT COUNT(*) AS total FROM knowledge_revisions WHERE document_id = ?",
    [documentId],
  );
  return Number(row.total);
}

async function sourceEntryOf(documentId: string): Promise<{ id: string; tree_node_id: string; source_path: string }> {
  const [row] = await fixture.pool.query<{ id: string; tree_node_id: string; source_path: string }[]>(
    "SELECT id, tree_node_id, source_path FROM source_entries WHERE document_id = ?",
    [documentId],
  );
  return row;
}

describe("publication events for personal originals", () => {
  it("rolls back the event with the revision it describes", async () => {
    const original = await fixture.createHubOriginal(fixture.mike, "Rollback", "first body");
    const beforeIds = await eventIds();
    const beforeRevisions = await revisionCount(original.documentId);
    const created = await events({ documentId: original.documentId });
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ kind: "REVISION", revision_id: original.revisionId });

    await expect(
      fixture.uow.run(async (repositories) => {
        await createRevisionInTransaction(repositories, fixture.mike, {
          documentId: original.documentId,
          expectedCurrentRevisionId: original.revisionId,
          title: "Rollback v2",
          markdown: "second body",
          metadata: {},
        });
        throw new Error("rollback");
      }),
    ).rejects.toThrow();

    expect(await revisionCount(original.documentId)).toBe(beforeRevisions);
    expect(await addedSince(beforeIds)).toEqual([]);
  });

  it("records no new revision event when the save changes nothing", async () => {
    const original = await fixture.createHubOriginal(fixture.mike, "Steady", "steady body");
    const before = await events({ documentId: original.documentId });
    expect(before).toHaveLength(1);

    const hub = new HubKnowledgeCommandServiceImpl(fixture.uow);
    const result = await hub.createRevision(fixture.mike, {
      documentId: original.documentId,
      expectedCurrentRevisionId: original.revisionId,
      title: "Steady",
      markdown: "steady body",
      metadata: {},
    });

    expect(result.changed).toBe(false);
    expect(await events({ documentId: original.documentId })).toEqual(before);
  });

  it("records one revision event per document in a bulk apply", async () => {
    const folder = await fixture.createFolder(fixture.mike, "repo/bulk", "bulk");
    const created = await fixture.uow.run(async (repositories) => {
      const projection = bindSourceProjection(repositories, {
        id: fixture.mikeFolderSourceId,
        workspaceId: fixture.mikePersonalWorkspaceId,
      });
      return projection.projectDocuments(fixture.mike, [0, 1, 2].map((index) => ({
        sourceId: fixture.mikeFolderSourceId,
        parentId: folder.treeNodeId,
        title: `Bulk ${index}`,
        markdown: `bulk body ${index}`,
        metadata: {},
        mapping: { sourceEntryId: uuidv7(), externalId: null, sourcePath: `repo/bulk/${index}.md` },
      })));
    });
    expect(created).toHaveLength(3);

    const revisionIds = created.map((document) => document.revisionId);
    const rows = await fixture.pool.query<EventRow[]>(
      `SELECT ${EVENT_COLUMNS} FROM publication_events WHERE revision_id IN (${revisionIds.map(() => "?").join(", ")})`,
      revisionIds,
    );
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((row) => row.revision_id)).size).toBe(3);
    expect(rows.map((row) => row.kind)).toEqual(["REVISION", "REVISION", "REVISION"]);
    expect(new Set(rows.map((row) => row.document_id))).toEqual(new Set(created.map((document) => document.documentId)));
  });

  it("round-trips a bulk event list across more than one insert statement", async () => {
    const original = await fixture.createHubOriginal(fixture.mike, "Bulk events", "bulk event body");
    const count = 601;
    await fixture.uow.run((repositories) => repositories.publicationEvents.recordMany(
      Array.from({ length: count }, () => ({
        documentId: original.documentId, treeNodeId: null, sourceId: null,
        kind: "REVISION" as const, revisionId: original.revisionId, at: new Date(),
      })),
    ));

    const [row] = await fixture.pool.query<{ total: number; unconsumed: number }[]>(
      `SELECT COUNT(*) AS total, SUM(consumed_at IS NULL) AS unconsumed
       FROM publication_events WHERE document_id = ?`,
      [original.documentId],
    );
    expect(Number(row.total)).toBe(count + 1);
    expect(Number(row.unconsumed)).toBe(count + 1);
  });

  it("records a path-only sync rename without inventing a revision", async () => {
    const folder = await fixture.createFolder(fixture.mike, "repo/rename", "rename");
    const original = await fixture.createSyncedOriginal(fixture.mike, {
      parentId: folder.treeNodeId,
      sourcePath: "repo/rename/a.md",
      title: "Renamed",
      markdown: "rename body",
    });
    const entry = await sourceEntryOf(original.documentId);
    const beforeIds = await eventIds();
    const beforeRevisions = await revisionCount(original.documentId);

    const sources = new SourceApplicationService(fixture.uow);
    const result = await sources.applyKnownEntry(fixture.mike, {
      sourceId: fixture.mikeFolderSourceId,
      basedOnVersion: 0,
      entryId: entry.id,
      documentId: original.documentId,
      externalId: null,
      sourcePath: "repo/rename/renamed.md",
      content: { title: "Renamed", markdown: "rename body", metadata: {} },
    });

    expect(result.changed).toBe(false);
    expect(await revisionCount(original.documentId)).toBe(beforeRevisions);
    const added = await addedSince(beforeIds);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      kind: "TREE",
      tree_node_id: entry.tree_node_id,
      document_id: null,
      revision_id: null,
    });
    const [stored] = await fixture.pool.query<{ source_path: string }[]>(
      "SELECT source_path FROM source_entries WHERE id = ?",
      [entry.id],
    );
    expect(stored.source_path).toBe("repo/rename/renamed.md");
  });

  it("records a folder move, rename and lifecycle as the folder's own target", async () => {
    const hub = new HubKnowledgeCommandServiceImpl(fixture.uow);
    const target = await hub.createFolder(fixture.mike, { sourceId: fixture.mikeHubSourceId, parentId: null, name: "target" });
    const moved = await hub.createFolder(fixture.mike, { sourceId: fixture.mikeHubSourceId, parentId: null, name: "moved" });
    const child = await hub.createDocument(fixture.mike, {
      sourceId: fixture.mikeHubSourceId,
      parentId: moved.treeNodeId,
      title: "Child",
      markdown: "child body",
      metadata: {},
    });

    const beforeMove = await eventIds();
    await hub.moveTreeNode(fixture.mike, { nodeId: moved.treeNodeId, newParentId: target.treeNodeId, newPosition: 0 });
    const movedEvents = await addedSince(beforeMove);
    expect(movedEvents).toHaveLength(1);
    // The consumer expands the target to descendants; no per-descendant event is expected.
    expect(movedEvents[0]).toMatchObject({ kind: "TREE", tree_node_id: moved.treeNodeId, document_id: null });

    const beforeRename = await eventIds();
    await hub.renameFolder(fixture.mike, { nodeId: moved.treeNodeId, name: "renamed" });
    expect((await addedSince(beforeRename)).map((event) => [event.kind, event.tree_node_id])).toEqual([
      ["TREE", moved.treeNodeId],
    ]);

    const empty = await hub.createFolder(fixture.mike, { sourceId: fixture.mikeHubSourceId, parentId: null, name: "empty" });
    const beforeLifecycle = await eventIds();
    await hub.archiveFolder(fixture.mike, empty.treeNodeId);
    await hub.restoreFolder(fixture.mike, empty.treeNodeId);
    const lifecycleEvents = await addedSince(beforeLifecycle);
    expect(lifecycleEvents.map((event) => [event.kind, event.tree_node_id])).toEqual([
      ["LIFECYCLE", empty.treeNodeId],
      ["LIFECYCLE", empty.treeNodeId],
    ]);
    expect(await events({ documentId: child.documentId })).toHaveLength(1);
    expect(await events({ treeNodeId: moved.treeNodeId })).toHaveLength(2);
  });

  it("records a synced folder and document archive from the projection", async () => {
    const folder = await fixture.createFolder(fixture.mike, "repo/sync-lifecycle", "sync-lifecycle");
    const original = await fixture.createSyncedOriginal(fixture.mike, {
      parentId: folder.treeNodeId,
      sourcePath: "repo/sync-lifecycle/a.md",
      title: "Sync lifecycle",
      markdown: "sync lifecycle body",
    });

    const before = await eventIds();
    await fixture.uow.run(async (repositories) => {
      const projection = bindSourceProjection(repositories, {
        id: fixture.mikeFolderSourceId,
        workspaceId: fixture.mikePersonalWorkspaceId,
      });
      await projection.archiveProjectedDocument(fixture.mike, original.documentId);
      await projection.archiveProjectedFolder(fixture.mike, folder.treeNodeId);
    });
    expect((await addedSince(before)).map((event) => [event.kind, event.document_id, event.tree_node_id])).toEqual([
      ["LIFECYCLE", original.documentId, null],
      ["LIFECYCLE", null, folder.treeNodeId],
    ]);
  });

  it("records a whole personal source archive and restore on the source", async () => {
    const sources = new SourceApplicationService(fixture.uow);
    const before = await eventIds();

    await sources.archiveSource(fixture.mike, fixture.mikeFolderSourceId);
    await sources.restoreSource(fixture.mike, fixture.mikeFolderSourceId);

    const added = await addedSince(before);
    expect(added.map((event) => [event.kind, event.source_id, event.document_id, event.tree_node_id])).toEqual([
      ["SOURCE", fixture.mikeFolderSourceId, null, null],
      ["SOURCE", fixture.mikeFolderSourceId, null, null],
    ]);
    const [source] = await fixture.pool.query<{ status: string }[]>(
      "SELECT status FROM knowledge_sources WHERE id = ?",
      [fixture.mikeFolderSourceId],
    );
    expect(source.status).toBe("ACTIVE");
  });

  it("records nothing for team documents or the publication projection", async () => {
    const folder = await fixture.createFolder(fixture.mike, "repo/team", "team");
    const original = await fixture.createSyncedOriginal(fixture.mike, {
      parentId: folder.treeNodeId,
      sourcePath: "repo/team/a.md",
      title: "Team A",
      markdown: "team body",
    });
    const publication = await fixture.createPublication({
      name: "Events Publication",
      kind: "FOLDER",
      creator: fixture.mike,
      origin: { kind: "FOLDER", folderNodeId: folder.treeNodeId },
    });

    // A changed original is a personal write; it records exactly one event.
    const beforePersonalWrite = await eventIds();
    await fixture.uow.run(async (repositories) => {
      const projection = bindSourceProjection(repositories, {
        id: fixture.mikeFolderSourceId,
        workspaceId: fixture.mikePersonalWorkspaceId,
      });
      await projection.projectRevision(fixture.mike, {
        documentId: original.documentId,
        expectedCurrentRevisionId: original.revisionId,
        title: "Team A2",
        markdown: "team body 2",
        metadata: {},
      });
    });
    expect(await addedSince(beforePersonalWrite)).toHaveLength(1);

    const beforeProjection = await eventIds();
    const copied = await fixture.uow.run(async (repositories) => {
      const projection = await bindPublicationProjection(repositories, {
        publicationId: publication.publication.id,
        contributionId: publication.contributionId,
        judge: { kind: "CALLER", caller: fixture.mike },
      });
      const copy = await projection.copy({
        originalDocumentId: original.documentId,
        parentId: null,
        nodeName: "Team A2",
        sourcePath: "a.md",
      });
      await projection.refresh(copy.documentId, original.documentId);
      await projection.place({ teamDocumentId: copy.documentId, parentId: null, nodeName: "Team A2" });
      await projection.setDocumentStatus(copy.documentId, "ARCHIVED");
      await projection.ensureFolder(null, "made-in-team");
      await projection.pruneEmptyFolders();
      return copy;
    });

    expect(await addedSince(beforeProjection)).toEqual([]);
    expect(await events({ documentId: copied.documentId })).toHaveLength(0);
    expect(await events({ treeNodeId: copied.treeNodeId })).toHaveLength(0);
    expect(await events({ sourceId: publication.sourceId })).toHaveLength(0);

    // A Hub document written straight into a Team workspace is a team write too.
    const teamHubSourceId = await ensureDefaultHubSource(fixture.uow, fixture.mike, fixture.teamWorkspaceId);
    const beforeTeamWrite = await eventIds();
    const hub = new HubKnowledgeCommandServiceImpl(fixture.uow);
    const teamDocument = await hub.createDocument(fixture.mike, {
      sourceId: teamHubSourceId,
      parentId: null,
      title: "Team note",
      markdown: "team note body",
      metadata: {},
    });
    expect(await addedSince(beforeTeamWrite)).toEqual([]);
    expect(await events({ documentId: teamDocument.documentId })).toHaveLength(0);

    // A team FOLDER_SYNC source is a team write too, even though it uses the
    // same projection commands a personal sync uses.
    const teamFolderSourceId = uuidv7();
    await fixture.uow.run((repositories) => repositories.sources.insert({
      id: teamFolderSourceId, name: "Team Repo", workspaceId: fixture.teamWorkspaceId,
      sourceType: "FOLDER_SYNC", ownership: "SOURCE_MANAGED", status: "ACTIVE", syncVersion: 0,
      createdBy: fixture.mike.identity.id, updatedBy: fixture.mike.identity.id,
      archivedBy: null, archivedAt: null, createdAt: new Date(), updatedAt: new Date(),
    }));
    const beforeTeamFolderWrite = await eventIds();
    const teamFolderDocument = await fixture.uow.run(async (repositories) => {
      const projection = bindSourceProjection(repositories, {
        id: teamFolderSourceId,
        workspaceId: fixture.teamWorkspaceId,
      });
      const folder = await projection.projectFolder(fixture.mike, {
        sourceId: teamFolderSourceId,
        mapping: { sourceEntryId: uuidv7(), externalId: null, sourcePath: "team/repo" },
        parentId: null,
        name: "Team Repo",
      });
      return projection.projectDocument(fixture.mike, {
        sourceId: teamFolderSourceId,
        parentId: folder.treeNodeId,
        title: "Team sync",
        markdown: "team sync body",
        metadata: {},
        mapping: { sourceEntryId: uuidv7(), externalId: null, sourcePath: "team/repo/a.md" },
      });
    });
    expect(await addedSince(beforeTeamFolderWrite)).toEqual([]);
    expect(await events({ documentId: teamFolderDocument.documentId })).toHaveLength(0);
    expect(await events({ sourceId: teamFolderSourceId })).toHaveLength(0);
  });
});
