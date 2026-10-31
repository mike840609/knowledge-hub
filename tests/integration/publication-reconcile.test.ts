import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "@/shared/ids/uuidv7";
import { HubKnowledgeCommandServiceImpl } from "@/modules/knowledge/application/hub-knowledge-command-service";
import { bindSourceProjection } from "@/modules/sources/application/source-knowledge-projection-service";
import { updateSourceLocator } from "@/modules/sources/application/source-entry-mapping-service";
import { reconcileContribution } from "@/modules/sources/application/publication-reconciler";
import type { DocumentBinding, RightsJudge } from "@/modules/sources/domain/publication";
import { publicationError } from "@/modules/sources/domain/publication-errors";
import type { SourceRepositories, SourceUnitOfWork } from "@/modules/sources/ports/unit-of-work";
import { createDirectMembership } from "@/modules/workspaces/domain/workspace-membership";
import { createPublicationFixture, type PublicationFixture } from "../fixtures/publications";

let fixture: PublicationFixture;

beforeAll(async () => {
  fixture = await createPublicationFixture();
});
afterAll(async () => {
  await fixture.dispose();
});

type PublicationRow = Awaited<ReturnType<PublicationFixture["createPublication"]>>;
type Original = Awaited<ReturnType<PublicationFixture["createSyncedOriginal"]>>;

function mikeJudge(): RightsJudge {
  return { kind: "CALLER", caller: fixture.mike };
}
function annJudge(): RightsJudge {
  return { kind: "CALLER", caller: fixture.ann };
}
const NO_CALLER: RightsJudge = { kind: "NO_CALLER" };

async function reconcile(publicationId: string, contributionId: string, judge: RightsJudge) {
  return fixture.uow.run((repositories) => reconcileContribution(repositories, {
    publicationId,
    contributionId,
    judge,
    now: new Date(),
  }));
}

async function publicationDocuments(publicationId: string) {
  return fixture.uow.run((repositories) => repositories.publications.listDocuments(publicationId));
}

async function bindingsOf(contributionId: string) {
  return fixture.uow.run((repositories) => repositories.publications.listBindings(contributionId));
}

async function documentsForOriginal(publicationIds: readonly string[], originalId: string) {
  const placeholders = publicationIds.map(() => "?").join(", ");
  return fixture.pool.query<{ publication_id: string; team_document_id: string }[]>(
    `SELECT publication_id, team_document_id FROM publication_documents
     WHERE publication_id IN (${placeholders}) AND current_original_document_id = ?`,
    [...publicationIds, originalId],
  );
}

async function revisionCount(documentId: string): Promise<number> {
  const rows = await fixture.pool.query<{ total: number }[]>(
    "SELECT COUNT(*) AS total FROM knowledge_revisions WHERE document_id = ?",
    [documentId],
  );
  return Number(rows[0]?.total ?? 0);
}

async function currentRevisionOf(documentId: string) {
  const rows = await fixture.pool.query<{ title: string; markdown: string; created_by: string }[]>(
    `SELECT r.title, r.markdown, r.created_by
     FROM knowledge_documents d JOIN knowledge_revisions r ON r.id = d.current_revision_id
     WHERE d.id = ?`,
    [documentId],
  );
  const row = rows[0];
  if (!row) throw new Error(`Document ${documentId} has no current revision.`);
  return row;
}

async function storedPath(teamDocumentId: string): Promise<string | null> {
  const rows = await fixture.pool.query<{ source_path: string | null }[]>(
    "SELECT source_path FROM publication_documents WHERE team_document_id = ?",
    [teamDocumentId],
  );
  return rows[0]?.source_path ?? null;
}

async function documentStatus(documentId: string): Promise<string> {
  const rows = await fixture.pool.query<{ status: string }[]>(
    "SELECT status FROM knowledge_documents WHERE id = ?",
    [documentId],
  );
  return String(rows[0]?.status);
}

async function folderNamesOf(sourceId: string, documentId: string): Promise<string[]> {
  return fixture.uow.run(async (repositories) => {
    const node = await repositories.tree.findByDocumentId(documentId);
    if (!node) return [];
    const chain = await repositories.tree.listChain(node.id);
    const nodes = await repositories.tree.listBySource(sourceId);
    const nameOf = new Map(nodes.map((candidate) => [candidate.id, candidate.name]));
    return chain
      .filter((entry) => entry.nodeType === "FOLDER")
      .map((entry) => nameOf.get(entry.id) ?? null)
      .filter((name): name is string => name !== null)
      .reverse();
  });
}

async function folderStatus(sourceId: string, parentId: string | null, name: string): Promise<string | null> {
  const nodes = await fixture.uow.run((repositories) => repositories.tree.listBySource(sourceId));
  const folder = nodes.find((node) =>
    node.nodeType === "FOLDER" && node.parentId === parentId && node.name === name);
  return folder ? folder.status : null;
}

/** A nested folder written through the same projection service Folder Sync uses. */
async function projectFolder(
  caller: "mike" | "ann",
  sourceId: string,
  workspaceId: string,
  parentId: string | null,
  sourcePath: string,
  name: string,
): Promise<{ treeNodeId: string }> {
  return fixture.uow.run(async (repositories) => {
    const projection = bindSourceProjection(repositories, { id: sourceId, workspaceId });
    return projection.projectFolder(caller === "mike" ? fixture.mike : fixture.ann, {
      sourceId,
      mapping: { sourceEntryId: uuidv7(), externalId: null, sourcePath },
      parentId,
      name,
    });
  });
}

/** A synced original written through the same projection service Folder Sync uses. */
async function projectDocument(
  caller: "mike" | "ann",
  sourceId: string,
  workspaceId: string,
  input: { parentId: string | null; sourcePath: string; title: string; markdown: string },
): Promise<Original> {
  return fixture.uow.run(async (repositories) => {
    const projection = bindSourceProjection(repositories, { id: sourceId, workspaceId });
    return projection.projectDocument(caller === "mike" ? fixture.mike : fixture.ann, {
      sourceId,
      parentId: input.parentId,
      title: input.title,
      markdown: input.markdown,
      metadata: {},
      mapping: { sourceEntryId: uuidv7(), externalId: null, sourcePath: input.sourcePath },
    });
  });
}

async function reviseOriginal(original: Original, title: string, markdown: string) {
  await fixture.uow.run(async (repositories) => {
    const projection = bindSourceProjection(repositories, {
      id: fixture.mikeFolderSourceId,
      workspaceId: fixture.mikePersonalWorkspaceId,
    });
    await projection.projectRevision(fixture.mike, {
      documentId: original.documentId,
      expectedCurrentRevisionId: original.revisionId,
      title,
      markdown,
      metadata: {},
    });
  });
}

/** Changes a synced original's Folder Sync locator, the way a sync-applied move does. */
async function renameOriginalPath(caller: "mike" | "ann", sourceId: string, documentId: string, sourcePath: string) {
  await fixture.uow.run(async (repositories) => {
    const entry = await repositories.entries.findByDocumentId(documentId);
    if (!entry) throw new Error("The original has no source entry.");
    await updateSourceLocator(
      repositories,
      caller === "mike" ? fixture.mike : fixture.ann,
      sourceId,
      entry.id,
      sourcePath,
      entry.contentHash,
    );
  });
}

async function moveOriginalNode(
  caller: "mike" | "ann",
  sourceId: string,
  workspaceId: string,
  treeNodeId: string,
  newParentId: string | null,
) {
  await fixture.uow.run(async (repositories) => {
    const projection = bindSourceProjection(repositories, { id: sourceId, workspaceId });
    await projection.moveProjectedNode(caller === "mike" ? fixture.mike : fixture.ann, {
      nodeId: treeNodeId,
      newParentId,
      newPosition: 0,
    });
  });
}

async function archiveOriginal(caller: "mike" | "ann", sourceId: string, workspaceId: string, documentId: string) {
  await fixture.uow.run(async (repositories) => {
    const projection = bindSourceProjection(repositories, { id: sourceId, workspaceId });
    await projection.archiveProjectedDocument(caller === "mike" ? fixture.mike : fixture.ann, documentId);
  });
}

async function restoreOriginal(caller: "mike" | "ann", sourceId: string, workspaceId: string, documentId: string) {
  await fixture.uow.run(async (repositories) => {
    const projection = bindSourceProjection(repositories, { id: sourceId, workspaceId });
    await projection.restoreProjectedDocument(caller === "mike" ? fixture.mike : fixture.ann, documentId);
  });
}

async function createFolderSource(workspaceId: string, name: string, actorId: string): Promise<string> {
  const sourceId = uuidv7();
  const now = new Date();
  await fixture.uow.run((repositories) => repositories.sources.insert({
    id: sourceId, name, workspaceId, sourceType: "FOLDER_SYNC", ownership: "SOURCE_MANAGED",
    status: "ACTIVE", syncVersion: 0, createdBy: actorId, updatedBy: actorId,
    archivedBy: null, archivedAt: null, createdAt: now, updatedAt: now,
  }));
  return sourceId;
}

function hubCommands() {
  return new HubKnowledgeCommandServiceImpl(fixture.uow);
}

async function addAnnContribution(publication: PublicationRow, origin: { kind: "FOLDER"; folderNodeId: string } | { kind: "DOCUMENT"; documentId: string }) {
  return fixture.addContribution({ publicationId: publication.publication.id, user: fixture.ann, origin });
}

describe("reconciling a creator's originals", () => {
  it("fans out revisions without duplicate revisions and is idempotent", async () => {
    const folder = await fixture.createFolder(fixture.mike, "reconcile/fanout", "fanout");
    const a = await fixture.createSyncedOriginal(fixture.mike, {
      parentId: folder.treeNodeId, sourcePath: "reconcile/fanout/a.md", title: "A", markdown: "a1",
    });
    await fixture.createSyncedOriginal(fixture.mike, {
      parentId: folder.treeNodeId, sourcePath: "reconcile/fanout/b.md", title: "B", markdown: "b1",
    });
    const publication = await fixture.createPublication({
      name: "Reconcile Fanout", kind: "FOLDER", creator: fixture.mike,
      origin: { kind: "FOLDER", folderNodeId: folder.treeNodeId },
    });

    const first = await reconcile(publication.publication.id, publication.contributionId, mikeJudge());
    expect(first.state).toBe("APPLIED");
    expect(first.report.created).toBe(2);

    const docs = await publicationDocuments(publication.publication.id);
    expect(docs).toHaveLength(2);
    const teamA = docs.find((doc) => doc.currentOriginalDocumentId === a.documentId);
    expect(teamA).toBeDefined();
    expect(await revisionCount(teamA!.teamDocumentId)).toBe(1);

    await reviseOriginal(a, "A v2", "a2");
    const second = await reconcile(publication.publication.id, publication.contributionId, mikeJudge());
    expect(second.report.updated).toBe(1);
    expect(await revisionCount(teamA!.teamDocumentId)).toBe(2);
    expect((await currentRevisionOf(teamA!.teamDocumentId)).title).toBe("A v2");

    const third = await reconcile(publication.publication.id, publication.contributionId, mikeJudge());
    expect(third.state).toBe("APPLIED");
    expect(third.report).toEqual({ created: 0, updated: 0, moved: 0, archived: 0, restored: 0, notices: [] });
    expect(await revisionCount(teamA!.teamDocumentId)).toBe(2);

    // A repeated reconciliation is a no-op on every table this mechanism writes.
    const snapshot = async () => ({
      documents: await fixture.pool.query(
        "SELECT * FROM knowledge_documents WHERE source_id = ? ORDER BY id", [publication.sourceId]),
      nodes: await fixture.pool.query(
        "SELECT * FROM knowledge_tree_nodes WHERE source_id = ? ORDER BY id", [publication.sourceId]),
      publications: await fixture.pool.query(
        "SELECT * FROM publication_documents WHERE publication_id = ? ORDER BY team_document_id",
        [publication.publication.id]),
      bindings: await fixture.pool.query(
        "SELECT * FROM publication_bindings WHERE contribution_id = ? ORDER BY original_document_id",
        [publication.contributionId]),
      contributionState: await fixture.pool.query(
        "SELECT * FROM publication_contributors WHERE id = ?", [publication.contributionId]),
      report: await fixture.pool.query(
        "SELECT * FROM publication_reconcile_reports WHERE contribution_id = ?", [publication.contributionId]),
    });
    const before = await snapshot();
    const repeated = await reconcile(publication.publication.id, publication.contributionId, mikeJudge());
    expect(repeated.report).toEqual(third.report);
    expect(await snapshot()).toEqual(before);
  });

  it("follows the persisted original when the creator renames its path", async () => {
    const folder = await fixture.createFolder(fixture.mike, "reconcile/rename", "rename");
    const original = await fixture.createSyncedOriginal(fixture.mike, {
      parentId: folder.treeNodeId, sourcePath: "reconcile/rename/a.md", title: "Readme", markdown: "body",
    });
    const publication = await fixture.createPublication({
      name: "Reconcile Rename", kind: "FOLDER", creator: fixture.mike,
      origin: { kind: "FOLDER", folderNodeId: folder.treeNodeId },
    });
    await reconcile(publication.publication.id, publication.contributionId, mikeJudge());
    const [team] = await publicationDocuments(publication.publication.id);
    const revisionsBefore = await revisionCount(team.teamDocumentId);

    await renameOriginalPath("mike", fixture.mikeFolderSourceId, original.documentId, "reconcile/rename/renamed.md");
    const result = await reconcile(publication.publication.id, publication.contributionId, mikeJudge());

    expect(result.report.moved).toBe(1);
    const docs = await publicationDocuments(publication.publication.id);
    expect(docs).toHaveLength(1);
    expect(docs[0].teamDocumentId).toBe(team.teamDocumentId);
    expect(docs[0].currentOriginalDocumentId).toBe(original.documentId);
    expect(docs[0].sourcePath).toBe("renamed.md");
    expect(await revisionCount(team.teamDocumentId)).toBe(revisionsBefore);
    expect(await bindingsOf(publication.contributionId)).toEqual([{
      contributionId: publication.contributionId,
      originalDocumentId: original.documentId,
      teamDocumentId: team.teamDocumentId,
    }]);
  });

  it("keeps a non-creator's original bound and never lets it create or overwrite", async () => {
    const mikeFolder = await fixture.createFolder(fixture.mike, "reconcile/owner", "owner");
    await fixture.createSyncedOriginal(fixture.mike, {
      parentId: mikeFolder.treeNodeId, sourcePath: "reconcile/owner/a.md", title: "Owner text", markdown: "owner body",
    });
    const publication = await fixture.createPublication({
      name: "Reconcile Owner", kind: "FOLDER", creator: fixture.mike,
      origin: { kind: "FOLDER", folderNodeId: mikeFolder.treeNodeId },
    });
    await reconcile(publication.publication.id, publication.contributionId, mikeJudge());
    const [team] = await publicationDocuments(publication.publication.id);

    const annFolder = await fixture.createFolder(fixture.ann, "ann-reconcile/owner", "owner");
    const annOriginal = await fixture.createSyncedOriginal(fixture.ann, {
      parentId: annFolder.treeNodeId, sourcePath: "ann-reconcile/owner/a.md", title: "Joiner text", markdown: "joiner body",
    });
    const annContributionId = await addAnnContribution(publication, { kind: "FOLDER", folderNodeId: annFolder.treeNodeId });

    const joined = await reconcile(publication.publication.id, annContributionId, annJudge());
    expect(joined.report.created).toBe(0);
    expect(joined.report.notices).toEqual([{
      publicationId: publication.publication.id,
      originalDocumentId: annOriginal.documentId,
      code: "MAINTAINED_BY_OTHER",
      maintainerUserId: fixture.mike.identity.id,
    }]);
    expect(await bindingsOf(annContributionId)).toEqual([{
      contributionId: annContributionId,
      originalDocumentId: annOriginal.documentId,
      teamDocumentId: team.teamDocumentId,
    }]);

    await renameOriginalPath("ann", fixture.annFolderSourceId, annOriginal.documentId, "ann-reconcile/owner/b.md");
    const renamed = await reconcile(publication.publication.id, annContributionId, annJudge());
    expect(renamed.report.created).toBe(0);
    const docsAfter = await publicationDocuments(publication.publication.id);
    expect(docsAfter).toHaveLength(1);
    expect(docsAfter[0].sourcePath).toBe("a.md");
    expect(await revisionCount(team.teamDocumentId)).toBe(1);
    expect((await currentRevisionOf(team.teamDocumentId)).title).toBe("Owner text");
  });

  it("creates one creator-owned copy for a new path and claims it", async () => {
    const folder = await fixture.createFolder(fixture.mike, "reconcile/new", "new");
    await fixture.createSyncedOriginal(fixture.mike, {
      parentId: folder.treeNodeId, sourcePath: "reconcile/new/a.md", title: "A", markdown: "a",
    });
    const publication = await fixture.createPublication({
      name: "Reconcile New", kind: "FOLDER", creator: fixture.mike,
      origin: { kind: "FOLDER", folderNodeId: folder.treeNodeId },
    });
    await reconcile(publication.publication.id, publication.contributionId, mikeJudge());

    const b = await fixture.createSyncedOriginal(fixture.mike, {
      parentId: folder.treeNodeId, sourcePath: "reconcile/new/b.md", title: "B", markdown: "b",
    });
    const result = await reconcile(publication.publication.id, publication.contributionId, mikeJudge());
    expect(result.report.created).toBe(1);

    const docs = await publicationDocuments(publication.publication.id);
    expect(docs).toHaveLength(2);
    const teamB = docs.find((doc) => doc.currentOriginalDocumentId === b.documentId);
    expect(teamB?.creatorContributionId).toBe(publication.contributionId);
    expect(await bindingsOf(publication.contributionId)).toContainEqual({
      contributionId: publication.contributionId,
      originalDocumentId: b.documentId,
      teamDocumentId: teamB!.teamDocumentId,
    });
  });

  it("leaves one document when two contributors arrive at the same path at once", async () => {
    const mikeFolder = await fixture.createFolder(fixture.mike, "reconcile/same", "same");
    const mikeOriginal = await fixture.createSyncedOriginal(fixture.mike, {
      parentId: mikeFolder.treeNodeId, sourcePath: "reconcile/same/a.md", title: "First", markdown: "first",
    });
    const publication = await fixture.createPublication({
      name: "Reconcile Same", kind: "FOLDER", creator: fixture.mike,
      origin: { kind: "FOLDER", folderNodeId: mikeFolder.treeNodeId },
    });

    const annFolder = await fixture.createFolder(fixture.ann, "ann-reconcile/same", "same");
    const loser = await fixture.createSyncedOriginal(fixture.ann, {
      parentId: annFolder.treeNodeId, sourcePath: "ann-reconcile/same/a.md", title: "Second", markdown: "second",
    });
    const annContributionId = await addAnnContribution(publication, { kind: "FOLDER", folderNodeId: annFolder.treeNodeId });

    // The publication source lock serializes both arrivals; the loser then
    // matches the winner's publication-relative path as a non-creator.
    const [mikeResult, annResult] = await Promise.all([
      reconcile(publication.publication.id, publication.contributionId, mikeJudge()),
      reconcile(publication.publication.id, annContributionId, annJudge()),
    ]);

    const docs = await publicationDocuments(publication.publication.id);
    expect(docs).toHaveLength(1);
    const winner = docs[0];
    const mikeWon = winner.creatorContributionId === publication.contributionId;
    expect(mikeWon ? mikeResult.report.created : annResult.report.created).toBe(1);
    const losingResult = mikeWon ? annResult : mikeResult;
    expect(losingResult.report.created).toBe(0);
    expect(losingResult.report.notices.map((notice) => notice.code)).toEqual(["MAINTAINED_BY_OTHER"]);
    expect((await currentRevisionOf(winner.teamDocumentId)).title).toBe(mikeWon ? "First" : "Second");

    const mikeBindings = await bindingsOf(publication.contributionId);
    const annBindings = await bindingsOf(annContributionId);
    expect(mikeBindings).toEqual([{
      contributionId: publication.contributionId,
      originalDocumentId: mikeOriginal.documentId,
      teamDocumentId: winner.teamDocumentId,
    }]);
    expect(annBindings).toEqual([{
      contributionId: annContributionId,
      originalDocumentId: loser.documentId,
      teamDocumentId: winner.teamDocumentId,
    }]);
  });

  it("keeps Hub documents with equal names distinct with NULL paths", async () => {
    const hub = hubCommands();
    const folder = await hub.createFolder(fixture.mike, {
      sourceId: fixture.mikeHubSourceId, parentId: null, name: "hub-equal",
    });
    await hub.createDocument(fixture.mike, {
      sourceId: fixture.mikeHubSourceId, parentId: folder.treeNodeId, title: "Same name", markdown: "one", metadata: {},
    });
    await hub.createDocument(fixture.mike, {
      sourceId: fixture.mikeHubSourceId, parentId: folder.treeNodeId, title: "Same name", markdown: "two", metadata: {},
    });
    const publication = await fixture.createPublication({
      name: "Reconcile Hub Equal", kind: "FOLDER", creator: fixture.mike,
      origin: { kind: "FOLDER", folderNodeId: folder.treeNodeId },
    });
    const result = await reconcile(publication.publication.id, publication.contributionId, mikeJudge());

    expect(result.report.created).toBe(2);
    const docs = await publicationDocuments(publication.publication.id);
    expect(docs).toHaveLength(2);
    expect(docs.every((doc) => doc.sourcePath === null)).toBe(true);
    expect(new Set(docs.map((doc) => doc.teamDocumentId)).size).toBe(2);
  });
});

describe("path reservations and moves", () => {
  it("blocks a move onto another creator's active and archived path", async () => {
    const mikeFolder = await fixture.createFolder(fixture.mike, "reconcile/block", "block");
    const mikeOriginal = await fixture.createSyncedOriginal(fixture.mike, {
      parentId: mikeFolder.treeNodeId, sourcePath: "reconcile/block/a.md", title: "Mike A", markdown: "mike",
    });
    const publication = await fixture.createPublication({
      name: "Reconcile Block", kind: "FOLDER", creator: fixture.mike,
      origin: { kind: "FOLDER", folderNodeId: mikeFolder.treeNodeId },
    });
    await reconcile(publication.publication.id, publication.contributionId, mikeJudge());

    const annFolder = await fixture.createFolder(fixture.ann, "ann-reconcile/block", "block");
    const annOriginal = await fixture.createSyncedOriginal(fixture.ann, {
      parentId: annFolder.treeNodeId, sourcePath: "ann-reconcile/block/c.md", title: "Ann C", markdown: "ann",
    });
    const annContributionId = await addAnnContribution(publication, { kind: "FOLDER", folderNodeId: annFolder.treeNodeId });
    await reconcile(publication.publication.id, annContributionId, annJudge());
    const annTeam = (await publicationDocuments(publication.publication.id))
      .find((doc) => doc.currentOriginalDocumentId === annOriginal.documentId)!;

    await renameOriginalPath("ann", fixture.annFolderSourceId, annOriginal.documentId, "ann-reconcile/block/a.md");
    const activeBlock = await reconcile(publication.publication.id, annContributionId, annJudge());
    expect(activeBlock.report.moved).toBe(0);
    expect(activeBlock.report.notices).toEqual([{
      publicationId: publication.publication.id,
      originalDocumentId: annOriginal.documentId,
      code: "PATH_RESERVED",
    }]);
    expect(await storedPath(annTeam.teamDocumentId)).toBe("c.md");

    await archiveOriginal("mike", fixture.mikeFolderSourceId, fixture.mikePersonalWorkspaceId, mikeOriginal.documentId);
    await reconcile(publication.publication.id, publication.contributionId, mikeJudge());
    const archivedBlock = await reconcile(publication.publication.id, annContributionId, annJudge());
    expect(archivedBlock.report.notices.map((notice) => notice.code)).toEqual(["PATH_RESERVED"]);
    expect(await storedPath(annTeam.teamDocumentId)).toBe("c.md");
  });

  it("reuses the creator's own archived copy and keeps its discussion threads", async () => {
    const folder = await fixture.createFolder(fixture.mike, "reconcile/reattach", "reattach");
    const original = await fixture.createSyncedOriginal(fixture.mike, {
      parentId: folder.treeNodeId, sourcePath: "reconcile/reattach/a.md", title: "Version one", markdown: "one",
    });
    const publication = await fixture.createPublication({
      name: "Reconcile Reattach", kind: "FOLDER", creator: fixture.mike,
      origin: { kind: "FOLDER", folderNodeId: folder.treeNodeId },
    });
    await reconcile(publication.publication.id, publication.contributionId, mikeJudge());
    const [team] = await publicationDocuments(publication.publication.id);
    const discussion = await fixture.createDiscussion({
      workspaceId: fixture.teamWorkspaceId,
      documentId: team.teamDocumentId,
      revisionId: await fixture.revisionIdOf(team.teamDocumentId),
      authorId: fixture.mike.identity.id,
    });

    await archiveOriginal("mike", fixture.mikeFolderSourceId, fixture.mikePersonalWorkspaceId, original.documentId);
    const archived = await reconcile(publication.publication.id, publication.contributionId, mikeJudge());
    expect(archived.report.archived).toBe(1);
    expect(await documentStatus(team.teamDocumentId)).toBe("ARCHIVED");

    const replacement = await fixture.createSyncedOriginal(fixture.mike, {
      parentId: folder.treeNodeId, sourcePath: "reconcile/reattach/a.md", title: "Version two", markdown: "two",
    });
    const reattached = await reconcile(publication.publication.id, publication.contributionId, mikeJudge());
    expect(reattached.report.restored).toBe(1);

    const docs = await publicationDocuments(publication.publication.id);
    expect(docs).toHaveLength(1);
    expect(docs[0].teamDocumentId).toBe(team.teamDocumentId);
    expect(docs[0].currentOriginalDocumentId).toBe(replacement.documentId);
    expect(docs[0].sourcePath).toBe("a.md");
    expect(await documentStatus(team.teamDocumentId)).toBe("ACTIVE");
    expect(await currentRevisionOf(team.teamDocumentId)).toMatchObject({ title: "Version two", markdown: "two" });
    const threads = await fixture.pool.query<{ id: string }[]>(
      "SELECT id FROM document_review_threads WHERE document_id = ?",
      [team.teamDocumentId],
    );
    expect(threads.map((thread) => thread.id)).toEqual([discussion.threadId]);
    expect(await bindingsOf(publication.contributionId)).toEqual([{
      contributionId: publication.contributionId,
      originalDocumentId: replacement.documentId,
      teamDocumentId: team.teamDocumentId,
    }]);
  });

  it("archives the old copy when a move lands on the creator's own archived path", async () => {
    const folder = await fixture.createFolder(fixture.mike, "reconcile/intake", "intake");
    const oldB = await fixture.createSyncedOriginal(fixture.mike, {
      parentId: folder.treeNodeId, sourcePath: "reconcile/intake/b.md", title: "Old B", markdown: "old b",
    });
    const mover = await fixture.createSyncedOriginal(fixture.mike, {
      parentId: folder.treeNodeId, sourcePath: "reconcile/intake/a.md", title: "Mover", markdown: "mover",
    });
    const publication = await fixture.createPublication({
      name: "Reconcile Intake", kind: "FOLDER", creator: fixture.mike,
      origin: { kind: "FOLDER", folderNodeId: folder.treeNodeId },
    });
    await reconcile(publication.publication.id, publication.contributionId, mikeJudge());
    const before = await publicationDocuments(publication.publication.id);
    const teamA = before.find((doc) => doc.currentOriginalDocumentId === mover.documentId)!;
    const teamB = before.find((doc) => doc.currentOriginalDocumentId === oldB.documentId)!;

    await archiveOriginal("mike", fixture.mikeFolderSourceId, fixture.mikePersonalWorkspaceId, oldB.documentId);
    await reconcile(publication.publication.id, publication.contributionId, mikeJudge());
    expect(await documentStatus(teamB.teamDocumentId)).toBe("ARCHIVED");

    await renameOriginalPath("mike", fixture.mikeFolderSourceId, mover.documentId, "reconcile/intake/b.md");
    const result = await reconcile(publication.publication.id, publication.contributionId, mikeJudge());
    expect(result.report.archived).toBe(1);
    expect(result.report.restored).toBe(1);

    const after = await publicationDocuments(publication.publication.id);
    const oldCopy = after.find((doc) => doc.teamDocumentId === teamA.teamDocumentId)!;
    const reusedCopy = after.find((doc) => doc.teamDocumentId === teamB.teamDocumentId)!;
    expect(oldCopy.status).toBe("ARCHIVED");
    expect(oldCopy.sourcePath).toBe("a.md");
    expect(reusedCopy.status).toBe("ACTIVE");
    expect(reusedCopy.sourcePath).toBe("b.md");
    expect(reusedCopy.currentOriginalDocumentId).toBe(mover.documentId);
    expect(await documentStatus(teamB.teamDocumentId)).toBe("ACTIVE");
  });

  it("does not re-feed a team document from an old restored original", async () => {
    const folder = await fixture.createFolder(fixture.mike, "reconcile/restore-old", "restore-old");
    const oldB = await fixture.createSyncedOriginal(fixture.mike, {
      parentId: folder.treeNodeId, sourcePath: "reconcile/restore-old/b.md", title: "Old B", markdown: "old b",
    });
    const mover = await fixture.createSyncedOriginal(fixture.mike, {
      parentId: folder.treeNodeId, sourcePath: "reconcile/restore-old/a.md", title: "Mover", markdown: "mover",
    });
    const publication = await fixture.createPublication({
      name: "Reconcile Restore Old", kind: "FOLDER", creator: fixture.mike,
      origin: { kind: "FOLDER", folderNodeId: folder.treeNodeId },
    });
    await reconcile(publication.publication.id, publication.contributionId, mikeJudge());
    const before = await publicationDocuments(publication.publication.id);
    const teamB = before.find((doc) => doc.currentOriginalDocumentId === oldB.documentId)!;

    await archiveOriginal("mike", fixture.mikeFolderSourceId, fixture.mikePersonalWorkspaceId, oldB.documentId);
    await reconcile(publication.publication.id, publication.contributionId, mikeJudge());
    await renameOriginalPath("mike", fixture.mikeFolderSourceId, mover.documentId, "reconcile/restore-old/b.md");
    await reconcile(publication.publication.id, publication.contributionId, mikeJudge());
    expect((await publicationDocuments(publication.publication.id))
      .find((doc) => doc.teamDocumentId === teamB.teamDocumentId)?.currentOriginalDocumentId).toBe(mover.documentId);
    const revisionsBefore = await revisionCount(teamB.teamDocumentId);

    await restoreOriginal("mike", fixture.mikeFolderSourceId, fixture.mikePersonalWorkspaceId, oldB.documentId);
    const restored = await reconcile(publication.publication.id, publication.contributionId, mikeJudge());

    expect(restored.report.created).toBe(0);
    expect(restored.report.notices.map((notice) => notice.code)).toEqual(["PATH_RESERVED"]);
    const after = await publicationDocuments(publication.publication.id);
    const reused = after.find((doc) => doc.teamDocumentId === teamB.teamDocumentId)!;
    expect(reused.currentOriginalDocumentId).toBe(mover.documentId);
    expect(await revisionCount(teamB.teamDocumentId)).toBe(revisionsBefore);
    expect(after.filter((doc) => doc.sourcePath === "b.md")).toHaveLength(1);
  });

  it("applies a swap and a rotation in one reconciliation without revisions", async () => {
    const folder = await fixture.createFolder(fixture.mike, "reconcile/cycle", "cycle");
    const originals: Original[] = [];
    for (const name of ["s1", "s2", "r1", "r2", "r3"]) {
      originals.push(await fixture.createSyncedOriginal(fixture.mike, {
        parentId: folder.treeNodeId,
        sourcePath: `reconcile/cycle/${name}.md`,
        title: name,
        markdown: `${name} body`,
      }));
    }
    const publication = await fixture.createPublication({
      name: "Reconcile Cycle", kind: "FOLDER", creator: fixture.mike,
      origin: { kind: "FOLDER", folderNodeId: folder.treeNodeId },
    });
    await reconcile(publication.publication.id, publication.contributionId, mikeJudge());
    const before = await publicationDocuments(publication.publication.id);
    const teamOf = (index: number) => before.find((doc) => doc.currentOriginalDocumentId === originals[index].documentId)!;
    const revisions = new Map<string, number>();
    for (const doc of before) revisions.set(doc.teamDocumentId, await revisionCount(doc.teamDocumentId));

    const targets = new Map<number, string>([
      [0, "s2"], [1, "s1"],
      [2, "r2"], [3, "r3"], [4, "r1"],
    ]);
    for (const [index, name] of targets) {
      await renameOriginalPath("mike", fixture.mikeFolderSourceId, originals[index].documentId, `reconcile/cycle/${name}.md`);
    }
    const result = await reconcile(publication.publication.id, publication.contributionId, mikeJudge());

    expect(result.report.moved).toBe(5);
    expect(result.report.notices).toEqual([]);
    const after = await publicationDocuments(publication.publication.id);
    for (const [index, name] of targets) {
      const doc = after.find((candidate) => candidate.teamDocumentId === teamOf(index).teamDocumentId)!;
      expect(doc.sourcePath).toBe(`${name}.md`);
      expect(await revisionCount(doc.teamDocumentId)).toBe(revisions.get(doc.teamDocumentId));
    }
  });

  it("keeps the old path and reports PATH_RESERVED when a final conflict remains", async () => {
    const folder = await fixture.createFolder(fixture.mike, "reconcile/conflict", "conflict");
    const a = await fixture.createSyncedOriginal(fixture.mike, {
      parentId: folder.treeNodeId, sourcePath: "reconcile/conflict/a.md", title: "A", markdown: "a",
    });
    await fixture.createSyncedOriginal(fixture.mike, {
      parentId: folder.treeNodeId, sourcePath: "reconcile/conflict/b.md", title: "B", markdown: "b",
    });
    await fixture.createSyncedOriginal(fixture.mike, {
      parentId: folder.treeNodeId, sourcePath: "reconcile/conflict/c.md", title: "C", markdown: "c",
    });
    const publication = await fixture.createPublication({
      name: "Reconcile Conflict", kind: "FOLDER", creator: fixture.mike,
      origin: { kind: "FOLDER", folderNodeId: folder.treeNodeId },
    });
    await reconcile(publication.publication.id, publication.contributionId, mikeJudge());
    const teamA = (await publicationDocuments(publication.publication.id))
      .find((doc) => doc.currentOriginalDocumentId === a.documentId)!;
    const teamC = (await publicationDocuments(publication.publication.id))
      .find((doc) => doc.sourcePath === "c.md")!;
    const revisionsBefore = await revisionCount(teamA.teamDocumentId);

    await renameOriginalPath("mike", fixture.mikeFolderSourceId, a.documentId, "reconcile/conflict/c.md");
    const result = await reconcile(publication.publication.id, publication.contributionId, mikeJudge());

    expect(result.report.moved).toBe(0);
    expect(result.report.notices).toEqual([{
      publicationId: publication.publication.id,
      originalDocumentId: a.documentId,
      code: "PATH_RESERVED",
    }]);
    expect(await storedPath(teamA.teamDocumentId)).toBe("a.md");
    expect(await storedPath(teamC.teamDocumentId)).toBe("c.md");
    expect(await revisionCount(teamA.teamDocumentId)).toBe(revisionsBefore);
  });

  it("re-attaches the same copy for a same-sync delete plus add", async () => {
    const folder = await fixture.createFolder(fixture.mike, "reconcile/delete-add", "delete-add");
    const deleted = await fixture.createSyncedOriginal(fixture.mike, {
      parentId: folder.treeNodeId, sourcePath: "reconcile/delete-add/a.md", title: "Version one", markdown: "one",
    });
    const publication = await fixture.createPublication({
      name: "Reconcile Delete Add", kind: "FOLDER", creator: fixture.mike,
      origin: { kind: "FOLDER", folderNodeId: folder.treeNodeId },
    });
    await reconcile(publication.publication.id, publication.contributionId, mikeJudge());
    const [team] = await publicationDocuments(publication.publication.id);
    const discussion = await fixture.createDiscussion({
      workspaceId: fixture.teamWorkspaceId,
      documentId: team.teamDocumentId,
      revisionId: await fixture.revisionIdOf(team.teamDocumentId),
      authorId: fixture.mike.identity.id,
    });

    // One sync: the old document is deleted, a new document replaces it at the
    // same path, and one genuinely new document appears elsewhere.
    await archiveOriginal("mike", fixture.mikeFolderSourceId, fixture.mikePersonalWorkspaceId, deleted.documentId);
    const replacement = await fixture.createSyncedOriginal(fixture.mike, {
      parentId: folder.treeNodeId, sourcePath: "reconcile/delete-add/a.md", title: "Version two", markdown: "two",
    });
    const fresh = await fixture.createSyncedOriginal(fixture.mike, {
      parentId: folder.treeNodeId, sourcePath: "reconcile/delete-add/b.md", title: "Fresh", markdown: "fresh",
    });

    const result = await reconcile(publication.publication.id, publication.contributionId, mikeJudge());

    expect(result.report.created).toBe(1);
    expect(result.report.restored).toBe(1);
    expect(result.report.archived).toBe(0);
    expect(result.report.notices).toEqual([]);
    const docs = await publicationDocuments(publication.publication.id);
    expect(docs).toHaveLength(2);
    const reused = docs.find((doc) => doc.teamDocumentId === team.teamDocumentId)!;
    expect(reused.currentOriginalDocumentId).toBe(replacement.documentId);
    expect(reused.sourcePath).toBe("a.md");
    expect(reused.status).toBe("ACTIVE");
    expect((await currentRevisionOf(team.teamDocumentId)).title).toBe("Version two");
    const threads = await fixture.pool.query<{ id: string }[]>(
      "SELECT id FROM document_review_threads WHERE document_id = ?",
      [team.teamDocumentId],
    );
    expect(threads.map((thread) => thread.id)).toEqual([discussion.threadId]);
    expect(docs.find((doc) => doc.currentOriginalDocumentId === fresh.documentId)?.sourcePath).toBe("b.md");
  });

  it("lets a new original take a path vacated by a move in the same sync", async () => {
    const folder = await fixture.createFolder(fixture.mike, "reconcile/vacate", "vacate");
    const mover = await fixture.createSyncedOriginal(fixture.mike, {
      parentId: folder.treeNodeId, sourcePath: "reconcile/vacate/a.md", title: "Mover", markdown: "mover",
    });
    const publication = await fixture.createPublication({
      name: "Reconcile Vacate", kind: "FOLDER", creator: fixture.mike,
      origin: { kind: "FOLDER", folderNodeId: folder.treeNodeId },
    });
    await reconcile(publication.publication.id, publication.contributionId, mikeJudge());
    const [teamMover] = await publicationDocuments(publication.publication.id);
    const revisionsBefore = await revisionCount(teamMover.teamDocumentId);

    // One sync: the old original moves to b.md and a new original appears at a.md.
    await renameOriginalPath("mike", fixture.mikeFolderSourceId, mover.documentId, "reconcile/vacate/b.md");
    const incoming = await fixture.createSyncedOriginal(fixture.mike, {
      parentId: folder.treeNodeId, sourcePath: "reconcile/vacate/a.md", title: "Incoming", markdown: "incoming",
    });
    const result = await reconcile(publication.publication.id, publication.contributionId, mikeJudge());

    expect(result.report.created).toBe(1);
    expect(result.report.moved).toBe(1);
    expect(result.report.notices).toEqual([]);
    const docs = await publicationDocuments(publication.publication.id);
    expect(docs).toHaveLength(2);
    expect(docs.find((doc) => doc.teamDocumentId === teamMover.teamDocumentId)?.sourcePath).toBe("b.md");
    expect(docs.find((doc) => doc.currentOriginalDocumentId === incoming.documentId)?.sourcePath).toBe("a.md");
    expect(await revisionCount(teamMover.teamDocumentId)).toBe(revisionsBefore);
  });
});

describe("cross-publication claims", () => {
  it("reports a claim held by another publication and still applies the rest", async () => {
    const parent = await projectFolder(
      "mike", fixture.mikeFolderSourceId, fixture.mikePersonalWorkspaceId,
      null, "claim/det/parent", "parent",
    );
    const sub = await projectFolder(
      "mike", fixture.mikeFolderSourceId, fixture.mikePersonalWorkspaceId,
      parent.treeNodeId, "claim/det/parent/sub", "sub",
    );
    const shared = await projectDocument("mike", fixture.mikeFolderSourceId, fixture.mikePersonalWorkspaceId, {
      parentId: sub.treeNodeId, sourcePath: "claim/det/parent/sub/o.md", title: "Shared O", markdown: "o",
    });
    const own = await projectDocument("mike", fixture.mikeFolderSourceId, fixture.mikePersonalWorkspaceId, {
      parentId: parent.treeNodeId, sourcePath: "claim/det/parent/b.md", title: "Own B", markdown: "b",
    });
    const winner = await fixture.createPublication({
      name: "Claim Winner", kind: "FOLDER", creator: fixture.mike,
      origin: { kind: "FOLDER", folderNodeId: sub.treeNodeId },
    });
    const loser = await fixture.createPublication({
      name: "Claim Loser", kind: "FOLDER", creator: fixture.mike,
      origin: { kind: "FOLDER", folderNodeId: parent.treeNodeId },
    });
    await reconcile(winner.publication.id, winner.contributionId, mikeJudge());

    const result = await reconcile(loser.publication.id, loser.contributionId, mikeJudge());

    expect(result.state).toBe("APPLIED");
    expect(result.report.created).toBe(1);
    expect(result.report.notices).toEqual([{
      publicationId: loser.publication.id,
      originalDocumentId: shared.documentId,
      code: "ORIGINAL_ALREADY_PUBLISHED",
      existingPublicationName: "Claim Winner",
    }]);
    const losingDocs = await publicationDocuments(loser.publication.id);
    expect(losingDocs).toHaveLength(1);
    expect(losingDocs[0].currentOriginalDocumentId).toBe(own.documentId);
    expect(await documentsForOriginal([loser.publication.id], shared.documentId)).toHaveLength(0);

    // The refusal is stable: a later run reports the same claim and changes nothing.
    const rerun = await reconcile(loser.publication.id, loser.contributionId, mikeJudge());
    expect(rerun.report.created).toBe(0);
    expect(rerun.report.notices.map((notice) => notice.code)).toEqual(["ORIGINAL_ALREADY_PUBLISHED"]);
    expect(await publicationDocuments(loser.publication.id)).toHaveLength(1);
  });

  it("rolls back only a losing claim attempt and keeps the transaction usable", async () => {
    const folder = await fixture.createFolder(fixture.mike, "claim/savepoint", "savepoint");
    const claimed = await fixture.createSyncedOriginal(fixture.mike, {
      parentId: folder.treeNodeId, sourcePath: "claim/savepoint/claimed.md", title: "Claimed", markdown: "claimed",
    });
    await fixture.createSyncedOriginal(fixture.mike, {
      parentId: folder.treeNodeId, sourcePath: "claim/savepoint/other.md", title: "Other", markdown: "other",
    });
    const owner = await fixture.createPublication({
      name: "Savepoint Owner", kind: "FOLDER", creator: fixture.mike,
      origin: { kind: "FOLDER", folderNodeId: folder.treeNodeId },
    });
    await reconcile(owner.publication.id, owner.contributionId, mikeJudge());

    const otherFolder = await fixture.createFolder(fixture.mike, "claim/savepoint-free", "savepoint-free");
    const free = await fixture.createSyncedOriginal(fixture.mike, {
      parentId: otherFolder.treeNodeId, sourcePath: "claim/savepoint-free/free.md", title: "Free", markdown: "free",
    });
    const challenger = await fixture.createPublication({
      name: "Savepoint Challenger", kind: "FOLDER", creator: fixture.mike,
      origin: { kind: "FOLDER", folderNodeId: otherFolder.treeNodeId },
    });
    const teamClaimed = await fixture.createTeamDocument({
      publication: challenger,
      creatorContributionId: challenger.contributionId,
      originalDocumentId: claimed.documentId,
      sourcePath: "claimed.md",
      title: "Claimed",
    });
    const teamFree = await fixture.createTeamDocument({
      publication: challenger,
      creatorContributionId: challenger.contributionId,
      originalDocumentId: free.documentId,
      sourcePath: "free.md",
      title: "Free",
    });

    const outcome = await fixture.uow.run(async (repositories) => {
      const attempt = await repositories.publications.runClaimAttempt(async () => {
        // The first binding is legal and must still be rolled back with the
        // failing attempt, proving the savepoint isolates the whole copy.
        await repositories.publications.bind({
          contributionId: challenger.contributionId,
          originalDocumentId: free.documentId,
          teamDocumentId: teamFree.teamDocumentId,
        });
        await repositories.publications.bind({
          contributionId: challenger.contributionId,
          originalDocumentId: claimed.documentId,
          teamDocumentId: teamClaimed.teamDocumentId,
        });
      });
      // A write after the failed attempt proves the transaction is still usable.
      await repositories.publications.saveReport(challenger.contributionId, {
        created: 0, updated: 0, moved: 0, archived: 0, restored: 0, notices: [],
      });
      return attempt;
    });

    expect(outcome).toMatchObject({ ok: false, error: { code: "PUBLICATION_ORIGINAL_TAKEN" } });
    expect(await bindingsOf(challenger.contributionId)).toEqual([]);
    expect(await fixture.uow.run((repositories) =>
      repositories.publications.findReport(challenger.contributionId))).not.toBeNull();
  });

  it("rolls the in-memory tree view back when a claim attempt loses", async () => {
    const root = await fixture.createFolder(fixture.mike, "claim/phantom", "phantom");
    const shared = await projectFolder(
      "mike", fixture.mikeFolderSourceId, fixture.mikePersonalWorkspaceId,
      root.treeNodeId, "claim/phantom/shared", "shared",
    );
    const lonely = await projectFolder(
      "mike", fixture.mikeFolderSourceId, fixture.mikePersonalWorkspaceId,
      root.treeNodeId, "claim/phantom/lonely", "lonely",
    );
    const sharedDocuments = [
      await fixture.createSyncedOriginal(fixture.mike, {
        parentId: shared.treeNodeId,
        sourcePath: "claim/phantom/shared/a.md",
        title: "Shared A",
        markdown: "a",
      }),
      await fixture.createSyncedOriginal(fixture.mike, {
        parentId: shared.treeNodeId,
        sourcePath: "claim/phantom/shared/b.md",
        title: "Shared B",
        markdown: "b",
      }),
    ];
    // The failing copy must sort before the surviving one so a phantom node
    // would push the survivor's position to 1.
    const [failingShared, survivingShared] = sharedDocuments
      .sort((left, right) => left.documentId.localeCompare(right.documentId));
    const failingLonely = await fixture.createSyncedOriginal(fixture.mike, {
      parentId: lonely.treeNodeId,
      sourcePath: "claim/phantom/lonely/only.md",
      title: "Lonely",
      markdown: "only",
    });
    const publication = await fixture.createPublication({
      name: "Phantom Claim Publication", kind: "FOLDER", creator: fixture.mike,
      origin: { kind: "FOLDER", folderNodeId: root.treeNodeId },
    });
    const failing = new Set([failingShared.documentId, failingLonely.documentId]);
    const findClaimCalls = new Map<string, number>();
    const conflicted: SourceUnitOfWork = {
      async run<T>(work: (repositories: SourceRepositories) => Promise<T>): Promise<T> {
        return fixture.uow.run(async (repositories) => {
          const publications = new Proxy(repositories.publications, {
            get(target, property, receiver) {
              if (property === "findClaim") {
                return async (
                  originalDocumentId: string,
                  teamWorkspaceId: string,
                  excludePublicationId: string,
                ) => {
                  if (!failing.has(originalDocumentId)) {
                    return target.findClaim(originalDocumentId, teamWorkspaceId, excludePublicationId);
                  }
                  const calls = (findClaimCalls.get(originalDocumentId) ?? 0) + 1;
                  findClaimCalls.set(originalDocumentId, calls);
                  // Hide the claim from the pre-check, then name the winner
                  // after the savepoint fails, like a real concurrent claim.
                  return calls === 1
                    ? null
                    : { publicationId: "00000000-0000-7000-8000-000000000001", publicationName: "Winner" };
                };
              }
              if (property === "bind") {
                return async (binding: DocumentBinding) => {
                  if (failing.has(binding.originalDocumentId)) {
                    throw publicationError("PUBLICATION_ORIGINAL_TAKEN", "taken");
                  }
                  return target.bind(binding);
                };
              }
              return Reflect.get(target, property, receiver);
            },
          });
          const wrapped = new Proxy(repositories, {
            get(target, property, receiver) {
              return property === "publications"
                ? publications
                : Reflect.get(target, property, receiver);
            },
          });
          return work(wrapped);
        });
      },
      runWithCreatorQuotaLock: (creatorId, timeoutSeconds, work) =>
        fixture.uow.runWithCreatorQuotaLock(creatorId, timeoutSeconds, work),
    };

    const result = await conflicted.run((repositories) => reconcileContribution(repositories, {
      publicationId: publication.publication.id,
      contributionId: publication.contributionId,
      judge: mikeJudge(),
      now: new Date(),
    }));

    expect(result.state).toBe("APPLIED");
    expect(result.report.created).toBe(1);
    expect(result.report.notices.filter((notice) => notice.code === "ORIGINAL_ALREADY_PUBLISHED"))
      .toHaveLength(2);
    // The failed copies left no active node or folder behind: prune sees the
    // lonely folder as empty, and the survivor starts at position 0.
    expect(await folderStatus(publication.sourceId, null, "lonely")).toBe("ARCHIVED");
    const nodes = await fixture.uow.run((repositories) =>
      repositories.tree.listBySource(publication.sourceId));
    const sharedFolder = nodes.find((node) =>
      node.nodeType === "FOLDER" && node.parentId === null && node.name === "shared");
    expect(sharedFolder).toBeDefined();
    const sharedChildren = nodes.filter((node) => node.parentId === sharedFolder?.id);
    expect(sharedChildren).toHaveLength(1);
    const [survivor] = await publicationDocuments(publication.publication.id);
    expect(survivor.currentOriginalDocumentId).toBe(survivingShared.documentId);
    expect(sharedChildren[0]).toMatchObject({ documentId: survivor.teamDocumentId, position: 0 });
  });

  it("lets one of two racing publications win the claim without aborting the other", async () => {
    const parent = await projectFolder(
      "mike", fixture.mikeFolderSourceId, fixture.mikePersonalWorkspaceId,
      null, "claim/race/parent", "parent",
    );
    const sub = await projectFolder(
      "mike", fixture.mikeFolderSourceId, fixture.mikePersonalWorkspaceId,
      parent.treeNodeId, "claim/race/parent/sub", "sub",
    );
    const shared = await projectDocument("mike", fixture.mikeFolderSourceId, fixture.mikePersonalWorkspaceId, {
      parentId: sub.treeNodeId, sourcePath: "claim/race/parent/sub/o.md", title: "Race O", markdown: "o",
    });
    await projectDocument("mike", fixture.mikeFolderSourceId, fixture.mikePersonalWorkspaceId, {
      parentId: sub.treeNodeId, sourcePath: "claim/race/parent/sub/oa.md", title: "Race OA", markdown: "oa",
    });
    const onlyB = await projectDocument("mike", fixture.mikeFolderSourceId, fixture.mikePersonalWorkspaceId, {
      parentId: parent.treeNodeId, sourcePath: "claim/race/parent/only-b.md", title: "Only B", markdown: "b",
    });
    const first = await fixture.createPublication({
      name: "Claim Race A", kind: "FOLDER", creator: fixture.mike,
      origin: { kind: "FOLDER", folderNodeId: sub.treeNodeId },
    });
    const second = await fixture.createPublication({
      name: "Claim Race B", kind: "FOLDER", creator: fixture.mike,
      origin: { kind: "FOLDER", folderNodeId: parent.treeNodeId },
    });

    const [firstResult, secondResult] = await Promise.all([
      reconcile(first.publication.id, first.contributionId, mikeJudge()),
      reconcile(second.publication.id, second.contributionId, mikeJudge()),
    ]);

    expect(firstResult.state).toBe("APPLIED");
    expect(secondResult.state).toBe("APPLIED");
    const sharedDocs = await documentsForOriginal(
      [first.publication.id, second.publication.id], shared.documentId);
    expect(sharedDocs).toHaveLength(1);
    const noticeForShared = [...firstResult.report.notices, ...secondResult.report.notices]
      .filter((notice) => notice.originalDocumentId === shared.documentId);
    expect(noticeForShared).toHaveLength(1);
    expect(noticeForShared[0].code).toBe("ORIGINAL_ALREADY_PUBLISHED");
    const winnerPublicationId = sharedDocs[0].publication_id;
    expect(noticeForShared[0].existingPublicationName)
      .toBe(winnerPublicationId === first.publication.id ? "Claim Race A" : "Claim Race B");

    // B's unshared original still applies even when B loses the contested one.
    expect(secondResult.report.created).toBeGreaterThanOrEqual(1);
    expect(await documentsForOriginal([second.publication.id], onlyB.documentId)).toHaveLength(1);
  });
});

describe("eligibility, placement and rights", () => {
  it("archives and restores a copy as the original leaves, archives and comes back", async () => {
    const folder = await fixture.createFolder(fixture.mike, "reconcile/life", "life");
    const sub = await projectFolder(
      "mike", fixture.mikeFolderSourceId, fixture.mikePersonalWorkspaceId,
      folder.treeNodeId, "reconcile/life/sub", "sub",
    );
    const original = await fixture.createSyncedOriginal(fixture.mike, {
      parentId: sub.treeNodeId, sourcePath: "reconcile/life/sub/a.md", title: "Life", markdown: "life",
    });
    const outside = await projectFolder(
      "mike", fixture.mikeFolderSourceId, fixture.mikePersonalWorkspaceId,
      null, "reconcile/outside", "outside",
    );
    const publication = await fixture.createPublication({
      name: "Reconcile Life", kind: "FOLDER", creator: fixture.mike,
      origin: { kind: "FOLDER", folderNodeId: folder.treeNodeId },
    });
    await reconcile(publication.publication.id, publication.contributionId, mikeJudge());
    const [team] = await publicationDocuments(publication.publication.id);
    expect(await storedPath(team.teamDocumentId)).toBe("sub/a.md");
    expect(await folderNamesOf(publication.sourceId, team.teamDocumentId)).toEqual(["sub"]);

    await moveOriginalNode("mike", fixture.mikeFolderSourceId, fixture.mikePersonalWorkspaceId, original.treeNodeId, outside.treeNodeId);
    await renameOriginalPath("mike", fixture.mikeFolderSourceId, original.documentId, "reconcile/outside/a.md");
    const movedOut = await reconcile(publication.publication.id, publication.contributionId, mikeJudge());
    expect(movedOut.report.archived).toBe(1);
    expect(await documentStatus(team.teamDocumentId)).toBe("ARCHIVED");

    await moveOriginalNode("mike", fixture.mikeFolderSourceId, fixture.mikePersonalWorkspaceId, original.treeNodeId, sub.treeNodeId);
    await renameOriginalPath("mike", fixture.mikeFolderSourceId, original.documentId, "reconcile/life/sub/a.md");
    const movedBack = await reconcile(publication.publication.id, publication.contributionId, mikeJudge());
    expect(movedBack.report.restored).toBe(1);
    expect(await documentStatus(team.teamDocumentId)).toBe("ACTIVE");
    expect((await publicationDocuments(publication.publication.id))[0].teamDocumentId).toBe(team.teamDocumentId);

    await archiveOriginal("mike", fixture.mikeFolderSourceId, fixture.mikePersonalWorkspaceId, original.documentId);
    const archived = await reconcile(publication.publication.id, publication.contributionId, mikeJudge());
    expect(archived.report.archived).toBe(1);
    expect(await documentStatus(team.teamDocumentId)).toBe("ARCHIVED");

    await restoreOriginal("mike", fixture.mikeFolderSourceId, fixture.mikePersonalWorkspaceId, original.documentId);
    const restored = await reconcile(publication.publication.id, publication.contributionId, mikeJudge());
    expect(restored.report.restored).toBe(1);
    expect(await documentStatus(team.teamDocumentId)).toBe("ACTIVE");
  });

  it("archives every copy when the personal source is archived", async () => {
    const sourceId = await createFolderSource(fixture.mikePersonalWorkspaceId, "Reconcile Source", fixture.mike.identity.id);
    const folder = await projectFolder("mike", sourceId, fixture.mikePersonalWorkspaceId, null, "source-repo", "source-repo");
    const original = await projectDocument("mike", sourceId, fixture.mikePersonalWorkspaceId, {
      parentId: folder.treeNodeId, sourcePath: "source-repo/a.md", title: "Source A", markdown: "source",
    });
    const publication = await fixture.createPublication({
      name: "Reconcile Source", kind: "FOLDER", creator: fixture.mike,
      origin: { kind: "FOLDER", folderNodeId: folder.treeNodeId },
    });
    await reconcile(publication.publication.id, publication.contributionId, mikeJudge());
    expect(await publicationDocuments(publication.publication.id)).toHaveLength(1);

    await fixture.uow.run((repositories) =>
      repositories.sources.updateStatus(sourceId, "ARCHIVED", fixture.mike.identity.id));
    const result = await reconcile(publication.publication.id, publication.contributionId, mikeJudge());

    expect(result.report.archived).toBe(1);
    const [team] = await publicationDocuments(publication.publication.id);
    expect(team.currentOriginalDocumentId).toBe(original.documentId);
    expect(await documentStatus(team.teamDocumentId)).toBe("ARCHIVED");
  });

  it("places a Hub original by its personal folder names and prunes empty folders", async () => {
    const hub = hubCommands();
    const root = await hub.createFolder(fixture.mike, {
      sourceId: fixture.mikeHubSourceId, parentId: null, name: "hub-tree",
    });
    const deep = await hub.createFolder(fixture.mike, {
      sourceId: fixture.mikeHubSourceId, parentId: root.treeNodeId, name: "deep",
    });
    const note = await hub.createDocument(fixture.mike, {
      sourceId: fixture.mikeHubSourceId, parentId: deep.treeNodeId, title: "Hub note", markdown: "hub", metadata: {},
    });
    const publication = await fixture.createPublication({
      name: "Reconcile Hub Tree", kind: "FOLDER", creator: fixture.mike,
      origin: { kind: "FOLDER", folderNodeId: root.treeNodeId },
    });
    await reconcile(publication.publication.id, publication.contributionId, mikeJudge());
    const [team] = await publicationDocuments(publication.publication.id);
    expect(team.sourcePath).toBeNull();
    expect(await folderNamesOf(publication.sourceId, team.teamDocumentId)).toEqual(["deep"]);
    expect(await folderStatus(publication.sourceId, null, "deep")).toBe("ACTIVE");

    await hub.moveTreeNode(fixture.mike, { nodeId: note.treeNodeId, newParentId: root.treeNodeId, newPosition: 0 });
    await reconcile(publication.publication.id, publication.contributionId, mikeJudge());
    expect(await folderNamesOf(publication.sourceId, team.teamDocumentId)).toEqual([]);
    expect(await folderStatus(publication.sourceId, null, "deep")).toBe("ARCHIVED");
  });

  it("applies for a group-only contributor with their caller and stays pending without one", async () => {
    const folder = await fixture.createFolder(fixture.ann, "ann-reconcile/group", "group");
    await fixture.createSyncedOriginal(fixture.ann, {
      parentId: folder.treeNodeId, sourcePath: "ann-reconcile/group/a.md", title: "Group A", markdown: "group",
    });
    const publication = await fixture.createPublication({
      teamWorkspaceId: fixture.groupTeamWorkspaceId,
      name: "Reconcile Group",
      kind: "FOLDER",
      creator: fixture.ann,
      origin: { kind: "FOLDER", folderNodeId: folder.treeNodeId },
    });

    const pending = await reconcile(publication.publication.id, publication.contributionId, NO_CALLER);
    expect(pending.state).toBe("PENDING");
    expect(await publicationDocuments(publication.publication.id)).toHaveLength(0);
    const pendingContribution = await fixture.uow.run((repositories) =>
      repositories.publications.listContributions(publication.publication.id));
    expect(pendingContribution[0].pendingCatchUp).toBe(true);

    const applied = await reconcile(publication.publication.id, publication.contributionId, annJudge());
    expect(applied.state).toBe("APPLIED");
    expect(applied.report.created).toBe(1);
    expect(await publicationDocuments(publication.publication.id)).toHaveLength(1);
    const contribution = await fixture.uow.run((repositories) =>
      repositories.publications.listContributions(publication.publication.id));
    expect(contribution[0].pendingCatchUp).toBe(false);
  });

  it("freezes lost rights and only the contributor's own caller unfreezes and reconciles", async () => {
    const annFolder = await fixture.createFolder(fixture.ann, "ann-reconcile/freeze", "freeze");
    await fixture.createSyncedOriginal(fixture.ann, {
      parentId: annFolder.treeNodeId, sourcePath: "ann-reconcile/freeze/a.md", title: "Frozen A", markdown: "frozen",
    });
    const publication = await fixture.createPublication({
      name: "Reconcile Freeze", kind: "FOLDER", creator: fixture.mike,
      origin: { kind: "FOLDER", folderNodeId: annFolder.treeNodeId },
    });
    const annContributionId = await addAnnContribution(publication, { kind: "FOLDER", folderNodeId: annFolder.treeNodeId });

    await fixture.uow.run((repositories) =>
      repositories.workspaceMemberships.remove(fixture.teamWorkspaceId, fixture.ann.identity.id));
    const frozen = await reconcile(publication.publication.id, annContributionId, annJudge());
    expect(frozen.state).toBe("FROZEN");
    expect(await publicationDocuments(publication.publication.id)).toHaveLength(0);
    const frozenContribution = (await fixture.uow.run((repositories) =>
      repositories.publications.listContributions(publication.publication.id)))
      .find((contribution) => contribution.id === annContributionId)!;
    expect(frozenContribution.rightsFrozenAt).not.toBeNull();

    await fixture.uow.run((repositories) => repositories.workspaceMemberships.insert(createDirectMembership({
      workspaceId: fixture.teamWorkspaceId,
      userId: fixture.ann.identity.id,
      role: "EDITOR",
      now: new Date(),
    })));
    const stillFrozen = await reconcile(publication.publication.id, annContributionId, NO_CALLER);
    expect(stillFrozen.state).toBe("PENDING");
    expect(await publicationDocuments(publication.publication.id)).toHaveLength(0);
    const afterNoCaller = (await fixture.uow.run((repositories) =>
      repositories.publications.listContributions(publication.publication.id)))
      .find((contribution) => contribution.id === annContributionId)!;
    expect(afterNoCaller.rightsFrozenAt).toEqual(frozenContribution.rightsFrozenAt);

    const unfrozen = await reconcile(publication.publication.id, annContributionId, annJudge());
    expect(unfrozen.state).toBe("APPLIED");
    expect(unfrozen.report.created).toBe(1);
    expect(await publicationDocuments(publication.publication.id)).toHaveLength(1);
    const after = (await fixture.uow.run((repositories) =>
      repositories.publications.listContributions(publication.publication.id)))
      .find((contribution) => contribution.id === annContributionId)!;
    expect(after.rightsFrozenAt).toBeNull();
    expect(after.pendingCatchUp).toBe(false);
  });

  it("refuses a caller reconciling another contributor's originals", async () => {
    const mikeFolder = await fixture.createFolder(fixture.mike, "reconcile/wrong-caller", "wrong-caller");
    const publication = await fixture.createPublication({
      name: "Reconcile Wrong Caller", kind: "FOLDER", creator: fixture.mike,
      origin: { kind: "FOLDER", folderNodeId: mikeFolder.treeNodeId },
    });
    const annFolder = await fixture.createFolder(fixture.ann, "ann-reconcile/wrong-caller", "wrong-caller");
    await fixture.createSyncedOriginal(fixture.ann, {
      parentId: annFolder.treeNodeId, sourcePath: "ann-reconcile/wrong-caller/a.md", title: "Ann A", markdown: "ann",
    });
    const annContributionId = await addAnnContribution(publication, { kind: "FOLDER", folderNodeId: annFolder.treeNodeId });

    await expect(reconcile(publication.publication.id, annContributionId, mikeJudge()))
      .rejects.toMatchObject({ code: "WORKSPACE_ACCESS_DENIED" });
    expect(await publicationDocuments(publication.publication.id)).toHaveLength(0);
    const contribution = (await fixture.uow.run((repositories) =>
      repositories.publications.listContributions(publication.publication.id)))
      .find((candidate) => candidate.id === annContributionId)!;
    expect(contribution.rightsFrozenAt).toBeNull();
  });

  it("follows a single-document publication through archive, restore and a move", async () => {
    const original = await fixture.createHubOriginal(fixture.mike, "Single note", "single");
    const publication = await fixture.createPublication({
      name: "Reconcile Single", kind: "DOCUMENT", creator: fixture.mike,
      origin: { kind: "DOCUMENT", documentId: original.documentId },
    });
    const first = await reconcile(publication.publication.id, publication.contributionId, mikeJudge());
    expect(first.report.created).toBe(1);
    const [team] = await publicationDocuments(publication.publication.id);
    expect(team.sourcePath).toBeNull();
    expect(team.currentOriginalDocumentId).toBe(original.documentId);

    const hub = hubCommands();
    await hub.archiveDocument(fixture.mike, original.documentId);
    const archived = await reconcile(publication.publication.id, publication.contributionId, mikeJudge());
    expect(archived.report.archived).toBe(1);
    expect(await documentStatus(team.teamDocumentId)).toBe("ARCHIVED");

    await hub.restoreDocument(fixture.mike, original.documentId);
    const restored = await reconcile(publication.publication.id, publication.contributionId, mikeJudge());
    expect(restored.report.restored).toBe(1);
    expect(await documentStatus(team.teamDocumentId)).toBe("ACTIVE");

    // A single document does not have to stay in its original folder.
    const folder = await hub.createFolder(fixture.mike, {
      sourceId: fixture.mikeHubSourceId, parentId: null, name: "single-moved",
    });
    await hub.moveTreeNode(fixture.mike, { nodeId: original.treeNodeId, newParentId: folder.treeNodeId, newPosition: 0 });
    const moved = await reconcile(publication.publication.id, publication.contributionId, mikeJudge());
    expect(moved.report.archived).toBe(0);
    expect((await publicationDocuments(publication.publication.id))[0].teamDocumentId).toBe(team.teamDocumentId);
    expect(await documentStatus(team.teamDocumentId)).toBe("ACTIVE");
  });

  it("reconciles a direct contributor without a caller", async () => {
    const folder = await fixture.createFolder(fixture.ann, "ann-reconcile/direct", "direct");
    await fixture.createSyncedOriginal(fixture.ann, {
      parentId: folder.treeNodeId, sourcePath: "ann-reconcile/direct/a.md", title: "Direct A", markdown: "direct",
    });
    const publication = await fixture.createPublication({
      name: "Reconcile Direct", kind: "FOLDER", creator: fixture.mike,
      origin: { kind: "FOLDER", folderNodeId: folder.treeNodeId },
    });
    const annContributionId = await addAnnContribution(publication, { kind: "FOLDER", folderNodeId: folder.treeNodeId });

    // Ann holds a direct EDITOR row in the direct team, so catch-up applies.
    const result = await reconcile(publication.publication.id, annContributionId, NO_CALLER);
    expect(result.state).toBe("APPLIED");
    expect(result.report.created).toBe(1);
    expect(await publicationDocuments(publication.publication.id)).toHaveLength(1);
    const contribution = (await fixture.uow.run((repositories) =>
      repositories.publications.listContributions(publication.publication.id)))
      .find((candidate) => candidate.id === annContributionId)!;
    expect(contribution.rightsFrozenAt).toBeNull();
    expect(contribution.pendingCatchUp).toBe(false);
  });

  it("does not start a contribution that has left", async () => {
    const folder = await fixture.createFolder(fixture.mike, "reconcile/left", "left");
    await fixture.createSyncedOriginal(fixture.mike, {
      parentId: folder.treeNodeId, sourcePath: "reconcile/left/a.md", title: "Left A", markdown: "left",
    });
    const publication = await fixture.createPublication({
      name: "Reconcile Left", kind: "FOLDER", creator: fixture.mike,
      origin: { kind: "FOLDER", folderNodeId: folder.treeNodeId },
    });
    const leftAt = new Date();
    await fixture.uow.run((repositories) => repositories.publications.setContributionState(publication.contributionId, {
      leftAt, rightsFrozenAt: null, pendingCatchUp: false,
    }));

    const callerResult = await reconcile(publication.publication.id, publication.contributionId, mikeJudge());
    const workerResult = await reconcile(publication.publication.id, publication.contributionId, NO_CALLER);
    expect(callerResult.state).toBe("SKIPPED");
    expect(workerResult.state).toBe("SKIPPED");
    expect(callerResult.report).toEqual({ created: 0, updated: 0, moved: 0, archived: 0, restored: 0, notices: [] });
    expect(await publicationDocuments(publication.publication.id)).toHaveLength(0);
    const contribution = await fixture.uow.run((repositories) =>
      repositories.publications.listContributions(publication.publication.id));
    expect(contribution[0].leftAt).toEqual(leftAt);
    expect(contribution[0].rightsFrozenAt).toBeNull();
  });

  it("skips an archived publication", async () => {
    const folder = await fixture.createFolder(fixture.mike, "reconcile/archived", "archived");
    await fixture.createSyncedOriginal(fixture.mike, {
      parentId: folder.treeNodeId, sourcePath: "reconcile/archived/a.md", title: "Archived A", markdown: "archived",
    });
    const publication = await fixture.createPublication({
      name: "Reconcile Archived Pub", kind: "FOLDER", creator: fixture.mike,
      origin: { kind: "FOLDER", folderNodeId: folder.treeNodeId },
    });
    await fixture.uow.run((repositories) =>
      repositories.publications.setPublicationStatus(publication.publication.id, "ARCHIVED", fixture.mike.identity.id));

    const result = await reconcile(publication.publication.id, publication.contributionId, mikeJudge());
    expect(result.state).toBe("SKIPPED");
    expect(await publicationDocuments(publication.publication.id)).toHaveLength(0);
  });
});
