import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "@/shared/ids/uuidv7";
import { fingerprintRevisionContent } from "@/modules/knowledge/domain/content";
import { bindSourceProjection } from "@/modules/sources/application/source-knowledge-projection-service";
import { bindPublicationProjection } from "@/modules/sources/application/publication-write-authority";
import { createPublicationFixture, type PublicationFixture } from "../fixtures/publications";

let fixture: PublicationFixture;

beforeAll(async () => {
  fixture = await createPublicationFixture();
});
afterAll(async () => {
  await fixture.dispose();
});

async function revisionOf(documentId: string) {
  const rows = await fixture.pool.query<{
    id: string; title: string; markdown: string; metadata: unknown; created_by: string;
  }[]>(
    `SELECT r.id, r.title, r.markdown, r.metadata, r.created_by
     FROM knowledge_documents d JOIN knowledge_revisions r ON r.id = d.current_revision_id
     WHERE d.id = ?`,
    [documentId],
  );
  const row = rows[0];
  return { ...row, metadata: typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata };
}

describe("publication projection", () => {
  it("copy preserves title markdown metadata and replaces link edges", async () => {
    const folder = await fixture.createFolder(fixture.mike, "repo/docs", "docs");
    const original = await fixture.createSyncedOriginal(fixture.mike, {
      parentId: folder.treeNodeId,
      sourcePath: "repo/docs/a.md",
      title: "A",
      markdown: "See [[B]] and [c](c.md).",
      metadata: { owner: "mike" },
    });
    const publication = await fixture.createPublication({
      name: "Projection Docs",
      kind: "FOLDER",
      creator: fixture.mike,
      origin: { kind: "FOLDER", folderNodeId: folder.treeNodeId },
    });

    const copied = await fixture.uow.run(async (repositories) => {
      const projection = await bindPublicationProjection(repositories, {
        publicationId: publication.publication.id,
        contributionId: publication.contributionId,
        judge: { kind: "CALLER", caller: fixture.mike },
      });
      return projection.copy({
        originalDocumentId: original.documentId,
        parentId: null,
        nodeName: "A",
        sourcePath: "a.md",
      });
    });

    const teamRevision = await revisionOf(copied.documentId);
    expect(teamRevision.title).toBe("A");
    expect(teamRevision.markdown).toBe("See [[B]] and [c](c.md).");
    expect(teamRevision.metadata).toEqual({ owner: "mike" });
    expect(teamRevision.created_by).toBe(fixture.mike.identity.id);

    const links = await fixture.pool.query<{ ordinal: number; link_kind: string; target_text: string }[]>(
      "SELECT ordinal, link_kind, target_text FROM knowledge_document_links WHERE document_id = ? ORDER BY ordinal",
      [copied.documentId],
    );
    expect(links.map((link) => [link.link_kind, link.target_text])).toEqual([["WIKI", "B"], ["PATH", "c.md"]]);

    const [teamPath] = await fixture.pool.query<{ source_path: string | null }[]>(
      "SELECT source_path FROM publication_documents WHERE team_document_id = ?",
      [copied.documentId],
    );
    expect(teamPath.source_path).toBe("a.md");
    const [teamDocument] = await fixture.pool.query<{ source_id: string }[]>(
      "SELECT source_id FROM knowledge_documents WHERE id = ?",
      [copied.documentId],
    );
    expect(teamDocument.source_id).toBe(publication.sourceId);
  });

  it("equal hash writes no revision", async () => {
    const folder = await fixture.createFolder(fixture.mike, "repo/equal", "equal");
    const original = await fixture.createSyncedOriginal(fixture.mike, {
      parentId: folder.treeNodeId,
      sourcePath: "repo/equal/a.md",
      title: "Steady",
      markdown: "steady body",
    });
    const publication = await fixture.createPublication({
      name: "Steady Publication",
      kind: "FOLDER",
      creator: fixture.mike,
      origin: { kind: "FOLDER", folderNodeId: folder.treeNodeId },
    });
    const copied = await fixture.uow.run(async (repositories) => {
      const projection = await bindPublicationProjection(repositories, {
        publicationId: publication.publication.id,
        contributionId: publication.contributionId,
        judge: { kind: "CALLER", caller: fixture.mike },
      });
      return projection.copy({
        originalDocumentId: original.documentId,
        parentId: null,
        nodeName: "Steady",
        sourcePath: "a.md",
      });
    });
    const before = await fixture.pool.query("SELECT id FROM knowledge_revisions WHERE document_id = ?", [copied.documentId]);

    const unchanged = await fixture.uow.run(async (repositories) => {
      const projection = await bindPublicationProjection(repositories, {
        publicationId: publication.publication.id,
        contributionId: publication.contributionId,
        judge: { kind: "CALLER", caller: fixture.mike },
      });
      return projection.refresh(copied.documentId, original.documentId);
    });

    expect(unchanged).toEqual({ changed: false });
    const after = await fixture.pool.query("SELECT id FROM knowledge_revisions WHERE document_id = ?", [copied.documentId]);
    expect(after).toHaveLength(before.length);
  });

  it("refreshes a changed original and replaces its link edges", async () => {
    const folder = await fixture.createFolder(fixture.mike, "repo/changed", "changed");
    const original = await fixture.createSyncedOriginal(fixture.mike, {
      parentId: folder.treeNodeId,
      sourcePath: "repo/changed/a.md",
      title: "Changing",
      markdown: "[[Old]]",
    });
    const publication = await fixture.createPublication({
      name: "Changing Publication",
      kind: "FOLDER",
      creator: fixture.mike,
      origin: { kind: "FOLDER", folderNodeId: folder.treeNodeId },
    });
    const copied = await fixture.uow.run(async (repositories) => {
      const projection = await bindPublicationProjection(repositories, {
        publicationId: publication.publication.id,
        contributionId: publication.contributionId,
        judge: { kind: "CALLER", caller: fixture.mike },
      });
      return projection.copy({
        originalDocumentId: original.documentId,
        parentId: null,
        nodeName: "Changing",
        sourcePath: "a.md",
      });
    });

    await fixture.uow.run(async (repositories) => {
      const projection = bindSourceProjection(repositories, {
        id: fixture.mikeFolderSourceId,
        workspaceId: fixture.mikePersonalWorkspaceId,
      });
      await projection.projectRevision(fixture.mike, {
        documentId: original.documentId,
        expectedCurrentRevisionId: original.revisionId,
        title: "Changing v2",
        markdown: "[[New]]",
        metadata: {},
      });
    });

    const refreshed = await fixture.uow.run(async (repositories) => {
      const projection = await bindPublicationProjection(repositories, {
        publicationId: publication.publication.id,
        contributionId: publication.contributionId,
        judge: { kind: "CALLER", caller: fixture.mike },
      });
      return projection.refresh(copied.documentId, original.documentId);
    });

    expect(refreshed).toEqual({ changed: true });
    expect((await revisionOf(copied.documentId)).title).toBe("Changing v2");
    const links = await fixture.pool.query<{ target_text: string }[]>(
      "SELECT target_text FROM knowledge_document_links WHERE document_id = ? ORDER BY ordinal",
      [copied.documentId],
    );
    expect(links.map((link) => link.target_text)).toEqual(["New"]);
    const revisions = await fixture.pool.query("SELECT id FROM knowledge_revisions WHERE document_id = ?", [copied.documentId]);
    expect(revisions).toHaveLength(2);
  });

  it("Hub copy uses NULL path without source_entries row", async () => {
    const hub = await fixture.createHubOriginal(fixture.mike, "Hub note", "Hub body");
    const publication = await fixture.createPublication({
      name: "Hub Publication",
      kind: "DOCUMENT",
      creator: fixture.mike,
      origin: { kind: "DOCUMENT", documentId: hub.documentId },
    });

    const copied = await fixture.uow.run(async (repositories) => {
      const projection = await bindPublicationProjection(repositories, {
        publicationId: publication.publication.id,
        contributionId: publication.contributionId,
        judge: { kind: "CALLER", caller: fixture.mike },
      });
      return projection.copy({
        originalDocumentId: hub.documentId,
        parentId: null,
        nodeName: "Hub note",
        sourcePath: null,
      });
    });

    const [teamPath] = await fixture.pool.query<{ source_path: string | null }[]>(
      "SELECT source_path FROM publication_documents WHERE team_document_id = ?",
      [copied.documentId],
    );
    expect(teamPath.source_path).toBeNull();
    const entries = await fixture.pool.query(
      "SELECT id FROM source_entries WHERE document_id = ? AND source_id = ?",
      [copied.documentId, publication.sourceId],
    );
    expect(entries).toHaveLength(0);
  });

  it("does not let a joiner refresh, move or archive another creator's document", async () => {
    const mikeFolder = await fixture.createFolder(fixture.mike, "repo/owner", "owner");
    const mikeOriginal = await fixture.createSyncedOriginal(fixture.mike, {
      parentId: mikeFolder.treeNodeId,
      sourcePath: "repo/owner/a.md",
      title: "Mike's document",
      markdown: "mike body",
    });
    const publication = await fixture.createPublication({
      name: "Owned Publication",
      kind: "FOLDER",
      creator: fixture.mike,
      origin: { kind: "FOLDER", folderNodeId: mikeFolder.treeNodeId },
    });
    const annFolder = await fixture.createFolder(fixture.ann, "repo/ann", "ann");
    await fixture.addContribution({
      publicationId: publication.publication.id,
      user: fixture.ann,
      origin: { kind: "FOLDER", folderNodeId: annFolder.treeNodeId },
    });

    const copied = await fixture.uow.run(async (repositories) => {
      const projection = await bindPublicationProjection(repositories, {
        publicationId: publication.publication.id,
        contributionId: publication.contributionId,
        judge: { kind: "CALLER", caller: fixture.mike },
      });
      return projection.copy({
        originalDocumentId: mikeOriginal.documentId,
        parentId: null,
        nodeName: "Mike's document",
        sourcePath: "a.md",
      });
    });
    const initialRevision = await revisionOf(copied.documentId);
    expect(initialRevision.created_by).toBe(fixture.mike.identity.id);

    await expect(
      fixture.uow.run(async (repositories) => {
        const projection = await bindPublicationProjection(repositories, {
          publicationId: publication.publication.id,
          contributionId: (await repositories.publications.listContributions(publication.publication.id))
            .find((contribution) => contribution.userId === fixture.ann.identity.id)!.id,
          judge: { kind: "CALLER", caller: fixture.ann },
        });
        return projection.refresh(copied.documentId, mikeOriginal.documentId);
      }),
    ).rejects.toMatchObject({ code: "WORKSPACE_ACCESS_DENIED" });

    await expect(
      fixture.uow.run(async (repositories) => {
        const projection = await bindPublicationProjection(repositories, {
          publicationId: publication.publication.id,
          contributionId: (await repositories.publications.listContributions(publication.publication.id))
            .find((contribution) => contribution.userId === fixture.ann.identity.id)!.id,
          judge: { kind: "CALLER", caller: fixture.ann },
        });
        return projection.place({ teamDocumentId: copied.documentId, parentId: null, nodeName: "Moved" });
      }),
    ).rejects.toMatchObject({ code: "WORKSPACE_ACCESS_DENIED" });

    await expect(
      fixture.uow.run(async (repositories) => {
        const projection = await bindPublicationProjection(repositories, {
          publicationId: publication.publication.id,
          contributionId: (await repositories.publications.listContributions(publication.publication.id))
            .find((contribution) => contribution.userId === fixture.ann.identity.id)!.id,
          judge: { kind: "CALLER", caller: fixture.ann },
        });
        return projection.setDocumentStatus(copied.documentId, "ARCHIVED");
      }),
    ).rejects.toMatchObject({ code: "WORKSPACE_ACCESS_DENIED" });

    const revisions = await fixture.pool.query<{ id: string; created_by: string }[]>(
      "SELECT id, created_by FROM knowledge_revisions WHERE document_id = ?",
      [copied.documentId],
    );
    expect(revisions).toHaveLength(1);
    expect(revisions[0].created_by).toBe(fixture.mike.identity.id);
    const [document] = await fixture.pool.query<{ status: string }[]>(
      "SELECT status FROM knowledge_documents WHERE id = ?",
      [copied.documentId],
    );
    expect(document.status).toBe("ACTIVE");
  });

  it("refuses to bind after the publication source is archived", async () => {
    const folder = await fixture.createFolder(fixture.mike, "repo/archived", "archived");
    const publication = await fixture.createPublication({
      name: "Archived Publication",
      kind: "FOLDER",
      creator: fixture.mike,
      origin: { kind: "FOLDER", folderNodeId: folder.treeNodeId },
    });
    await fixture.uow.run((repositories) =>
      repositories.publications.setPublicationStatus(publication.publication.id, "ARCHIVED", fixture.mike.identity.id));

    await expect(
      fixture.uow.run((repositories) => bindPublicationProjection(repositories, {
        publicationId: publication.publication.id,
        contributionId: publication.contributionId,
        judge: { kind: "CALLER", caller: fixture.mike },
      })),
    ).rejects.toMatchObject({ code: "SOURCE_ARCHIVED" });
  });

  it("stores the normalized content the hash covers, and treats normalized input as unchanged", async () => {
    const folder = await fixture.createFolder(fixture.mike, "repo/normalized", "normalized");
    const rawDocumentId = uuidv7();
    const rawRevisionId = uuidv7();
    const rawNodeId = uuidv7();
    const now = new Date();
    await fixture.uow.run(async (repositories) => {
      await repositories.documents.insertDraft({
        id: rawDocumentId, sourceId: fixture.mikeFolderSourceId, currentRevisionId: null,
        status: "ACTIVE", createdBy: fixture.mike.identity.id, updatedBy: fixture.mike.identity.id,
        archivedBy: null, archivedAt: null, createdAt: now, updatedAt: now,
      });
      await repositories.revisions.insert({
        id: rawRevisionId, documentId: rawDocumentId, revisionNo: 1,
        title: "  Padded  ", markdown: "line1\r\nline2", metadata: {},
        contentHash: "e".repeat(64), createdBy: fixture.mike.identity.id, createdAt: now,
      });
      await repositories.documents.setCurrentRevision(rawDocumentId, rawRevisionId, fixture.mike.identity.id);
      await repositories.tree.insert({
        id: rawNodeId, sourceId: fixture.mikeFolderSourceId, parentId: folder.treeNodeId,
        nodeType: "DOCUMENT", name: null, documentId: rawDocumentId, position: 0, status: "ACTIVE",
        updatedBy: fixture.mike.identity.id, archivedBy: null, archivedAt: null,
      });
    });
    const publication = await fixture.createPublication({
      name: "Normalized Publication",
      kind: "FOLDER",
      creator: fixture.mike,
      origin: { kind: "FOLDER", folderNodeId: folder.treeNodeId },
    });

    const copied = await fixture.uow.run(async (repositories) => {
      const projection = await bindPublicationProjection(repositories, {
        publicationId: publication.publication.id,
        contributionId: publication.contributionId,
        judge: { kind: "CALLER", caller: fixture.mike },
      });
      return projection.copy({
        originalDocumentId: rawDocumentId,
        parentId: null,
        nodeName: "Padded",
        sourcePath: "a.md",
      });
    });
    const stored = await revisionOf(copied.documentId);
    expect(stored.title).toBe("Padded");
    expect(stored.markdown).toBe("line1\nline2");
    const expected = fingerprintRevisionContent({
      title: stored.title, markdown: stored.markdown, metadata: stored.metadata as Record<string, never>,
    });
    const [hashRow] = await fixture.pool.query<{ content_hash: string }[]>(
      "SELECT content_hash FROM knowledge_revisions WHERE id = ?", [stored.id]);
    expect(hashRow.content_hash).toBe(expected.contentHash);

    const unchanged = await fixture.uow.run(async (repositories) => {
      const projection = await bindPublicationProjection(repositories, {
        publicationId: publication.publication.id,
        contributionId: publication.contributionId,
        judge: { kind: "CALLER", caller: fixture.mike },
      });
      return projection.refresh(copied.documentId, rawDocumentId);
    });
    expect(unchanged).toEqual({ changed: false });
    const revisions = await fixture.pool.query("SELECT id FROM knowledge_revisions WHERE document_id = ?", [copied.documentId]);
    expect(revisions).toHaveLength(1);
  });

  it("caller-less copy requires a direct source.manage grant", async () => {
    const directOriginal = await fixture.createHubOriginal(fixture.ann, "Direct original", "body");
    const directPublication = await fixture.createPublication({
      name: "Direct No Caller",
      kind: "DOCUMENT",
      creator: fixture.ann,
      origin: { kind: "DOCUMENT", documentId: directOriginal.documentId },
    });
    await expect(
      fixture.uow.run(async (repositories) => {
        const projection = await bindPublicationProjection(repositories, {
          publicationId: directPublication.publication.id,
          contributionId: directPublication.contributionId,
          judge: { kind: "NO_CALLER" },
        });
        return projection.copy({
          originalDocumentId: directOriginal.documentId,
          parentId: null,
          nodeName: "Direct original",
          sourcePath: null,
        });
      }),
    ).resolves.toBeTruthy();

    const groupOriginal = await fixture.createHubOriginal(fixture.ann, "Group original", "body");
    const groupPublication = await fixture.createPublication({
      teamWorkspaceId: fixture.groupTeamWorkspaceId,
      name: "Group No Caller",
      kind: "DOCUMENT",
      creator: fixture.ann,
      origin: { kind: "DOCUMENT", documentId: groupOriginal.documentId },
    });
    await expect(
      fixture.uow.run(async (repositories) => {
        const projection = await bindPublicationProjection(repositories, {
          publicationId: groupPublication.publication.id,
          contributionId: groupPublication.contributionId,
          judge: { kind: "NO_CALLER" },
        });
        return projection.copy({
          originalDocumentId: groupOriginal.documentId,
          parentId: null,
          nodeName: "Group original",
          sourcePath: null,
        });
      }),
    ).rejects.toMatchObject({ code: "WORKSPACE_ACCESS_DENIED" });

    // The same group-only contributor succeeds as themselves: their validated
    // groups are only available with their caller.
    await expect(
      fixture.uow.run(async (repositories) => {
        const projection = await bindPublicationProjection(repositories, {
          publicationId: groupPublication.publication.id,
          contributionId: groupPublication.contributionId,
          judge: { kind: "CALLER", caller: fixture.ann },
        });
        return projection.copy({
          originalDocumentId: groupOriginal.documentId,
          parentId: null,
          nodeName: "Group original",
          sourcePath: null,
        });
      }),
    ).resolves.toBeTruthy();
  });
});

describe("publication folders and placement", () => {
  it("ensures one folder, places a document, changes its status and prunes empty folders", async () => {
    const originFolder = await fixture.createFolder(fixture.mike, "repo/tree", "tree");
    const original = await fixture.createSyncedOriginal(fixture.mike, {
      parentId: originFolder.treeNodeId,
      sourcePath: "repo/tree/a.md",
      title: "Tree A",
      markdown: "tree",
    });
    const publication = await fixture.createPublication({
      name: "Tree Publication",
      kind: "FOLDER",
      creator: fixture.mike,
      origin: { kind: "FOLDER", folderNodeId: originFolder.treeNodeId },
    });

    const copied = await fixture.uow.run(async (repositories) => {
      const projection = await bindPublicationProjection(repositories, {
        publicationId: publication.publication.id,
        contributionId: publication.contributionId,
        judge: { kind: "CALLER", caller: fixture.mike },
      });
      const nested = await projection.ensureFolder(null, "nested");
      const again = await projection.ensureFolder(null, "nested");
      expect(again).toBe(nested);
      const created = await projection.copy({
        originalDocumentId: original.documentId,
        parentId: nested,
        nodeName: "Tree A",
        sourcePath: "nested/a.md",
      });
      await projection.place({ teamDocumentId: created.documentId, parentId: null, nodeName: "Tree A" });
      await projection.setDocumentStatus(created.documentId, "ARCHIVED");
      await projection.pruneEmptyFolders();
      return { ...created, nested };
    });

    const [folder] = await fixture.pool.query<{ status: string }[]>(
      "SELECT status FROM knowledge_tree_nodes WHERE id = ?",
      [copied.nested],
    );
    expect(folder.status).toBe("ARCHIVED");
    const [document] = await fixture.pool.query<{ status: string }[]>(
      "SELECT status FROM knowledge_documents WHERE id = ?",
      [copied.documentId],
    );
    expect(document.status).toBe("ARCHIVED");
    const [node] = await fixture.pool.query<{ parent_id: string | null }[]>(
      "SELECT parent_id FROM knowledge_tree_nodes WHERE document_id = ?",
      [copied.documentId],
    );
    expect(node.parent_id).toBeNull();
  });
});
