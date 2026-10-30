import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import type { CallerContext } from "@/modules/identity/domain/caller-context";
import { drainPublicationEvents } from "@/modules/sources/application/publication-drain";
import { reconcileContribution } from "@/modules/sources/application/publication-reconciler";
import { PublicationService } from "@/modules/sources/application/publication-service";
import { SourceApplicationService } from "@/modules/sources/application/source-version-guard";
import { bindSourceProjection } from "@/modules/sources/application/source-knowledge-projection-service";
import { updateSourceLocator } from "@/modules/sources/application/source-entry-mapping-service";
import { catchUpExitCode, catchUpPublications } from "../../scripts/db/catch-up-publications";
import { createPublicationFixture, type PublicationFixture } from "../fixtures/publications";

let fixture: PublicationFixture;
let service: PublicationService;
let sequence = 0;

function unique(prefix: string): string {
  sequence += 1;
  return `${prefix}-${sequence}`;
}

beforeAll(async () => {
  fixture = await createPublicationFixture();
  service = new PublicationService(fixture.uow);
});
afterAll(async () => {
  await fixture.dispose();
});
afterEach(() => {
  process.env.KM_TEAM_WORKSPACES_ENABLED = "true";
});

function setFlag(enabled: boolean): void {
  process.env.KM_TEAM_WORKSPACES_ENABLED = enabled ? "true" : "false";
}

async function runCatchUp() {
  const lines: string[] = [];
  const result = await catchUpPublications(fixture.pool, { log: (line) => lines.push(line) });
  return { result, output: lines.join("\n") };
}

function summaryLineOf(output: string): string {
  return output
    .split("\n")
    .filter((line) => line.startsWith("Publication catch-up:"))
    .at(-1) ?? "";
}

async function createFolderTree(
  caller: CallerContext,
  label: string,
  documents: readonly { relative: string; title: string; markdown: string }[],
): Promise<{ folderNodeId: string; root: string; documents: { documentId: string; revisionId: string }[] }> {
  const root = `repos/${label}`;
  const folder = await fixture.createFolder(caller, root, label);
  const created: { documentId: string; revisionId: string }[] = [];
  for (const document of documents) {
    created.push(await fixture.createSyncedOriginal(caller, {
      parentId: folder.treeNodeId,
      sourcePath: `${root}/${document.relative}`,
      title: document.title,
      markdown: document.markdown,
    }));
  }
  return { folderNodeId: folder.treeNodeId, root, documents: created };
}

function folderSourceOf(caller: CallerContext): string {
  return caller.identity.id === fixture.mike.identity.id ? fixture.mikeFolderSourceId : fixture.annFolderSourceId;
}

function workspaceOf(caller: CallerContext): string {
  return caller.identity.id === fixture.mike.identity.id ? fixture.mikePersonalWorkspaceId : fixture.annPersonalWorkspaceId;
}

async function reviseOriginal(
  caller: CallerContext,
  original: { documentId: string; revisionId: string },
  title: string,
  markdown: string,
): Promise<void> {
  await fixture.uow.run(async (repositories) => {
    const projection = bindSourceProjection(repositories, {
      id: folderSourceOf(caller),
      workspaceId: workspaceOf(caller),
    });
    await projection.projectRevision(caller, {
      documentId: original.documentId,
      expectedCurrentRevisionId: original.revisionId,
      title,
      markdown,
      metadata: {},
    });
  });
}

async function renameOriginalPath(
  caller: CallerContext,
  documentId: string,
  sourcePath: string,
): Promise<void> {
  await fixture.uow.run(async (repositories) => {
    const entry = await repositories.entries.findByDocumentId(documentId);
    if (!entry) throw new Error("The original has no source entry.");
    await updateSourceLocator(repositories, caller, folderSourceOf(caller), entry.id, sourcePath, entry.contentHash);
  });
}

async function archiveOriginal(caller: CallerContext, documentId: string): Promise<void> {
  await fixture.uow.run(async (repositories) => {
    const projection = bindSourceProjection(repositories, {
      id: folderSourceOf(caller),
      workspaceId: workspaceOf(caller),
    });
    await projection.archiveProjectedDocument(caller, documentId);
  });
}

async function createNewOriginal(
  caller: CallerContext,
  folderNodeId: string,
  sourcePath: string,
  title: string,
  markdown: string,
): Promise<{ documentId: string; revisionId: string }> {
  return fixture.createSyncedOriginal(caller, {
    parentId: folderNodeId,
    sourcePath,
    title,
    markdown,
  });
}

async function listDocuments(publicationId: string) {
  return fixture.uow.run((repositories) => repositories.publications.listDocuments(publicationId));
}

async function documentStatus(documentId: string): Promise<string> {
  const rows = await fixture.pool.query<{ status: string }[]>(
    "SELECT status FROM knowledge_documents WHERE id = ?",
    [documentId],
  );
  return String(rows[0]?.status);
}

async function currentTitle(documentId: string): Promise<string | undefined> {
  const rows = await fixture.pool.query<{ title: string }[]>(
    `SELECT r.title FROM knowledge_documents d
     JOIN knowledge_revisions r ON r.id = d.current_revision_id
     WHERE d.id = ?`,
    [documentId],
  );
  return rows[0]?.title;
}

async function sourceStatus(sourceId: string): Promise<string> {
  const rows = await fixture.pool.query<{ status: string }[]>(
    "SELECT status FROM knowledge_sources WHERE id = ?",
    [sourceId],
  );
  return String(rows[0]?.status);
}

async function contributionOf(publicationId: string, userId: string) {
  const contributions = await fixture.uow.run((repositories) =>
    repositories.publications.listContributions(publicationId));
  return contributions.find((contribution) => contribution.userId === userId);
}

async function databaseSnapshot(pool: Pool): Promise<Record<string, number>> {
  const [row] = await pool.query<Record<string, unknown>[]>(
    `SELECT
       (SELECT COUNT(*) FROM knowledge_sources) AS sources,
       (SELECT COUNT(*) FROM publications) AS publications,
       (SELECT COUNT(*) FROM publication_contributors) AS contributions,
       (SELECT COUNT(*) FROM publication_documents) AS publication_documents,
       (SELECT COUNT(*) FROM publication_bindings) AS bindings,
       (SELECT COUNT(*) FROM knowledge_revisions) AS revisions,
       (SELECT COUNT(*) FROM publication_events WHERE consumed_at IS NULL) AS unconsumed_events`,
  );
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)]));
}

function documentForOriginal(
  documents: Awaited<ReturnType<typeof listDocuments>>,
  originalDocumentId: string,
) {
  return documents.find((document) => document.currentOriginalDocumentId === originalDocumentId);
}

describe("publication catch-up: flag off", () => {
  it("prints skipped and writes nothing", async () => {
    const tree = await createFolderTree(fixture.mike, unique("catchup-off"), [
      { relative: "a.md", title: "Catch-up Off A", markdown: "a" },
    ]);
    await service.publish(fixture.mike, {
      teamWorkspaceId: fixture.teamWorkspaceId,
      name: unique("Catch-up Off Publication"),
      origin: { kind: "FOLDER", folderNodeId: tree.folderNodeId },
    });

    setFlag(false);
    const before = await databaseSnapshot(fixture.pool);
    const { result, output } = await runCatchUp();

    expect(result.status).toBe("SKIPPED");
    expect(output).toContain("skipped");
    expect(await databaseSnapshot(fixture.pool)).toEqual(before);
  });
});

describe("publication catch-up: flag on", () => {
  it("reflects new originals, content, moves and archives", async () => {
    const tree = await createFolderTree(fixture.mike, unique("catchup-changes"), [
      { relative: "a.md", title: "Catch-up A", markdown: "one" },
      { relative: "c.md", title: "Catch-up C", markdown: "c" },
    ]);
    const published = await service.publish(fixture.mike, {
      teamWorkspaceId: fixture.teamWorkspaceId,
      name: unique("Catch-up Changes Publication"),
      origin: { kind: "FOLDER", folderNodeId: tree.folderNodeId },
    });
    const [a, c] = tree.documents;
    const initial = await listDocuments(published.publicationId);
    expect(initial).toHaveLength(2);

    setFlag(false);
    await reviseOriginal(fixture.mike, a, "Catch-up A v2", "two");
    await renameOriginalPath(fixture.mike, a.documentId, `${tree.root}/moved-a.md`);
    const added = await createNewOriginal(
      fixture.mike, tree.folderNodeId, `${tree.root}/b.md`, "Catch-up B", "b");
    await archiveOriginal(fixture.mike, c.documentId);

    setFlag(true);
    const { result } = await runCatchUp();
    expect(result.status).toBe("RAN");
    if (result.status !== "RAN") throw new Error("catch-up did not run");
    expect(result.failed).toBe(0);
    expect(result.applied).toBeGreaterThanOrEqual(1);

    const documents = await listDocuments(published.publicationId);
    const movedA = documentForOriginal(documents, a.documentId);
    expect(movedA?.sourcePath).toBe("moved-a.md");
    expect(await currentTitle(movedA!.teamDocumentId)).toBe("Catch-up A v2");
    const newB = documentForOriginal(documents, added.documentId);
    expect(newB?.sourcePath).toBe("b.md");
    const archivedC = documentForOriginal(documents, c.documentId);
    expect(await documentStatus(archivedC!.teamDocumentId)).toBe("ARCHIVED");

    // A rerun is safe and does not duplicate team documents.
    const again = await runCatchUp();
    expect(again.result.status).toBe("RAN");
    if (again.result.status !== "RAN") throw new Error("catch-up did not rerun");
    expect(again.result.failed).toBe(0);
    expect(await listDocuments(published.publicationId)).toHaveLength(documents.length);
  });

  it("archives team copies after the personal source is archived", async () => {
    const tree = await createFolderTree(fixture.mike, unique("catchup-source"), [
      { relative: "a.md", title: "Source Archive A", markdown: "a" },
    ]);
    const published = await service.publish(fixture.mike, {
      teamWorkspaceId: fixture.teamWorkspaceId,
      name: unique("Catch-up Source Publication"),
      origin: { kind: "FOLDER", folderNodeId: tree.folderNodeId },
    });
    const [teamDocument] = await listDocuments(published.publicationId);

    const sources = new SourceApplicationService(fixture.uow);
    setFlag(false);
    await sources.archiveSource(fixture.mike, fixture.mikeFolderSourceId);

    setFlag(true);
    const { result } = await runCatchUp();
    expect(result.status).toBe("RAN");
    if (result.status !== "RAN") throw new Error("catch-up did not run");
    expect(result.failed).toBe(0);
    expect(await documentStatus(teamDocument.teamDocumentId)).toBe("ARCHIVED");

    // Leave the shared fixture source usable for any later test.
    await sources.restoreSource(fixture.mike, fixture.mikeFolderSourceId);
  });

  it("preserves a left contributor's documents and contribution state", async () => {
    const mikeTree = await createFolderTree(fixture.mike, unique("catchup-left-mike"), [
      { relative: "a.md", title: "Left Mike A", markdown: "a" },
    ]);
    const published = await service.publish(fixture.mike, {
      teamWorkspaceId: fixture.teamWorkspaceId,
      name: unique("Catch-up Left Publication"),
      origin: { kind: "FOLDER", folderNodeId: mikeTree.folderNodeId },
    });
    const annTree = await createFolderTree(fixture.ann, unique("catchup-left-ann"), [
      { relative: "ann.md", title: "Left Ann", markdown: "ann" },
    ]);
    await service.join(fixture.ann, {
      publicationId: published.publicationId,
      folderNodeId: annTree.folderNodeId,
      acknowledgeLowOverlap: true,
    });
    const annDocument = documentForOriginal(
      await listDocuments(published.publicationId), annTree.documents[0].documentId);
    await service.leave(fixture.ann, published.publicationId);

    setFlag(false);
    await reviseOriginal(fixture.ann, annTree.documents[0], "Left Ann v2", "ann two");
    setFlag(true);
    const { result } = await runCatchUp();
    expect(result.status).toBe("RAN");
    if (result.status !== "RAN") throw new Error("catch-up did not run");

    expect(await currentTitle(annDocument!.teamDocumentId)).toBe("Left Ann");
    const contribution = await contributionOf(published.publicationId, fixture.ann.identity.id);
    expect(contribution?.leftAt).not.toBeNull();
  });

  it("never clears a rights freeze", async () => {
    const tree = await createFolderTree(fixture.mike, unique("catchup-frozen"), [
      { relative: "a.md", title: "Frozen A", markdown: "a" },
    ]);
    const published = await service.publish(fixture.mike, {
      teamWorkspaceId: fixture.teamWorkspaceId,
      name: unique("Catch-up Frozen Publication"),
      origin: { kind: "FOLDER", folderNodeId: tree.folderNodeId },
    });
    const [teamDocument] = await listDocuments(published.publicationId);
    const contribution = await contributionOf(published.publicationId, fixture.mike.identity.id);
    const frozenAt = new Date();
    await fixture.uow.run((repositories) =>
      repositories.publications.setContributionState(contribution!.id, {
        leftAt: null,
        rightsFrozenAt: frozenAt,
        pendingCatchUp: false,
      }));

    setFlag(false);
    await reviseOriginal(fixture.mike, tree.documents[0], "Frozen A v2", "two");
    setFlag(true);
    const { result } = await runCatchUp();
    expect(result.status).toBe("RAN");
    if (result.status !== "RAN") throw new Error("catch-up did not run");

    expect(await currentTitle(teamDocument.teamDocumentId)).toBe("Frozen A");
    const after = await contributionOf(published.publicationId, fixture.mike.identity.id);
    expect(after?.rightsFrozenAt?.getTime()).toBe(frozenAt.getTime());
  });

  it("does not restore an unpublished publication", async () => {
    const tree = await createFolderTree(fixture.mike, unique("catchup-unpublished"), [
      { relative: "a.md", title: "Unpublished A", markdown: "a" },
    ]);
    const published = await service.publish(fixture.mike, {
      teamWorkspaceId: fixture.teamWorkspaceId,
      name: unique("Catch-up Unpublished Publication"),
      origin: { kind: "FOLDER", folderNodeId: tree.folderNodeId },
    });
    const [teamDocument] = await listDocuments(published.publicationId);
    const publication = await fixture.uow.run((repositories) =>
      repositories.publications.findById(published.publicationId));
    await service.unpublish(fixture.mike, published.publicationId);

    setFlag(false);
    await reviseOriginal(fixture.mike, tree.documents[0], "Unpublished A v2", "two");
    setFlag(true);
    const { result } = await runCatchUp();
    expect(result.status).toBe("RAN");
    if (result.status !== "RAN") throw new Error("catch-up did not run");

    expect(await sourceStatus(publication!.sourceId)).toBe("ARCHIVED");
    expect(await currentTitle(teamDocument.teamDocumentId)).toBe("Unpublished A");
  });

  it("leaves group-only contributors pending until their own caller syncs", async () => {
    const mikeTree = await createFolderTree(fixture.mike, unique("catchup-group-mike"), [
      { relative: "a.md", title: "Group Mike A", markdown: "a" },
    ]);
    const published = await service.publish(fixture.mike, {
      teamWorkspaceId: fixture.groupTeamWorkspaceId,
      name: unique("Catch-up Group Publication"),
      origin: { kind: "FOLDER", folderNodeId: mikeTree.folderNodeId },
    });
    const annTree = await createFolderTree(fixture.ann, unique("catchup-group-ann"), [
      { relative: "c.md", title: "Group Ann C", markdown: "ann" },
    ]);
    await service.join(fixture.ann, {
      publicationId: published.publicationId,
      folderNodeId: annTree.folderNodeId,
      acknowledgeLowOverlap: true,
    });
    const annDocument = documentForOriginal(
      await listDocuments(published.publicationId), annTree.documents[0].documentId);

    setFlag(false);
    await reviseOriginal(fixture.ann, annTree.documents[0], "Group Ann C v2", "ann two");
    setFlag(true);
    const { result } = await runCatchUp();
    expect(result.status).toBe("RAN");
    if (result.status !== "RAN") throw new Error("catch-up did not run");
    expect(result.failed).toBe(0);
    expect(result.pending).toBeGreaterThanOrEqual(1);

    // No caller can judge her group-derived rights, so she stays pending and
    // unfrozen, and her team copy is untouched.
    expect(await currentTitle(annDocument!.teamDocumentId)).toBe("Group Ann C");
    const pending = await contributionOf(published.publicationId, fixture.ann.identity.id);
    expect(pending?.pendingCatchUp).toBe(true);
    expect(pending?.rightsFrozenAt).toBeNull();

    // Her own save/sync runs the same reconciliation with her validated groups.
    const drained = await drainPublicationEvents(fixture.uow, {
      judge: { kind: "CALLER", caller: fixture.ann },
    });
    expect(drained.failed).toBe(0);
    expect(drained.applied).toBeGreaterThanOrEqual(1);
    expect(await currentTitle(annDocument!.teamDocumentId)).toBe("Group Ann C v2");
    const resumed = await contributionOf(published.publicationId, fixture.ann.identity.id);
    expect(resumed?.pendingCatchUp).toBe(false);
  });

  it("reconciles from current state even when every event was already consumed", async () => {
    const tree = await createFolderTree(fixture.mike, unique("catchup-state-only"), [
      { relative: "a.md", title: "State Only A", markdown: "one" },
    ]);
    const published = await service.publish(fixture.mike, {
      teamWorkspaceId: fixture.teamWorkspaceId,
      name: unique("Catch-up State Only Publication"),
      origin: { kind: "FOLDER", folderNodeId: tree.folderNodeId },
    });
    const [teamDocument] = await listDocuments(published.publicationId);

    await reviseOriginal(fixture.mike, tree.documents[0], "State Only A v2", "two");
    // Simulate lost/consumed events: the event scan has nothing left pending,
    // so only the contribution scan can notice the revision.
    await fixture.pool.query(
      "UPDATE publication_events SET consumed_at = CURRENT_TIMESTAMP(6) WHERE consumed_at IS NULL AND document_id = ?",
      [tree.documents[0].documentId],
    );
    const pendingEvents = await fixture.pool.query<{ n: unknown }[]>(
      `SELECT COUNT(*) AS n FROM publication_events
       WHERE consumed_at IS NULL AND document_id = ?`,
      [tree.documents[0].documentId],
    );
    expect(Number(pendingEvents[0]?.n ?? 0)).toBe(0);

    setFlag(true);
    const { result, output } = await runCatchUp();
    expect(result.status).toBe("RAN");
    if (result.status !== "RAN") throw new Error("catch-up did not run");

    expect(await currentTitle(teamDocument.teamDocumentId)).toBe("State Only A v2");
    expect(result.failed).toBe(0);
    expect(result.applied).toBeGreaterThanOrEqual(1);
    expect(summaryLineOf(output)).toMatch(
      /^Publication catch-up: applied=\d+ pending=\d+ skipped=\d+ failed=\d+$/,
    );
    expect(summaryLineOf(output)).toContain(`failed=${result.failed}`);
  });

  it("exits 1 when a contribution fails and prints the summary line exactly", async () => {
    const tree = await createFolderTree(fixture.mike, unique("catchup-failure"), [
      { relative: "a.md", title: "Failure A", markdown: "a" },
    ]);
    await service.publish(fixture.mike, {
      teamWorkspaceId: fixture.teamWorkspaceId,
      name: unique("Catch-up Failure Publication"),
      origin: { kind: "FOLDER", folderNodeId: tree.folderNodeId },
    });
    const [target] = await fixture.uow.run((repositories) =>
      repositories.publications.listAllContributions());
    const lines: string[] = [];
    const forcedFailure = (
      repositories: Parameters<typeof reconcileContribution>[0],
      input: Parameters<typeof reconcileContribution>[1],
    ) => input.contributionId === target.contributionId
      ? Promise.reject(new Error("injected catch-up failure"))
      : reconcileContribution(repositories, input);

    setFlag(true);
    const result = await catchUpPublications(fixture.pool, {
      log: (line) => lines.push(line),
      reconcile: forcedFailure,
    });
    expect(result.status).toBe("RAN");
    if (result.status !== "RAN") throw new Error("catch-up did not run");
    expect(result.failed).toBe(1);
    expect(lines.at(-1)).toBe(
      `Publication catch-up: applied=${result.applied} pending=${result.pending} `
      + `skipped=${result.skipped} failed=${result.failed}`,
    );

    const exitCode = await catchUpExitCode(fixture.pool, {
      log: () => {},
      reconcile: forcedFailure,
    });
    expect(exitCode).toBe(1);
  });
});
