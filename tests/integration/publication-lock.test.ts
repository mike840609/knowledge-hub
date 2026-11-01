import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HubKnowledgeCommandServiceImpl } from "@/modules/knowledge/application/hub-knowledge-command-service";
import { KnowledgeQueryServiceImpl } from "@/modules/knowledge/application/knowledge-query-service";
import { restoreRevision } from "@/modules/knowledge/application/restore-revision";
import { SourceApplicationService } from "@/modules/sources/application/source-version-guard";
import { ApplyFolderImportService } from "@/modules/sources/application/apply-folder-import";
import { CreateFolderImportService } from "@/modules/sources/application/create-folder-import";
import { FinalizeFolderImportService } from "@/modules/sources/application/finalize-folder-import";
import { UploadFolderImportEntriesService } from "@/modules/sources/application/upload-folder-import-entries";
import { hashReadyImportSnapshot } from "@/modules/sources/domain/import-integrity";
import { bindSourceProjection } from "@/modules/sources/application/source-knowledge-projection-service";
import { uuidv7 } from "@/shared/ids/uuidv7";
import { createPublicationFixture, type PublicationFixture } from "../fixtures/publications";

let fixture: PublicationFixture;

beforeAll(async () => {
  fixture = await createPublicationFixture();
});
afterAll(async () => {
  await fixture.dispose();
});

describe("publication source is read-only to ordinary writers", () => {
  it("refuses every Hub, lifecycle, projection and import write for EDITOR and ADMIN", async () => {
    const originFolder = await fixture.createFolder(fixture.mike, "repo/locked", "locked");
    const original = await fixture.createSyncedOriginal(fixture.mike, {
      parentId: originFolder.treeNodeId,
      sourcePath: "repo/locked/a.md",
      title: "Locked",
      markdown: "locked",
    });
    const publication = await fixture.createPublication({
      name: "Locked Publication",
      kind: "FOLDER",
      creator: fixture.mike,
      origin: { kind: "FOLDER", folderNodeId: originFolder.treeNodeId },
    });
    const activeDocument = await fixture.createTeamDocument({
      publication,
      creatorContributionId: publication.contributionId,
      originalDocumentId: original.documentId,
      sourcePath: "a.md",
    });
    const archivedDocument = await fixture.createTeamDocument({
      publication,
      creatorContributionId: publication.contributionId,
      originalDocumentId: original.documentId,
      sourcePath: "archived.md",
      status: "ARCHIVED",
    });
    const activeRevisionId = await fixture.revisionIdOf(activeDocument.teamDocumentId);
    const currentRevisionId = uuidv7();
    const now = new Date();
    await fixture.uow.run(async (repositories) => {
      await repositories.revisions.insert({
        id: currentRevisionId, documentId: activeDocument.teamDocumentId, revisionNo: 2,
        title: "Locked R2", markdown: "r2", metadata: {}, contentHash: "d".repeat(64),
        createdBy: fixture.mike.identity.id, createdAt: now,
      });
      await repositories.documents.setCurrentRevision(activeDocument.teamDocumentId, currentRevisionId, fixture.mike.identity.id);
    });
    const [activeTreeNode] = await fixture.pool.query<{ id: string }[]>(
      "SELECT id FROM knowledge_tree_nodes WHERE document_id = ?",
      [activeDocument.teamDocumentId],
    );
    const folderId = uuidv7();
    const archivedFolderId = uuidv7();
    await fixture.uow.run(async (repositories) => {
      await repositories.tree.insert({
        id: folderId, sourceId: publication.sourceId, parentId: null, nodeType: "FOLDER",
        name: "locked-folder", documentId: null, position: 2, status: "ACTIVE",
        updatedBy: fixture.mike.identity.id, archivedBy: null, archivedAt: null,
      });
      await repositories.tree.insert({
        id: archivedFolderId, sourceId: publication.sourceId, parentId: null, nodeType: "FOLDER",
        name: "archived-folder", documentId: null, position: 3, status: "ARCHIVED",
        updatedBy: fixture.mike.identity.id, archivedBy: fixture.mike.identity.id, archivedAt: now,
      });
    });

    async function snapshot() {
      const [documents] = await fixture.pool.query<{ count: number }[]>(
        "SELECT COUNT(*) AS count FROM knowledge_documents WHERE source_id = ?", [publication.sourceId]);
      const [revisions] = await fixture.pool.query<{ count: number }[]>(
        `SELECT COUNT(*) AS count FROM knowledge_revisions r JOIN knowledge_documents d ON d.id = r.document_id WHERE d.source_id = ?`,
        [publication.sourceId]);
      const [nodes] = await fixture.pool.query<{ count: number }[]>(
        "SELECT COUNT(*) AS count FROM knowledge_tree_nodes WHERE source_id = ?", [publication.sourceId]);
      const [source] = await fixture.pool.query<{ name: string; status: string }[]>(
        "SELECT name, status FROM knowledge_sources WHERE id = ?", [publication.sourceId]);
      const [archived] = await fixture.pool.query<{ status: string }[]>(
        "SELECT status FROM knowledge_documents WHERE id = ?", [archivedDocument.teamDocumentId]);
      return {
        documents: Number(documents.count), revisions: Number(revisions.count), nodes: Number(nodes.count),
        source: { name: source.name, status: source.status }, archivedStatus: archived.status,
      };
    }

    const before = await snapshot();
    const hub = new HubKnowledgeCommandServiceImpl(fixture.uow);
    const queries = new KnowledgeQueryServiceImpl(fixture.uow);
    const sources = new SourceApplicationService(fixture.uow);
    const imports = new CreateFolderImportService(fixture.uow);
    const readOnly = { code: "SOURCE_MANAGED_READ_ONLY" };

    for (const actor of [fixture.ann, fixture.mike]) {
      await expect(hub.createDocument(actor, {
        sourceId: publication.sourceId, parentId: null, title: "Nope", markdown: "nope", metadata: {},
      })).rejects.toMatchObject(readOnly);
      await expect(hub.createRevision(actor, {
        documentId: activeDocument.teamDocumentId, expectedCurrentRevisionId: activeRevisionId,
        title: "Nope", markdown: "nope", metadata: {},
      })).rejects.toMatchObject(readOnly);
      await expect(hub.duplicateDocument(actor, activeDocument.teamDocumentId)).rejects.toMatchObject(readOnly);
      await expect(hub.createFolder(actor, {
        sourceId: publication.sourceId, parentId: null, name: "Nope",
      })).rejects.toMatchObject(readOnly);
      await expect(hub.moveTreeNode(actor, {
        nodeId: activeTreeNode.id, newParentId: folderId, newPosition: 0,
      })).rejects.toMatchObject(readOnly);
      await expect(hub.reorderTreeNode(actor, {
        nodeId: activeTreeNode.id, newPosition: 1,
      })).rejects.toMatchObject(readOnly);
      await expect(hub.renameFolder(actor, { nodeId: folderId, name: "Renamed" })).rejects.toMatchObject(readOnly);
      await expect(hub.archiveDocument(actor, activeDocument.teamDocumentId)).rejects.toMatchObject(readOnly);
      await expect(hub.restoreDocument(actor, archivedDocument.teamDocumentId)).rejects.toMatchObject(readOnly);
      await expect(hub.archiveFolder(actor, folderId)).rejects.toMatchObject(readOnly);
      await expect(hub.restoreFolder(actor, archivedFolderId)).rejects.toMatchObject(readOnly);
      await expect(restoreRevision(queries, hub, actor, {
        documentId: activeDocument.teamDocumentId,
        revisionNo: 1,
        expectedCurrentRevisionId: currentRevisionId,
      })).rejects.toMatchObject(readOnly);
      await expect(hub.setDocumentIcon(actor, activeDocument.teamDocumentId, "📄")).rejects.toMatchObject(readOnly);
      await expect(sources.archiveSource(actor, publication.sourceId)).rejects.toMatchObject(readOnly);
      await expect(sources.restoreSource(actor, publication.sourceId)).rejects.toMatchObject(readOnly);
      await expect(sources.renameSource(actor, publication.sourceId, "Renamed Publication")).rejects.toMatchObject(readOnly);
    }

    await expect(fixture.uow.run((repositories) => bindSourceProjection(repositories, {
      id: publication.sourceId, workspaceId: publication.publication.teamWorkspaceId,
    }).projectFolder(fixture.ann, {
      sourceId: publication.sourceId,
      mapping: { sourceEntryId: uuidv7(), externalId: null, sourcePath: "nope" },
      parentId: null,
      name: "Nope",
    }))).rejects.toMatchObject(readOnly);

    await expect(fixture.uow.run((repositories) => bindSourceProjection(repositories, {
      id: publication.sourceId, workspaceId: publication.publication.teamWorkspaceId,
    }, {
      boundPolicy: {
        id: publication.sourceId, workspaceId: publication.publication.teamWorkspaceId, name: "Locked Publication",
        sourceType: "PUBLICATION", ownership: "SOURCE_MANAGED", status: "ACTIVE", syncVersion: 0,
      },
    }).projectFolder(fixture.ann, {
      sourceId: publication.sourceId,
      mapping: { sourceEntryId: uuidv7(), externalId: null, sourcePath: "nope" },
      parentId: null,
      name: "Nope",
    }))).rejects.toMatchObject(readOnly);

    await expect(sources.applyKnownEntry(fixture.ann, {
      sourceId: publication.sourceId, basedOnVersion: 0, entryId: uuidv7(),
      documentId: activeDocument.teamDocumentId, externalId: null, sourcePath: "a.md",
      content: { title: "Nope", markdown: "nope", metadata: {} },
    })).rejects.toMatchObject(readOnly);
    await expect(sources.archiveKnownEntry(fixture.ann, {
      sourceId: publication.sourceId, basedOnVersion: 0, entryId: uuidv7(),
      documentId: activeDocument.teamDocumentId, externalId: null, sourcePath: "a.md",
    })).rejects.toMatchObject(readOnly);

    await expect(imports.createResync(fixture.ann, {
      sourceId: publication.sourceId,
      rootName: "Nope",
      manifest: [{ uploadKey: "k", relativePath: "a.md", kind: "MARKDOWN", size: 1 }],
    })).rejects.toMatchObject({ code: "SOURCE_IMPORT_NOT_ALLOWED" });

    // A real READY snapshot retargeted at the publication source must fail at
    // Apply's existing FOLDER_SYNC gate, before any plan row is written.
    const stagingSourceId = uuidv7();
    await fixture.uow.run((repositories) => repositories.sources.insert({
      id: stagingSourceId, name: "Import staging", workspaceId: publication.publication.teamWorkspaceId,
      sourceType: "FOLDER_SYNC", ownership: "SOURCE_MANAGED", status: "ACTIVE", syncVersion: 0,
      createdBy: fixture.ann.identity.id, updatedBy: fixture.ann.identity.id,
      archivedBy: null, archivedAt: null, createdAt: new Date(), updatedAt: new Date(),
    }));
    const created = await imports.createResync(fixture.ann, {
      sourceId: stagingSourceId,
      rootName: "Nope",
      manifest: [{ uploadKey: "k", relativePath: "a.md", kind: "MARKDOWN", size: 5 }],
    });
    await new UploadFolderImportEntriesService(fixture.uow).upload(fixture.ann, {
      snapshotId: created.snapshotId,
      entries: [{ uploadKey: "k", bytes: new TextEncoder().encode("# Hi\n") }],
    });
    await new FinalizeFolderImportService(fixture.uow).finalize(fixture.ann, created.snapshotId);
    await fixture.pool.query(
      "UPDATE source_import_snapshots SET source_id = ?, based_on_version = ? WHERE id = ?",
      [publication.sourceId, 0, created.snapshotId],
    );
    const snapshotRow = await fixture.uow.run((repositories) => repositories.importSnapshots.findById(created.snapshotId));
    const snapshotEntries = await fixture.uow.run((repositories) => repositories.importSnapshotEntries.listBySnapshotId(created.snapshotId));
    await fixture.pool.query(
      "UPDATE source_import_snapshots SET snapshot_hash = ? WHERE id = ?",
      [hashReadyImportSnapshot(snapshotRow!, snapshotEntries), created.snapshotId],
    );
    await expect(new ApplyFolderImportService(fixture.uow).apply(fixture.ann, created.snapshotId))
      .rejects.toMatchObject({ code: "SOURCE_IMPORT_NOT_ALLOWED" });

    const after = await snapshot();
    expect(after).toEqual(before);
  });
});
