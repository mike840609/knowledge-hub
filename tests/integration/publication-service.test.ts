import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PublicationService } from "@/modules/sources/application/publication-service";
import { reconcileContribution } from "@/modules/sources/application/publication-reconciler";
import type { SourceRepositories, SourceUnitOfWork } from "@/modules/sources/ports/unit-of-work";
import { HubKnowledgeCommandServiceImpl } from "@/modules/knowledge/application/hub-knowledge-command-service";
import type { CallerContext } from "@/modules/identity/domain/caller-context";
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

async function createFolderTree(
  caller: CallerContext,
  label: string,
  documents: readonly { relative: string; title: string; markdown: string }[],
): Promise<{ folderNodeId: string; root: string; documents: { documentId: string }[] }> {
  const root = `repos/${label}`;
  const folder = await fixture.createFolder(caller, root, label);
  const created: { documentId: string }[] = [];
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

async function titleOf(documentId: string): Promise<string | undefined> {
  const rows = await fixture.pool.query<{ title: string }[]>(
    `SELECT r.title FROM knowledge_documents d
     JOIN knowledge_revisions r ON r.id = d.current_revision_id
     WHERE d.id = ?`,
    [documentId],
  );
  return rows[0]?.title;
}

async function sourceCount(teamWorkspaceId: string, name: string): Promise<number> {
  const rows = await fixture.pool.query<{ n: unknown }[]>(
    "SELECT COUNT(*) AS n FROM knowledge_sources WHERE workspace_id = ? AND active_publication_name = ?",
    [teamWorkspaceId, name],
  );
  return Number(rows[0]?.n ?? 0);
}

describe("publication service: publish", () => {
  it("publishes a personal folder as one team source with copies", async () => {
    const label = unique("happy-folder");
    const tree = await createFolderTree(fixture.mike, label, [
      { relative: "a.md", title: "A", markdown: "a" },
      { relative: "nested/b.md", title: "B", markdown: "b" },
    ]);
    const name = unique("Folder Publication");

    const result = await service.publish(fixture.mike, {
      teamWorkspaceId: fixture.teamWorkspaceId,
      name,
      origin: { kind: "FOLDER", folderNodeId: tree.folderNodeId },
    });

    expect(result.report.created).toBe(2);
    const publication = await fixture.uow.run((repositories) =>
      repositories.publications.findById(result.publicationId));
    expect(publication).toMatchObject({
      name,
      kind: "FOLDER",
      teamWorkspaceId: fixture.teamWorkspaceId,
      creatorUserId: fixture.mike.identity.id,
      status: "ACTIVE",
    });
    const [source] = await fixture.pool.query<{ source_type: string; ownership: string; name: string }[]>(
      "SELECT source_type, ownership, name FROM knowledge_sources WHERE id = ?",
      [publication?.sourceId],
    );
    expect(source).toMatchObject({ source_type: "PUBLICATION", ownership: "SOURCE_MANAGED", name });

    const contributions = await fixture.uow.run((repositories) =>
      repositories.publications.listContributions(result.publicationId));
    expect(contributions).toHaveLength(1);
    expect(contributions[0]).toMatchObject({ userId: fixture.mike.identity.id, origin: { kind: "FOLDER" } });

    const documents = await fixture.uow.run((repositories) =>
      repositories.publications.listDocuments(result.publicationId));
    expect(documents.map((document) => document.sourcePath).sort()).toEqual(["a.md", "nested/b.md"]);
    expect(documents.every((document) => document.creatorContributionId === contributions[0].id)).toBe(true);
  });

  it("publishes a single document with no publication path", async () => {
    const original = await fixture.createHubOriginal(fixture.mike, unique("Single"), "single body");
    const name = unique("Document Publication");

    const result = await service.publish(fixture.mike, {
      teamWorkspaceId: fixture.teamWorkspaceId,
      name,
      origin: { kind: "DOCUMENT", documentId: original.documentId },
    });

    expect(result.report.created).toBe(1);
    const publication = await fixture.uow.run((repositories) =>
      repositories.publications.findById(result.publicationId));
    expect(publication).toMatchObject({ name, kind: "DOCUMENT", status: "ACTIVE" });
    const [document] = await fixture.uow.run((repositories) =>
      repositories.publications.listDocuments(result.publicationId));
    expect(document.sourcePath).toBeNull();
    expect(document.currentOriginalDocumentId).toBe(original.documentId);
  });

  it("does not publish another person's origin", async () => {
    const tree = await createFolderTree(fixture.ann, unique("ann-origin"), [
      { relative: "a.md", title: "Ann A", markdown: "ann" },
    ]);

    await expect(service.publish(fixture.mike, {
      teamWorkspaceId: fixture.teamWorkspaceId,
      name: unique("Not Mine"),
      origin: { kind: "FOLDER", folderNodeId: tree.folderNodeId },
    })).rejects.toMatchObject({ code: "TREE_NODE_NOT_FOUND" });
  });

  it("denies a viewer", async () => {
    const viewerTeamId = uuidv7();
    const now = new Date();
    await fixture.uow.run(async (repositories) => {
      await repositories.workspaces.insert(createTeamWorkspaceInsert({
        id: viewerTeamId, name: unique("Viewer Team"), createdBy: fixture.mike.identity.id, now,
      }));
      await repositories.workspaceMemberships.insert(createDirectMembership({
        workspaceId: viewerTeamId, userId: fixture.ann.identity.id, role: "VIEWER", now,
      }));
    });
    const tree = await createFolderTree(fixture.ann, unique("viewer-origin"), [
      { relative: "a.md", title: "Viewer A", markdown: "viewer" },
    ]);

    await expect(service.publish(fixture.ann, {
      teamWorkspaceId: viewerTeamId,
      name: unique("Viewer Publication"),
      origin: { kind: "FOLDER", folderNodeId: tree.folderNodeId },
    })).rejects.toMatchObject({ code: "WORKSPACE_ACCESS_DENIED" });
  });

  it("lets only one of two concurrent same-name publishes take the name", async () => {
    const tree = await createFolderTree(fixture.mike, unique("race-origin"), [
      { relative: "a.md", title: "Race A", markdown: "race" },
    ]);
    const name = unique("Race Publication");

    const outcomes = await Promise.allSettled([
      service.publish(fixture.mike, {
        teamWorkspaceId: fixture.teamWorkspaceId, name,
        origin: { kind: "FOLDER", folderNodeId: tree.folderNodeId },
      }),
      service.publish(fixture.mike, {
        teamWorkspaceId: fixture.teamWorkspaceId, name,
        origin: { kind: "FOLDER", folderNodeId: tree.folderNodeId },
      }),
    ]);

    const fulfilled = outcomes.filter((outcome) => outcome.status === "fulfilled");
    const rejected = outcomes.filter((outcome) => outcome.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({
      reason: { code: "PUBLICATION_NAME_TAKEN" },
    });
    expect((rejected[0] as PromiseRejectedResult).reason.message)
      .toContain("已有同名發佈，請取一個能說明內容的名字");
    expect(await sourceCount(fixture.teamWorkspaceId, name)).toBe(1);
  });

  it("rejects an empty name", async () => {
    const tree = await createFolderTree(fixture.mike, unique("empty-name"), [
      { relative: "a.md", title: "Empty A", markdown: "empty" },
    ]);
    await expect(service.publish(fixture.mike, {
      teamWorkspaceId: fixture.teamWorkspaceId,
      name: "   ",
      origin: { kind: "FOLDER", folderNodeId: tree.folderNodeId },
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("publication service: preview", () => {
  it("reports a taken name without writing", async () => {
    const tree = await createFolderTree(fixture.mike, unique("preview-name"), [
      { relative: "a.md", title: "Preview A", markdown: "preview" },
    ]);
    const name = unique("Taken Name");
    await service.publish(fixture.mike, {
      teamWorkspaceId: fixture.teamWorkspaceId, name,
      origin: { kind: "FOLDER", folderNodeId: tree.folderNodeId },
    });

    const [before] = await fixture.pool.query<{ sources: unknown; publications: unknown; contributions: unknown }[]>(
      `SELECT
         (SELECT COUNT(*) FROM knowledge_sources WHERE workspace_id = ?) AS sources,
         (SELECT COUNT(*) FROM publications) AS publications,
         (SELECT COUNT(*) FROM publication_contributors) AS contributions`,
      [fixture.teamWorkspaceId],
    );

    const preview = await service.preview(fixture.mike, {
      teamWorkspaceId: fixture.teamWorkspaceId, name,
      origin: { kind: "FOLDER", folderNodeId: tree.folderNodeId },
    });
    expect(preview.nameTaken).toBe(true);

    const [after] = await fixture.pool.query<{ sources: unknown; publications: unknown; contributions: unknown }[]>(
      `SELECT
         (SELECT COUNT(*) FROM knowledge_sources WHERE workspace_id = ?) AS sources,
         (SELECT COUNT(*) FROM publications) AS publications,
         (SELECT COUNT(*) FROM publication_contributors) AS contributions`,
      [fixture.teamWorkspaceId],
    );
    expect(Number(after.sources)).toBe(Number(before.sources));
    expect(Number(after.publications)).toBe(Number(before.publications));
    expect(Number(after.contributions)).toBe(Number(before.contributions));
  });

  it("suggests joining a folder with exactly half of its paths in common", async () => {
    const tag = unique("suggest");
    const mikeTree = await createFolderTree(fixture.mike, unique("mike-suggest"), [
      { relative: `${tag}/a.md`, title: "Suggest A", markdown: "a" },
      { relative: `${tag}/b.md`, title: "Suggest B", markdown: "b" },
    ]);
    const publicationName = unique("Suggest Publication");
    const published = await service.publish(fixture.mike, {
      teamWorkspaceId: fixture.teamWorkspaceId, name: publicationName,
      origin: { kind: "FOLDER", folderNodeId: mikeTree.folderNodeId },
    });

    const annTree = await createFolderTree(fixture.ann, unique("ann-suggest"), [
      { relative: `${tag}/a.md`, title: "Ann Suggest A", markdown: "ann a" },
    ]);
    const preview = await service.preview(fixture.ann, {
      teamWorkspaceId: fixture.teamWorkspaceId,
      name: unique("Ann Suggest Publication"),
      origin: { kind: "FOLDER", folderNodeId: annTree.folderNodeId },
    });

    expect(preview.joinSuggestion).toMatchObject({
      publicationId: published.publicationId,
      name: publicationName,
      overlap: 0.5,
    });
    expect(preview.lowOverlapWarning).toBe(false);
  });

  it("does not warn about low overlap for a single-document origin", async () => {
    const tree = await createFolderTree(fixture.mike, unique("doc-preview-folder"), [
      { relative: "a.md", title: "Doc Preview A", markdown: "a" },
    ]);
    await service.publish(fixture.mike, {
      teamWorkspaceId: fixture.teamWorkspaceId,
      name: unique("Doc Preview Publication"),
      origin: { kind: "FOLDER", folderNodeId: tree.folderNodeId },
    });
    const original = await fixture.createHubOriginal(fixture.mike, unique("Doc Preview Single"), "body");

    const preview = await service.preview(fixture.mike, {
      teamWorkspaceId: fixture.teamWorkspaceId,
      name: unique("Doc Preview Single Publication"),
      origin: { kind: "DOCUMENT", documentId: original.documentId },
    });

    // A document origin is never joinable: no suggestion and no low-overlap
    // warning that would ask for an acknowledgement join cannot accept.
    expect(preview.joinSuggestion).toBeNull();
    expect(preview.lowOverlapWarning).toBe(false);
  });
});

describe("publication service: claims", () => {
  it("names the existing publication for overlapping originals and refuses an empty all-conflict publish", async () => {
    const label = unique("claims");
    const tree = await createFolderTree(fixture.mike, label, [
      { relative: "a.md", title: "Claim A", markdown: "a" },
      { relative: "b.md", title: "Claim B", markdown: "b" },
    ]);
    const [documentA, documentB] = tree.documents;
    const first = unique("Claim Single");
    const second = unique("Claim Folder");

    await service.publish(fixture.mike, {
      teamWorkspaceId: fixture.teamWorkspaceId, name: first,
      origin: { kind: "DOCUMENT", documentId: documentA.documentId },
    });
    const folderResult = await service.publish(fixture.mike, {
      teamWorkspaceId: fixture.teamWorkspaceId, name: second,
      origin: { kind: "FOLDER", folderNodeId: tree.folderNodeId },
    });
    expect(folderResult.report.created).toBe(1);
    expect(folderResult.report.notices.some((notice) =>
      notice.originalDocumentId === documentA.documentId
      && notice.code === "ORIGINAL_ALREADY_PUBLISHED"
      && notice.existingPublicationName === first)).toBe(true);

    const preview = await service.preview(fixture.mike, {
      teamWorkspaceId: fixture.teamWorkspaceId,
      name: unique("Claim Preview"),
      origin: { kind: "FOLDER", folderNodeId: tree.folderNodeId },
    });
    expect(preview.refusedOriginals).toEqual(expect.arrayContaining([
      { documentId: documentA.documentId, publicationName: first },
      { documentId: documentB.documentId, publicationName: second },
    ]));

    const allConflictName = unique("Claim All Conflict");
    await expect(service.publish(fixture.mike, {
      teamWorkspaceId: fixture.teamWorkspaceId, name: allConflictName,
      origin: { kind: "FOLDER", folderNodeId: tree.folderNodeId },
    })).rejects.toMatchObject({ code: "PUBLICATION_ORIGINAL_TAKEN" });
    expect(await sourceCount(fixture.teamWorkspaceId, allConflictName)).toBe(0);

    await expect(service.publish(fixture.mike, {
      teamWorkspaceId: fixture.teamWorkspaceId,
      name: unique("Claim Single Again"),
      origin: { kind: "DOCUMENT", documentId: documentA.documentId },
    })).rejects.toMatchObject({
      code: "PUBLICATION_ORIGINAL_TAKEN",
      details: { publicationName: first },
    });
  });

  it("allows the same original in two different teams", async () => {
    const tree = await createFolderTree(fixture.ann, unique("cross-team"), [
      { relative: "cross.md", title: "Cross", markdown: "cross" },
    ]);
    const name = unique("Cross Team Publication");

    const direct = await service.publish(fixture.ann, {
      teamWorkspaceId: fixture.teamWorkspaceId, name,
      origin: { kind: "FOLDER", folderNodeId: tree.folderNodeId },
    });
    const group = await service.publish(fixture.ann, {
      teamWorkspaceId: fixture.groupTeamWorkspaceId, name,
      origin: { kind: "FOLDER", folderNodeId: tree.folderNodeId },
    });

    expect(direct.publicationId).not.toBe(group.publicationId);
    const claims = await fixture.pool.query<{ active_team_workspace_id: string }[]>(
      `SELECT DISTINCT active_team_workspace_id FROM publication_bindings
       WHERE original_document_id = ? AND active_team_workspace_id IS NOT NULL`,
      [tree.documents[0].documentId],
    );
    expect(new Set(claims.map((claim) => claim.active_team_workspace_id)))
      .toEqual(new Set([fixture.teamWorkspaceId, fixture.groupTeamWorkspaceId]));
  });
});

describe("publication service: join", () => {
  it("keeps the creator's document, reports MAINTAINED_BY_OTHER and makes the joiner creator of a new path", async () => {
    const mikeTree = await createFolderTree(fixture.mike, unique("join-mike"), [
      { relative: "a.md", title: "Mike A", markdown: "mike a" },
    ]);
    const publicationName = unique("Join Publication");
    const published = await service.publish(fixture.mike, {
      teamWorkspaceId: fixture.teamWorkspaceId, name: publicationName,
      origin: { kind: "FOLDER", folderNodeId: mikeTree.folderNodeId },
    });

    const annTree = await createFolderTree(fixture.ann, unique("join-ann"), [
      { relative: "a.md", title: "Ann A v2", markdown: "ann a v2" },
      { relative: "c.md", title: "Ann C", markdown: "ann c" },
    ]);
    const joined = await service.join(fixture.ann, {
      publicationId: published.publicationId,
      folderNodeId: annTree.folderNodeId,
    });

    expect(joined.report.created).toBe(1);
    expect(joined.report.notices.some((notice) =>
      notice.code === "MAINTAINED_BY_OTHER"
      && notice.maintainerUserId === fixture.mike.identity.id)).toBe(true);

    const contributions = await fixture.uow.run((repositories) =>
      repositories.publications.listContributions(published.publicationId));
    const mikeContribution = contributions.find((contribution) => contribution.userId === fixture.mike.identity.id);
    const annContribution = contributions.find((contribution) => contribution.userId === fixture.ann.identity.id);
    expect(mikeContribution).toBeDefined();
    expect(annContribution?.id).toBe(joined.contributionId);

    const documents = await fixture.uow.run((repositories) =>
      repositories.publications.listDocuments(published.publicationId));
    const pathA = documents.find((document) => document.sourcePath === "a.md");
    const pathC = documents.find((document) => document.sourcePath === "c.md");
    expect(pathA?.creatorContributionId).toBe(mikeContribution?.id);
    expect(pathA?.currentOriginalDocumentId).toBe(mikeTree.documents[0].documentId);
    expect(pathC?.creatorContributionId).toBe(joined.contributionId);
    expect(await titleOf(pathA?.teamDocumentId ?? "")).toBe("Mike A");

    const bindingsAfterJoin = await fixture.uow.run((repositories) =>
      repositories.publications.listBindings(joined.contributionId));
    expect(bindingsAfterJoin).toHaveLength(2);

    const repeated = await service.join(fixture.ann, {
      publicationId: published.publicationId,
      folderNodeId: annTree.folderNodeId,
    });
    expect(repeated.contributionId).toBe(joined.contributionId);
    const contributionsAfterRejoin = await fixture.uow.run((repositories) =>
      repositories.publications.listContributions(published.publicationId));
    expect(contributionsAfterRejoin.filter((contribution) => contribution.userId === fixture.ann.identity.id))
      .toHaveLength(1);
    const bindingsAfterRejoin = await fixture.uow.run((repositories) =>
      repositories.publications.listBindings(joined.contributionId));
    expect(bindingsAfterRejoin).toHaveLength(bindingsAfterJoin.length);

    const otherAnnTree = await createFolderTree(fixture.ann, unique("join-ann-other"), [
      { relative: "d.md", title: "Ann D", markdown: "ann d" },
    ]);
    await expect(service.join(fixture.ann, {
      publicationId: published.publicationId,
      folderNodeId: otherAnnTree.folderNodeId,
      acknowledgeLowOverlap: true,
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("warns about and acknowledges a Hub-only origin folder", async () => {
    const hub = new HubKnowledgeCommandServiceImpl(fixture.uow);
    const mikeFolder = await hub.createFolder(fixture.mike, {
      sourceId: fixture.mikeHubSourceId, parentId: null, name: unique("Hub Mike Folder"),
    });
    await hub.createDocument(fixture.mike, {
      sourceId: fixture.mikeHubSourceId, parentId: mikeFolder.treeNodeId,
      title: "Hub Mike", markdown: "hub mike", metadata: {},
    });
    const published = await service.publish(fixture.mike, {
      teamWorkspaceId: fixture.teamWorkspaceId,
      name: unique("Hub Only Publication"),
      origin: { kind: "FOLDER", folderNodeId: mikeFolder.treeNodeId },
    });
    expect(published.report.created).toBe(1);

    const annFolder = await hub.createFolder(fixture.ann, {
      sourceId: fixture.annHubSourceId, parentId: null, name: unique("Hub Ann Folder"),
    });
    await hub.createDocument(fixture.ann, {
      sourceId: fixture.annHubSourceId, parentId: annFolder.treeNodeId,
      title: "Hub Ann", markdown: "hub ann", metadata: {},
    });

    const preview = await service.preview(fixture.ann, {
      teamWorkspaceId: fixture.teamWorkspaceId,
      name: unique("Hub Only Preview"),
      origin: { kind: "FOLDER", folderNodeId: annFolder.treeNodeId },
    });
    expect(preview.joinSuggestion).toBeNull();
    expect(preview.lowOverlapWarning).toBe(true);

    await expect(service.join(fixture.ann, {
      publicationId: published.publicationId,
      folderNodeId: annFolder.treeNodeId,
    })).rejects.toMatchObject({ code: "PUBLICATION_JOIN_LOW_OVERLAP" });

    const joined = await service.join(fixture.ann, {
      publicationId: published.publicationId,
      folderNodeId: annFolder.treeNodeId,
      acknowledgeLowOverlap: true,
    });
    expect(joined.report.created).toBe(1);
  });

  it("returns the same contribution for concurrent duplicate joins", async () => {
    const mikeTree = await createFolderTree(fixture.mike, unique("duplicate-join-mike"), [
      { relative: "a.md", title: "Duplicate Mike A", markdown: "mike" },
    ]);
    const published = await service.publish(fixture.mike, {
      teamWorkspaceId: fixture.teamWorkspaceId,
      name: unique("Duplicate Join Publication"),
      origin: { kind: "FOLDER", folderNodeId: mikeTree.folderNodeId },
    });
    const annTree = await createFolderTree(fixture.ann, unique("duplicate-join-ann"), [
      { relative: "a.md", title: "Duplicate Ann A", markdown: "ann" },
    ]);

    const outcomes = await Promise.allSettled([
      service.join(fixture.ann, {
        publicationId: published.publicationId,
        folderNodeId: annTree.folderNodeId,
      }),
      service.join(fixture.ann, {
        publicationId: published.publicationId,
        folderNodeId: annTree.folderNodeId,
      }),
    ]);

    expect(outcomes.map((outcome) => outcome.status)).toEqual(["fulfilled", "fulfilled"]);
    const contributionIds = outcomes.map((outcome) =>
      (outcome as PromiseFulfilledResult<{ contributionId: string }>).value.contributionId);
    expect(contributionIds[0]).toBe(contributionIds[1]);

    const contributions = await fixture.uow.run((repositories) =>
      repositories.publications.listContributions(published.publicationId));
    expect(contributions.filter((contribution) => contribution.userId === fixture.ann.identity.id))
      .toHaveLength(1);
    expect(contributions.find((contribution) => contribution.userId === fixture.ann.identity.id)?.id)
      .toBe(contributionIds[0]);
    const bindings = await fixture.uow.run((repositories) =>
      repositories.publications.listBindings(contributionIds[0]));
    expect(bindings).toHaveLength(1);
  });

  it("requires an explicit acknowledgement for a low-overlap folder", async () => {
    const tag = unique("low");
    const mikeTree = await createFolderTree(fixture.mike, unique("low-mike"), [
      { relative: `${tag}/only.md`, title: "Only", markdown: "only" },
    ]);
    const published = await service.publish(fixture.mike, {
      teamWorkspaceId: fixture.teamWorkspaceId,
      name: unique("Low Overlap Publication"),
      origin: { kind: "FOLDER", folderNodeId: mikeTree.folderNodeId },
    });

    const annTree = await createFolderTree(fixture.ann, unique("low-ann"), [
      { relative: `${tag}/different.md`, title: "Different", markdown: "different" },
    ]);
    const preview = await service.preview(fixture.ann, {
      teamWorkspaceId: fixture.teamWorkspaceId,
      name: unique("Low Overlap Preview"),
      origin: { kind: "FOLDER", folderNodeId: annTree.folderNodeId },
    });
    expect(preview.joinSuggestion).toBeNull();
    expect(preview.lowOverlapWarning).toBe(true);

    await expect(service.join(fixture.ann, {
      publicationId: published.publicationId,
      folderNodeId: annTree.folderNodeId,
    })).rejects.toMatchObject({ code: "PUBLICATION_JOIN_LOW_OVERLAP" });

    const joined = await service.join(fixture.ann, {
      publicationId: published.publicationId,
      folderNodeId: annTree.folderNodeId,
      acknowledgeLowOverlap: true,
    });
    expect(joined.report.created).toBe(1);
  });

  it("refuses to join a document publication", async () => {
    const original = await fixture.createHubOriginal(fixture.mike, unique("Doc Join"), "doc join");
    const published = await service.publish(fixture.mike, {
      teamWorkspaceId: fixture.teamWorkspaceId,
      name: unique("Document Join Publication"),
      origin: { kind: "DOCUMENT", documentId: original.documentId },
    });
    const annTree = await createFolderTree(fixture.ann, unique("doc-join-ann"), [
      { relative: "a.md", title: "Ann Join A", markdown: "ann" },
    ]);

    await expect(service.join(fixture.ann, {
      publicationId: published.publicationId,
      folderNodeId: annTree.folderNodeId,
      acknowledgeLowOverlap: true,
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("publication service: leave and resume", () => {
  it("keeps claims on leave, resumes only the caller and reconciles fully", async () => {
    const mikeTree = await createFolderTree(fixture.mike, unique("leave-mike"), [
      { relative: "a.md", title: "Leave Mike A", markdown: "mike" },
    ]);
    const publicationName = unique("Leave Publication");
    const published = await service.publish(fixture.mike, {
      teamWorkspaceId: fixture.teamWorkspaceId, name: publicationName,
      origin: { kind: "FOLDER", folderNodeId: mikeTree.folderNodeId },
    });

    // Before joining, Ann has no contribution of her own to resume.
    await expect(service.resume(fixture.ann, published.publicationId))
      .rejects.toMatchObject({ code: "NOT_FOUND" });

    const annTree = await createFolderTree(fixture.ann, unique("leave-ann"), [
      { relative: "a.md", title: "Leave Ann A", markdown: "ann" },
    ]);
    const joined = await service.join(fixture.ann, {
      publicationId: published.publicationId,
      folderNodeId: annTree.folderNodeId,
    });

    await service.leave(fixture.ann, published.publicationId);
    let contributions = await fixture.uow.run((repositories) =>
      repositories.publications.listContributions(published.publicationId));
    const annContribution = contributions.find((contribution) => contribution.id === joined.contributionId);
    expect(annContribution?.leftAt).not.toBeNull();

    const bindings = await fixture.uow.run((repositories) =>
      repositories.publications.listBindings(joined.contributionId));
    expect(bindings).toHaveLength(1);
    const documentsBeforeResume = await fixture.uow.run((repositories) =>
      repositories.publications.listDocuments(published.publicationId));
    expect(documentsBeforeResume.every((document) => document.status === "ACTIVE")).toBe(true);

    // An ordinary reconciliation does not reactivate a voluntary leave.
    const skipped = await fixture.uow.run((repositories) => reconcileContribution(repositories, {
      publicationId: published.publicationId,
      contributionId: joined.contributionId,
      judge: { kind: "CALLER", caller: fixture.ann },
      now: new Date(),
    }));
    expect(skipped.state).toBe("SKIPPED");

    // The left contribution's binding still occupies its original.
    await expect(service.publish(fixture.ann, {
      teamWorkspaceId: fixture.teamWorkspaceId,
      name: unique("Left Claim Publication"),
      origin: { kind: "DOCUMENT", documentId: annTree.documents[0].documentId },
    })).rejects.toMatchObject({
      code: "PUBLICATION_ORIGINAL_TAKEN",
      details: { publicationName },
    });

    // A new original appears while Ann is away; resuming reconciles all of it.
    await fixture.createSyncedOriginal(fixture.ann, {
      parentId: annTree.folderNodeId,
      sourcePath: `${annTree.root}/new.md`,
      title: "Ann New",
      markdown: "ann new",
    });
    const report = await service.resume(fixture.ann, published.publicationId);
    expect(report.created).toBe(1);

    contributions = await fixture.uow.run((repositories) =>
      repositories.publications.listContributions(published.publicationId));
    expect(contributions.find((contribution) => contribution.id === joined.contributionId)?.leftAt)
      .toBeNull();

    const documentsAfterResume = await fixture.uow.run((repositories) =>
      repositories.publications.listDocuments(published.publicationId));
    const newPath = documentsAfterResume.find((document) => document.sourcePath === "new.md");
    expect(newPath?.creatorContributionId).toBe(joined.contributionId);
    expect(await titleOf(newPath?.teamDocumentId ?? "")).toBe("Ann New");
  });

  it("resumes a left contribution when the same person joins from the same origin", async () => {
    const mikeTree = await createFolderTree(fixture.mike, unique("join-resume-mike"), [
      { relative: "a.md", title: "Join Resume Mike A", markdown: "mike" },
    ]);
    const published = await service.publish(fixture.mike, {
      teamWorkspaceId: fixture.teamWorkspaceId,
      name: unique("Join Resume Publication"),
      origin: { kind: "FOLDER", folderNodeId: mikeTree.folderNodeId },
    });
    const annTree = await createFolderTree(fixture.ann, unique("join-resume-ann"), [
      { relative: "ann.md", title: "Join Resume Ann", markdown: "v1" },
    ]);
    const joined = await service.join(fixture.ann, {
      publicationId: published.publicationId,
      folderNodeId: annTree.folderNodeId,
      acknowledgeLowOverlap: true,
    });
    await service.leave(fixture.ann, published.publicationId);

    // A new revision appears while she is away; an explicit join resumes and
    // reconciles the contribution rather than silently reusing a LEFT row.
    const annRevisionId = await fixture.revisionIdOf(annTree.documents[0].documentId);
    await fixture.uow.run(async (repositories) => {
      const { bindSourceProjection } = await import(
        "@/modules/sources/application/source-knowledge-projection-service"
      );
      await bindSourceProjection(repositories, {
        id: fixture.annFolderSourceId,
        workspaceId: fixture.annPersonalWorkspaceId,
      }).projectRevision(fixture.ann, {
        documentId: annTree.documents[0].documentId,
        expectedCurrentRevisionId: annRevisionId,
        title: "Join Resume Ann v2",
        markdown: "v2",
        metadata: {},
      });
    });

    const rejoined = await service.join(fixture.ann, {
      publicationId: published.publicationId,
      folderNodeId: annTree.folderNodeId,
    });
    expect(rejoined.contributionId).toBe(joined.contributionId);
    expect(rejoined.report.updated).toBe(1);

    const contributions = await fixture.uow.run((repositories) =>
      repositories.publications.listContributions(published.publicationId));
    expect(contributions.find((contribution) => contribution.id === joined.contributionId)?.leftAt)
      .toBeNull();
    const documents = await fixture.uow.run((repositories) =>
      repositories.publications.listDocuments(published.publicationId));
    const annDocument = documents.find((document) => document.creatorContributionId === joined.contributionId);
    expect(await titleOf(annDocument?.teamDocumentId ?? "")).toBe("Join Resume Ann v2");

    // A different origin is still refused: resuming never rebinds the original.
    const otherAnnTree = await createFolderTree(fixture.ann, unique("join-resume-other"), [
      { relative: "other.md", title: "Other", markdown: "other" },
    ]);
    await expect(service.join(fixture.ann, {
      publicationId: published.publicationId,
      folderNodeId: otherAnnTree.folderNodeId,
      acknowledgeLowOverlap: true,
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("refuses to resume a left contribution while the publication is archived", async () => {
    const mikeTree = await createFolderTree(fixture.mike, unique("resume-archived-mike"), [
      { relative: "a.md", title: "Resume Archived Mike", markdown: "mike" },
    ]);
    const published = await service.publish(fixture.mike, {
      teamWorkspaceId: fixture.teamWorkspaceId,
      name: unique("Resume Archived Publication"),
      origin: { kind: "FOLDER", folderNodeId: mikeTree.folderNodeId },
    });
    const annTree = await createFolderTree(fixture.ann, unique("resume-archived-ann"), [
      { relative: "a.md", title: "Resume Archived Ann", markdown: "ann" },
    ]);
    const joined = await service.join(fixture.ann, {
      publicationId: published.publicationId,
      folderNodeId: annTree.folderNodeId,
    });
    await service.leave(fixture.ann, published.publicationId);

    await service.unpublish(fixture.mike, published.publicationId);

    // An archived publication has no active contribution state to resume:
    // leave it LEFT rather than clearing the marker on a dead publication.
    await expect(service.resume(fixture.ann, published.publicationId))
      .rejects.toMatchObject({ code: "SOURCE_ARCHIVED" });
    let contributions = await fixture.uow.run((repositories) =>
      repositories.publications.listContributions(published.publicationId));
    expect(contributions.find((contribution) => contribution.id === joined.contributionId)?.leftAt)
      .not.toBeNull();

    // Restoring the publication makes the same resume meaningful again.
    await service.restore(fixture.mike, published.publicationId);
    const report = await service.resume(fixture.ann, published.publicationId);
    expect(report).toBeTruthy();
    contributions = await fixture.uow.run((repositories) =>
      repositories.publications.listContributions(published.publicationId));
    expect(contributions.find((contribution) => contribution.id === joined.contributionId)?.leftAt)
      .toBeNull();
  });
});

describe("publication service: non-members", () => {
  it("hides join, leave and resume and writes nothing", async () => {
    const outsiderTeamId = uuidv7();
    const now = new Date();
    await fixture.uow.run(async (repositories) => {
      await repositories.workspaces.insert(createTeamWorkspaceInsert({
        id: outsiderTeamId, name: unique("Outsider Team"), createdBy: fixture.mike.identity.id, now,
      }));
      await repositories.workspaceMemberships.insert(createDirectMembership({
        workspaceId: outsiderTeamId, userId: fixture.mike.identity.id, role: "OWNER", now,
      }));
    });
    const mikeTree = await createFolderTree(fixture.mike, unique("outsider-mike"), [
      { relative: "a.md", title: "Outsider Mike", markdown: "mike" },
    ]);
    const published = await service.publish(fixture.mike, {
      teamWorkspaceId: outsiderTeamId,
      name: unique("Outsider Publication"),
      origin: { kind: "FOLDER", folderNodeId: mikeTree.folderNodeId },
    });
    const annTree = await createFolderTree(fixture.ann, unique("outsider-ann"), [
      { relative: "a.md", title: "Outsider Ann", markdown: "ann" },
    ]);

    const before = await fixture.uow.run((repositories) =>
      repositories.publications.listContributions(published.publicationId));
    await expect(service.join(fixture.ann, {
      publicationId: published.publicationId,
      folderNodeId: annTree.folderNodeId,
      acknowledgeLowOverlap: true,
    })).rejects.toMatchObject({ code: "WORKSPACE_NOT_FOUND" });
    await expect(service.leave(fixture.ann, published.publicationId))
      .rejects.toMatchObject({ code: "WORKSPACE_NOT_FOUND" });
    await expect(service.resume(fixture.ann, published.publicationId))
      .rejects.toMatchObject({ code: "WORKSPACE_NOT_FOUND" });

    const after = await fixture.uow.run((repositories) =>
      repositories.publications.listContributions(published.publicationId));
    expect(after).toEqual(before);
    expect(after.some((contribution) => contribution.userId === fixture.ann.identity.id)).toBe(false);
  });
});

/** Records which publication IDs had their document metadata loaded. */
function countingDocumentViews(base: SourceUnitOfWork): {
  uow: SourceUnitOfWork;
  publicationIds: () => string[];
} {
  const publicationIds: string[] = [];
  return {
    publicationIds: () => publicationIds,
    uow: {
      async run<T>(work: (repositories: SourceRepositories) => Promise<T>): Promise<T> {
        return base.run(async (repositories) => {
          const publications = new Proxy(repositories.publications, {
            get(target, property, receiver) {
              if (property === "listDocumentViews") {
                return async (publicationId: string) => {
                  publicationIds.push(publicationId);
                  return target.listDocumentViews(publicationId);
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
        base.runWithCreatorQuotaLock(creatorId, timeoutSeconds, work),
    },
  };
}

describe("publication service: list", () => {
  it("loads document metadata only for the rendered source", async () => {
    const firstTree = await createFolderTree(fixture.mike, unique("list-first"), [
      { relative: "a.md", title: "List A", markdown: "a" },
    ]);
    const first = await service.publish(fixture.mike, {
      teamWorkspaceId: fixture.teamWorkspaceId,
      name: unique("List First Publication"),
      origin: { kind: "FOLDER", folderNodeId: firstTree.folderNodeId },
    });
    const secondTree = await createFolderTree(fixture.mike, unique("list-second"), [
      { relative: "b.md", title: "List B", markdown: "b" },
    ]);
    const second = await service.publish(fixture.mike, {
      teamWorkspaceId: fixture.teamWorkspaceId,
      name: unique("List Second Publication"),
      origin: { kind: "FOLDER", folderNodeId: secondTree.folderNodeId },
    });
    const firstSourceId = (await fixture.uow.run((repositories) =>
      repositories.publications.findById(first.publicationId)))!.sourceId;

    const counting = countingDocumentViews(fixture.uow);
    const listed = await new PublicationService(counting.uow).list(
      fixture.mike,
      fixture.teamWorkspaceId,
      false,
      { includeDocuments: true, documentsSourceId: firstSourceId },
    );

    const firstItem = listed.find((item) => item.publication.id === first.publicationId);
    const secondItem = listed.find((item) => item.publication.id === second.publicationId);
    expect(firstItem?.documents).toHaveLength(1);
    expect(secondItem?.documents).toEqual([]);
    // The second publication's metadata was never read at all.
    expect(counting.publicationIds()).toEqual([first.publicationId]);
    expect(counting.publicationIds()).not.toContain(second.publicationId);
  });
});
