import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { CallerContext } from "@/modules/identity/domain/caller-context";
import { reconcileContribution } from "@/modules/sources/application/publication-reconciler";
import { PublicationService } from "@/modules/sources/application/publication-service";
import { bindSourceProjection } from "@/modules/sources/application/source-knowledge-projection-service";
import { TeamWorkspaceService } from "@/modules/workspaces/application/team-workspace-service";
import { createTeamWorkspaceInsert } from "@/modules/workspaces/domain/workspace";
import { createDirectMembership } from "@/modules/workspaces/domain/workspace-membership";
import { uuidv7 } from "@/shared/ids/uuidv7";
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

async function sourceStatus(sourceId: string): Promise<string> {
  const rows = await fixture.pool.query<{ status: string }[]>(
    "SELECT status FROM knowledge_sources WHERE id = ?",
    [sourceId],
  );
  return String(rows[0]?.status);
}

async function sourceName(sourceId: string): Promise<string> {
  const rows = await fixture.pool.query<{ name: string }[]>(
    "SELECT name FROM knowledge_sources WHERE id = ?",
    [sourceId],
  );
  return String(rows[0]?.name);
}

async function activeNameCount(teamWorkspaceId: string, name: string): Promise<number> {
  const rows = await fixture.pool.query<{ n: unknown }[]>(
    "SELECT COUNT(*) AS n FROM knowledge_sources WHERE workspace_id = ? AND active_publication_name = ?",
    [teamWorkspaceId, name],
  );
  return Number(rows[0]?.n ?? 0);
}

async function claimRows(publicationId: string): Promise<{ original_document_id: string; active_team_workspace_id: string | null }[]> {
  return fixture.pool.query(
    `SELECT b.original_document_id, b.active_team_workspace_id
     FROM publication_bindings b
     JOIN publication_contributors c ON c.id = b.contribution_id
     WHERE c.publication_id = ?
     ORDER BY b.original_document_id`,
    [publicationId],
  );
}

async function revisionCount(documentId: string): Promise<number> {
  const rows = await fixture.pool.query<{ n: unknown }[]>(
    "SELECT COUNT(*) AS n FROM knowledge_revisions WHERE document_id = ?",
    [documentId],
  );
  return Number(rows[0]?.n ?? 0);
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

async function discussionCount(documentId: string): Promise<number> {
  const rows = await fixture.pool.query<{ n: unknown }[]>(
    "SELECT COUNT(*) AS n FROM document_review_threads WHERE document_id = ?",
    [documentId],
  );
  return Number(rows[0]?.n ?? 0);
}

async function contributionOf(publicationId: string, userId: string) {
  const contributions = await fixture.uow.run((repositories) =>
    repositories.publications.listContributions(publicationId));
  return contributions.find((contribution) => contribution.userId === userId);
}

async function createTeamWithRoles(
  label: string,
  members: readonly { userId: string; role: "OWNER" | "ADMIN" | "EDITOR" | "VIEWER" }[],
  groupMapping?: { externalGroupId: string; role: "ADMIN" | "EDITOR" | "VIEWER" },
): Promise<string> {
  const workspaceId = uuidv7();
  const now = new Date();
  await fixture.uow.run(async (repositories) => {
    await repositories.workspaces.insert(createTeamWorkspaceInsert({
      id: workspaceId, name: unique(label), createdBy: fixture.mike.identity.id, now,
    }));
    for (const member of members) {
      await repositories.workspaceMemberships.insert(createDirectMembership({
        workspaceId, userId: member.userId, role: member.role, now,
      }));
    }
    if (groupMapping) {
      await repositories.groupMappings.insert({
        id: uuidv7(),
        workspaceId,
        externalGroupId: groupMapping.externalGroupId,
        role: groupMapping.role,
        createdBy: fixture.mike.identity.id,
        createdAt: now,
        updatedAt: now,
      });
    }
  });
  return workspaceId;
}

describe("publication lifecycle: unpublish", () => {
  it("archives the whole source, frees its name and claims, and keeps documents, threads and paths", async () => {
    const tree = await createFolderTree(fixture.mike, unique("unpublish"), [
      { relative: "a.md", title: "Unpublish A", markdown: "a" },
      { relative: "nested/b.md", title: "Unpublish B", markdown: "b" },
    ]);
    const name = unique("Unpublish Publication");
    const published = await service.publish(fixture.mike, {
      teamWorkspaceId: fixture.teamWorkspaceId,
      name,
      origin: { kind: "FOLDER", folderNodeId: tree.folderNodeId },
    });

    const publication = await fixture.uow.run((repositories) =>
      repositories.publications.findById(published.publicationId));
    const documents = await fixture.uow.run((repositories) =>
      repositories.publications.listDocuments(published.publicationId));
    expect(documents).toHaveLength(2);
    const discussion = await fixture.createDiscussion({
      workspaceId: fixture.teamWorkspaceId,
      documentId: documents[0].teamDocumentId,
      revisionId: await fixture.revisionIdOf(documents[0].teamDocumentId),
      authorId: fixture.mike.identity.id,
    });

    await service.unpublish(fixture.mike, published.publicationId);

    expect(await sourceStatus(publication!.sourceId)).toBe("ARCHIVED");
    expect((await fixture.uow.run((repositories) =>
      repositories.publications.findById(published.publicationId)))?.status).toBe("ARCHIVED");
    expect(await activeNameCount(fixture.teamWorkspaceId, name)).toBe(0);
    expect((await claimRows(published.publicationId)).every((row) => row.active_team_workspace_id === null)).toBe(true);

    // Documents, path reservations, bindings and discussion threads survive
    // the lifecycle change; only the source gates visibility.
    expect(await documentStatus(documents[0].teamDocumentId)).toBe("ACTIVE");
    const kept = await fixture.uow.run((repositories) =>
      repositories.publications.listDocuments(published.publicationId));
    expect(kept.map((document) => document.sourcePath).sort()).toEqual(["a.md", "nested/b.md"]);
    expect(await claimRows(published.publicationId)).toHaveLength(2);
    expect(await discussionCount(documents[0].teamDocumentId)).toBe(1);
    expect(discussion.threadId).toBeTruthy();

    // The name is free again for another active publication.
    const replacementTree = await createFolderTree(fixture.mike, unique("unpublish-replacement"), [
      { relative: "x.md", title: "Replacement X", markdown: "x" },
    ]);
    const replacement = await service.publish(fixture.mike, {
      teamWorkspaceId: fixture.teamWorkspaceId,
      name,
      origin: { kind: "FOLDER", folderNodeId: replacementTree.folderNodeId },
    });
    expect(replacement.publicationId).not.toBe(published.publicationId);
    expect(await activeNameCount(fixture.teamWorkspaceId, name)).toBe(1);

    // A later save/catch-up never revives the archived publication.
    const [archivedContribution] = await fixture.uow.run((repositories) =>
      repositories.publications.listContributions(published.publicationId));
    const reconciled = await fixture.uow.run((repositories) => reconcileContribution(repositories, {
      publicationId: published.publicationId,
      contributionId: archivedContribution.id,
      judge: { kind: "NO_CALLER" },
      now: new Date(),
    }));
    expect(reconciled.state).toBe("SKIPPED");
    // The creator's own later save is skipped too: unpublish is sticky.
    const saved = await fixture.uow.run((repositories) => reconcileContribution(repositories, {
      publicationId: published.publicationId,
      contributionId: archivedContribution.id,
      judge: { kind: "CALLER", caller: fixture.mike },
      now: new Date(),
    }));
    expect(saved.state).toBe("SKIPPED");
    expect(await sourceStatus(publication!.sourceId)).toBe("ARCHIVED");
  });

  it("refuses a creator who left, and lets an admin unpublish", async () => {
    const tree = await createFolderTree(fixture.ann, unique("left-creator"), [
      { relative: "a.md", title: "Left A", markdown: "left" },
    ]);
    const published = await service.publish(fixture.ann, {
      teamWorkspaceId: fixture.teamWorkspaceId,
      name: unique("Left Creator Publication"),
      origin: { kind: "FOLDER", folderNodeId: tree.folderNodeId },
    });
    const publication = await fixture.uow.run((repositories) =>
      repositories.publications.findById(published.publicationId));

    await service.leave(fixture.ann, published.publicationId);
    await expect(service.unpublish(fixture.ann, published.publicationId))
      .rejects.toMatchObject({ code: "WORKSPACE_ACCESS_DENIED" });

    // Mike is the team's direct OWNER, so an admin keeps the right.
    await service.unpublish(fixture.mike, published.publicationId);
    expect(await sourceStatus(publication!.sourceId)).toBe("ARCHIVED");
  });

  it("accepts an effective group ADMIN who is not a direct member", async () => {
    const teamId = await createTeamWithRoles(
      "Group Admin Team",
      [{ userId: fixture.mike.identity.id, role: "OWNER" }],
      { externalGroupId: fixture.annExternalGroupId, role: "ADMIN" },
    );
    const tree = await createFolderTree(fixture.mike, unique("group-admin"), [
      { relative: "a.md", title: "Group Admin A", markdown: "group" },
    ]);
    const published = await service.publish(fixture.mike, {
      teamWorkspaceId: teamId,
      name: unique("Group Admin Publication"),
      origin: { kind: "FOLDER", folderNodeId: tree.folderNodeId },
    });
    const publication = await fixture.uow.run((repositories) =>
      repositories.publications.findById(published.publicationId));

    await service.unpublish(fixture.ann, published.publicationId);
    expect(await sourceStatus(publication!.sourceId)).toBe("ARCHIVED");
  });
});

describe("publication lifecycle: rename", () => {
  it("renames the canonical source without a new revision and ignores a duplicate active name", async () => {
    const tree = await createFolderTree(fixture.mike, unique("rename"), [
      { relative: "a.md", title: "Rename A", markdown: "a" },
    ]);
    const published = await service.publish(fixture.mike, {
      teamWorkspaceId: fixture.teamWorkspaceId,
      name: unique("Rename Publication"),
      origin: { kind: "FOLDER", folderNodeId: tree.folderNodeId },
    });
    const publication = await fixture.uow.run((repositories) =>
      repositories.publications.findById(published.publicationId));
    const [teamDocument] = await fixture.uow.run((repositories) =>
      repositories.publications.listDocuments(published.publicationId));
    const revisionsBefore = await revisionCount(teamDocument.teamDocumentId);

    // A joiner with source.manage is still not the publication creator.
    const annTree = await createFolderTree(fixture.ann, unique("rename-ann"), [
      { relative: "ann.md", title: "Rename Ann", markdown: "ann" },
    ]);
    await service.join(fixture.ann, {
      publicationId: published.publicationId,
      folderNodeId: annTree.folderNodeId,
      acknowledgeLowOverlap: true,
    });
    await expect(service.rename(fixture.ann, published.publicationId, unique("Ann Rename")))
      .rejects.toMatchObject({ code: "WORKSPACE_ACCESS_DENIED" });

    const renamed = unique("Renamed Publication");
    await service.rename(fixture.mike, published.publicationId, renamed);
    expect(await sourceName(publication!.sourceId)).toBe(renamed);
    expect((await fixture.uow.run((repositories) =>
      repositories.publications.findById(published.publicationId)))?.name).toBe(renamed);
    expect(await revisionCount(teamDocument.teamDocumentId)).toBe(revisionsBefore);
    expect(await currentTitle(teamDocument.teamDocumentId)).toBe("Rename A");

    const otherTree = await createFolderTree(fixture.mike, unique("rename-other"), [
      { relative: "b.md", title: "Other B", markdown: "b" },
    ]);
    const other = await service.publish(fixture.mike, {
      teamWorkspaceId: fixture.teamWorkspaceId,
      name: unique("Other Publication"),
      origin: { kind: "FOLDER", folderNodeId: otherTree.folderNodeId },
    });
    await expect(service.rename(fixture.mike, other.publicationId, renamed))
      .rejects.toMatchObject({ code: "PUBLICATION_NAME_TAKEN" });
    await expect(service.rename(fixture.mike, other.publicationId, renamed))
      .rejects.toThrow("已有同名發佈，請取一個能說明內容的名字");
  });

  it("lets an admin rename another creator's publication", async () => {
    const teamId = await createTeamWithRoles("Rename Admin Team", [
      { userId: fixture.ann.identity.id, role: "OWNER" },
      { userId: fixture.mike.identity.id, role: "EDITOR" },
    ]);
    const tree = await createFolderTree(fixture.mike, unique("rename-admin"), [
      { relative: "a.md", title: "Admin Rename A", markdown: "a" },
    ]);
    const published = await service.publish(fixture.mike, {
      teamWorkspaceId: teamId,
      name: unique("Admin Rename Publication"),
      origin: { kind: "FOLDER", folderNodeId: tree.folderNodeId },
    });
    const publication = await fixture.uow.run((repositories) =>
      repositories.publications.findById(published.publicationId));

    await service.rename(fixture.ann, published.publicationId, unique("Admin Renamed"));
    expect(await sourceName(publication!.sourceId)).toContain("Admin Renamed");
  });

  it("maps a lost concurrent rename race to PUBLICATION_NAME_TAKEN", async () => {
    const firstTree = await createFolderTree(fixture.mike, unique("rename-race-a"), [
      { relative: "a.md", title: "Rename Race A", markdown: "a" },
    ]);
    const secondTree = await createFolderTree(fixture.mike, unique("rename-race-b"), [
      { relative: "b.md", title: "Rename Race B", markdown: "b" },
    ]);
    const first = await service.publish(fixture.mike, {
      teamWorkspaceId: fixture.teamWorkspaceId,
      name: unique("Rename Race First"),
      origin: { kind: "FOLDER", folderNodeId: firstTree.folderNodeId },
    });
    const second = await service.publish(fixture.mike, {
      teamWorkspaceId: fixture.teamWorkspaceId,
      name: unique("Rename Race Second"),
      origin: { kind: "FOLDER", folderNodeId: secondTree.folderNodeId },
    });
    const target = unique("Rename Race Target");

    const outcomes = await Promise.allSettled([
      service.rename(fixture.mike, first.publicationId, target),
      service.rename(fixture.mike, second.publicationId, target),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.filter((outcome) => outcome.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason)
      .toMatchObject({ code: "PUBLICATION_NAME_TAKEN" });
    expect(await activeNameCount(fixture.teamWorkspaceId, target)).toBe(1);
  });

  it("maps a publish and rename racing for the same free name", async () => {
    const existingTree = await createFolderTree(fixture.mike, unique("publish-rename-existing"), [
      { relative: "a.md", title: "Publish Rename Existing", markdown: "a" },
    ]);
    const existing = await service.publish(fixture.mike, {
      teamWorkspaceId: fixture.teamWorkspaceId,
      name: unique("Publish Rename Existing Publication"),
      origin: { kind: "FOLDER", folderNodeId: existingTree.folderNodeId },
    });
    const freshTree = await createFolderTree(fixture.mike, unique("publish-rename-fresh"), [
      { relative: "c.md", title: "Publish Rename Fresh", markdown: "c" },
    ]);
    const target = unique("Publish Rename Target");

    const outcomes = await Promise.allSettled([
      service.rename(fixture.mike, existing.publicationId, target),
      service.publish(fixture.mike, {
        teamWorkspaceId: fixture.teamWorkspaceId,
        name: target,
        origin: { kind: "FOLDER", folderNodeId: freshTree.folderNodeId },
      }),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.filter((outcome) => outcome.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason)
      .toMatchObject({ code: "PUBLICATION_NAME_TAKEN" });
    expect(await activeNameCount(fixture.teamWorkspaceId, target)).toBe(1);
  });
});

describe("publication lifecycle: restore", () => {
  it("rolls back the whole restore when another publication took the name", async () => {
    const firstTree = await createFolderTree(fixture.mike, unique("restore-name-first"), [
      { relative: "a.md", title: "Restore Name A", markdown: "a" },
    ]);
    const name = unique("Restore Name Publication");
    const first = await service.publish(fixture.mike, {
      teamWorkspaceId: fixture.teamWorkspaceId,
      name,
      origin: { kind: "FOLDER", folderNodeId: firstTree.folderNodeId },
    });
    const firstPublication = await fixture.uow.run((repositories) =>
      repositories.publications.findById(first.publicationId));

    await service.unpublish(fixture.mike, first.publicationId);
    const secondTree = await createFolderTree(fixture.mike, unique("restore-name-second"), [
      { relative: "b.md", title: "Restore Name B", markdown: "b" },
    ]);
    await service.publish(fixture.mike, {
      teamWorkspaceId: fixture.teamWorkspaceId,
      name,
      origin: { kind: "FOLDER", folderNodeId: secondTree.folderNodeId },
    });

    await expect(service.restore(fixture.mike, first.publicationId))
      .rejects.toMatchObject({ code: "PUBLICATION_NAME_TAKEN" });
    expect(await sourceStatus(firstPublication!.sourceId)).toBe("ARCHIVED");
    expect((await claimRows(first.publicationId)).every((row) => row.active_team_workspace_id === null)).toBe(true);
    expect(await activeNameCount(fixture.teamWorkspaceId, name)).toBe(1);
  });

  it("rolls back the whole restore when another publication took an original", async () => {
    const tree = await createFolderTree(fixture.mike, unique("restore-original"), [
      { relative: "a.md", title: "Restore Original A", markdown: "a" },
    ]);
    const first = await service.publish(fixture.mike, {
      teamWorkspaceId: fixture.teamWorkspaceId,
      name: unique("Restore Original Publication"),
      origin: { kind: "FOLDER", folderNodeId: tree.folderNodeId },
    });
    const firstPublication = await fixture.uow.run((repositories) =>
      repositories.publications.findById(first.publicationId));

    await service.unpublish(fixture.mike, first.publicationId);
    await service.publish(fixture.mike, {
      teamWorkspaceId: fixture.teamWorkspaceId,
      name: unique("Restore Original Holder"),
      origin: { kind: "DOCUMENT", documentId: tree.documents[0].documentId },
    });

    await expect(service.restore(fixture.mike, first.publicationId))
      .rejects.toMatchObject({
        code: "PUBLICATION_ORIGINAL_TAKEN",
        details: { originalDocumentId: tree.documents[0].documentId },
      });
    expect(await sourceStatus(firstPublication!.sourceId)).toBe("ARCHIVED");
    expect((await claimRows(first.publicationId)).every((row) => row.active_team_workspace_id === null)).toBe(true);
  });

  it("re-claims the name and originals, reconciles direct contributors and leaves group-only ones pending", async () => {
    const tree = await createFolderTree(fixture.mike, unique("restore-success"), [
      { relative: "a.md", title: "Restore Success A", markdown: "one" },
    ]);
    const name = unique("Restore Success Publication");
    const published = await service.publish(fixture.mike, {
      teamWorkspaceId: fixture.groupTeamWorkspaceId,
      name,
      origin: { kind: "FOLDER", folderNodeId: tree.folderNodeId },
    });
    const publication = await fixture.uow.run((repositories) =>
      repositories.publications.findById(published.publicationId));

    const annTree = await createFolderTree(fixture.ann, unique("restore-ann"), [
      { relative: "c.md", title: "Restore Ann C", markdown: "ann" },
    ]);
    await service.join(fixture.ann, {
      publicationId: published.publicationId,
      folderNodeId: annTree.folderNodeId,
      acknowledgeLowOverlap: true,
    });
    const mikeContribution = await contributionOf(published.publicationId, fixture.mike.identity.id);
    const annContribution = await contributionOf(published.publicationId, fixture.ann.identity.id);
    expect(mikeContribution).toBeDefined();
    expect(annContribution).toBeDefined();

    await service.unpublish(fixture.mike, published.publicationId);
    // A change made while unpublished is reconciled by the restore, not copied
    // from the caller who pressed restore.
    await fixture.uow.run(async (repositories) => {
      const source = await repositories.sources.findById(fixture.mikeFolderSourceId);
      const projection = bindSourceProjection(repositories, {
        id: fixture.mikeFolderSourceId,
        workspaceId: source!.workspaceId,
      });
      await projection.projectRevision(fixture.mike, {
        documentId: tree.documents[0].documentId,
        expectedCurrentRevisionId: tree.documents[0].revisionId,
        title: "Restore Success A v2",
        markdown: "two",
        metadata: {},
      });
    });

    await service.restore(fixture.mike, published.publicationId);

    expect(await sourceStatus(publication!.sourceId)).toBe("ACTIVE");
    expect(await activeNameCount(fixture.groupTeamWorkspaceId, name)).toBe(1);
    expect((await claimRows(published.publicationId)).every((row) =>
      row.active_team_workspace_id === fixture.groupTeamWorkspaceId)).toBe(true);

    const documents = await fixture.uow.run((repositories) =>
      repositories.publications.listDocuments(published.publicationId));
    const teamDocument = documents.find((document) =>
      document.currentOriginalDocumentId === tree.documents[0].documentId);
    expect(teamDocument).toBeDefined();
    expect(await currentTitle(teamDocument!.teamDocumentId)).toBe("Restore Success A v2");

    const mikeAfter = await contributionOf(published.publicationId, fixture.mike.identity.id);
    const annAfter = await contributionOf(published.publicationId, fixture.ann.identity.id);
    expect(mikeAfter?.pendingCatchUp).toBe(false);
    expect(annAfter?.pendingCatchUp).toBe(true);
    expect(annAfter?.rightsFrozenAt).toBeNull();
  });

  it("does not clear a rights freeze when restoring", async () => {
    const tree = await createFolderTree(fixture.mike, unique("restore-frozen"), [
      { relative: "a.md", title: "Restore Frozen A", markdown: "a" },
    ]);
    const published = await service.publish(fixture.mike, {
      teamWorkspaceId: fixture.teamWorkspaceId,
      name: unique("Restore Frozen Publication"),
      origin: { kind: "FOLDER", folderNodeId: tree.folderNodeId },
    });
    const annTree = await createFolderTree(fixture.ann, unique("restore-frozen-ann"), [
      { relative: "c.md", title: "Restore Frozen Ann", markdown: "ann" },
    ]);
    await service.join(fixture.ann, {
      publicationId: published.publicationId,
      folderNodeId: annTree.folderNodeId,
      acknowledgeLowOverlap: true,
    });
    const annContribution = await contributionOf(published.publicationId, fixture.ann.identity.id);
    const frozenAt = new Date();
    await fixture.uow.run((repositories) =>
      repositories.publications.setContributionState(annContribution!.id, {
        leftAt: null,
        rightsFrozenAt: frozenAt,
        pendingCatchUp: false,
      }));

    await service.unpublish(fixture.mike, published.publicationId);
    await service.restore(fixture.mike, published.publicationId);

    const annAfter = await contributionOf(published.publicationId, fixture.ann.identity.id);
    expect(annAfter?.rightsFrozenAt?.getTime()).toBe(frozenAt.getTime());
  });

  it("maps a lost concurrent restore race for the same name to PUBLICATION_NAME_TAKEN", async () => {
    const firstTree = await createFolderTree(fixture.mike, unique("restore-race-a"), [
      { relative: "a.md", title: "Restore Race A", markdown: "a" },
    ]);
    const secondTree = await createFolderTree(fixture.mike, unique("restore-race-b"), [
      { relative: "b.md", title: "Restore Race B", markdown: "b" },
    ]);
    const name = unique("Restore Race Publication");
    const first = await service.publish(fixture.mike, {
      teamWorkspaceId: fixture.teamWorkspaceId,
      name,
      origin: { kind: "FOLDER", folderNodeId: firstTree.folderNodeId },
    });
    await service.unpublish(fixture.mike, first.publicationId);
    const second = await service.publish(fixture.mike, {
      teamWorkspaceId: fixture.teamWorkspaceId,
      name,
      origin: { kind: "FOLDER", folderNodeId: secondTree.folderNodeId },
    });
    await service.unpublish(fixture.mike, second.publicationId);

    const outcomes = await Promise.allSettled([
      service.restore(fixture.mike, first.publicationId),
      service.restore(fixture.mike, second.publicationId),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.filter((outcome) => outcome.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason)
      .toMatchObject({ code: "PUBLICATION_NAME_TAKEN" });
    expect(await activeNameCount(fixture.teamWorkspaceId, name)).toBe(1);
  });
});

describe("publication lifecycle: archived team", () => {
  it("refuses admin and creator unpublish, rename and restore and writes nothing", async () => {
    const teamId = await createTeamWithRoles("Archived Lifecycle Team", [
      { userId: fixture.mike.identity.id, role: "OWNER" },
      { userId: fixture.ann.identity.id, role: "EDITOR" },
    ]);
    const activeTree = await createFolderTree(fixture.ann, unique("archived-team-active"), [
      { relative: "a.md", title: "Archived Team A", markdown: "a" },
    ]);
    const active = await service.publish(fixture.ann, {
      teamWorkspaceId: teamId,
      name: unique("Archived Team Active"),
      origin: { kind: "FOLDER", folderNodeId: activeTree.folderNodeId },
    });
    const archivedTree = await createFolderTree(fixture.ann, unique("archived-team-restore"), [
      { relative: "b.md", title: "Archived Team B", markdown: "b" },
    ]);
    const archived = await service.publish(fixture.ann, {
      teamWorkspaceId: teamId,
      name: unique("Archived Team Restore"),
      origin: { kind: "FOLDER", folderNodeId: archivedTree.folderNodeId },
    });
    await service.unpublish(fixture.ann, archived.publicationId);

    const activeSource = (await fixture.uow.run((repositories) =>
      repositories.publications.findById(active.publicationId)))!.sourceId;
    const archivedSource = (await fixture.uow.run((repositories) =>
      repositories.publications.findById(archived.publicationId)))!.sourceId;
    const before = {
      activeStatus: await sourceStatus(activeSource),
      activeName: await sourceName(activeSource),
      archivedStatus: await sourceStatus(archivedSource),
      archivedName: await sourceName(archivedSource),
      documents: (await fixture.uow.run((repositories) =>
        repositories.publications.listDocuments(active.publicationId))).length,
    };

    await new TeamWorkspaceService(fixture.uow).archiveTeamWorkspace(fixture.mike, teamId);

    for (const caller of [fixture.mike, fixture.ann]) {
      await expect(service.unpublish(caller, active.publicationId))
        .rejects.toMatchObject({ code: "WORKSPACE_ARCHIVED" });
      await expect(service.rename(caller, active.publicationId, unique("Archived Team Renamed")))
        .rejects.toMatchObject({ code: "WORKSPACE_ARCHIVED" });
      await expect(service.restore(caller, archived.publicationId))
        .rejects.toMatchObject({ code: "WORKSPACE_ARCHIVED" });
    }

    expect({
      activeStatus: await sourceStatus(activeSource),
      activeName: await sourceName(activeSource),
      archivedStatus: await sourceStatus(archivedSource),
      archivedName: await sourceName(archivedSource),
      documents: (await fixture.uow.run((repositories) =>
        repositories.publications.listDocuments(active.publicationId))).length,
    }).toEqual(before);
    expect((await fixture.uow.run((repositories) =>
      repositories.publications.findById(active.publicationId)))?.status).toBe("ACTIVE");
    expect((await fixture.uow.run((repositories) =>
      repositories.publications.findById(archived.publicationId)))?.status).toBe("ARCHIVED");
  });

  it("refuses leave and resume and leaves contribution state unchanged", async () => {
    const teamId = await createTeamWithRoles("Archived Team Members", [
      { userId: fixture.mike.identity.id, role: "OWNER" },
      { userId: fixture.ann.identity.id, role: "EDITOR" },
    ]);
    const mikeTree = await createFolderTree(fixture.mike, unique("archived-team-mike"), [
      { relative: "a.md", title: "Archived Team Mike", markdown: "mike" },
    ]);
    const annTree = await createFolderTree(fixture.ann, unique("archived-team-ann"), [
      { relative: "a.md", title: "Archived Team Ann", markdown: "ann" },
    ]);

    const joinedPublication = await service.publish(fixture.mike, {
      teamWorkspaceId: teamId,
      name: unique("Archived Team Joined"),
      origin: { kind: "FOLDER", folderNodeId: mikeTree.folderNodeId },
    });
    const joined = await service.join(fixture.ann, {
      publicationId: joinedPublication.publicationId,
      folderNodeId: annTree.folderNodeId,
      acknowledgeLowOverlap: true,
    });

    const leftMikeTree = await createFolderTree(fixture.mike, unique("archived-team-mike-left"), [
      { relative: "b.md", title: "Archived Team Mike Left", markdown: "mike left" },
    ]);
    const leftAnnTree = await createFolderTree(fixture.ann, unique("archived-team-ann-left"), [
      { relative: "b.md", title: "Archived Team Ann Left", markdown: "ann left" },
    ]);
    const leftPublication = await service.publish(fixture.mike, {
      teamWorkspaceId: teamId,
      name: unique("Archived Team Left"),
      origin: { kind: "FOLDER", folderNodeId: leftMikeTree.folderNodeId },
    });
    const left = await service.join(fixture.ann, {
      publicationId: leftPublication.publicationId,
      folderNodeId: leftAnnTree.folderNodeId,
      acknowledgeLowOverlap: true,
    });
    await service.leave(fixture.ann, leftPublication.publicationId);
    const leftBefore = await contributionOf(leftPublication.publicationId, fixture.ann.identity.id);

    await new TeamWorkspaceService(fixture.uow).archiveTeamWorkspace(fixture.mike, teamId);

    await expect(service.leave(fixture.ann, joinedPublication.publicationId))
      .rejects.toMatchObject({ code: "WORKSPACE_ARCHIVED" });
    const joinedAfter = await contributionOf(joinedPublication.publicationId, fixture.ann.identity.id);
    expect(joinedAfter?.id).toBe(joined.contributionId);
    expect(joinedAfter?.leftAt).toBeNull();
    expect(joinedAfter?.rightsFrozenAt).toBeNull();

    await expect(service.resume(fixture.ann, leftPublication.publicationId))
      .rejects.toMatchObject({ code: "WORKSPACE_ARCHIVED" });
    const leftAfter = await contributionOf(leftPublication.publicationId, fixture.ann.identity.id);
    expect(leftAfter?.id).toBe(left.contributionId);
    expect(leftAfter?.leftAt).toEqual(leftBefore?.leftAt);
    expect(leftAfter?.rightsFrozenAt).toEqual(leftBefore?.rightsFrozenAt);

    // Joining a new origin on an archived team is refused before any row.
    const otherTree = await createFolderTree(fixture.ann, unique("archived-team-join"), [
      { relative: "c.md", title: "Archived Team C", markdown: "c" },
    ]);
    await expect(service.join(fixture.ann, {
      publicationId: joinedPublication.publicationId,
      folderNodeId: otherTree.folderNodeId,
      acknowledgeLowOverlap: true,
    })).rejects.toMatchObject({ code: "WORKSPACE_ACCESS_DENIED" });
  });
});
