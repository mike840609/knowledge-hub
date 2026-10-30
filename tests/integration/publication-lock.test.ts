import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HubKnowledgeCommandServiceImpl } from "@/modules/knowledge/application/hub-knowledge-command-service";
import { SourceApplicationService } from "@/modules/sources/application/source-version-guard";
import { CreateFolderImportService } from "@/modules/sources/application/create-folder-import";
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
    const [activeTreeNode] = await fixture.pool.query<{ id: string }[]>(
      "SELECT id FROM knowledge_tree_nodes WHERE document_id = ?",
      [activeDocument.teamDocumentId],
    );
    const folderId = uuidv7();
    await fixture.uow.run((repositories) => repositories.tree.insert({
      id: folderId, sourceId: publication.sourceId, parentId: null, nodeType: "FOLDER",
      name: "locked-folder", documentId: null, position: 2, status: "ACTIVE",
      updatedBy: fixture.mike.identity.id, archivedBy: null, archivedAt: null,
    }));

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

    const after = await snapshot();
    expect(after).toEqual(before);
  });
});
