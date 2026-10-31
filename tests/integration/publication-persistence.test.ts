import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "@/shared/ids/uuidv7";
import {
  createPublicationFixture,
  type PublicationFixture,
} from "../fixtures/publications";

let fixture: PublicationFixture;

beforeAll(async () => {
  fixture = await createPublicationFixture();
});
afterAll(async () => {
  await fixture.dispose();
});

describe("publication sources and names", () => {
  it("rejects duplicate active names but releases on archive", async () => {
    const folder = await fixture.createFolder(fixture.mike, "repo/docs", "docs");
    const first = await fixture.createPublication({
      name: "HCM KM 設計",
      kind: "FOLDER",
      creator: fixture.mike,
      origin: { kind: "FOLDER", folderNodeId: folder.treeNodeId },
    });

    const duplicateSourceId = uuidv7();
    await expect(
      fixture.uow.run((repositories) => repositories.sources.insert({
        id: duplicateSourceId, name: "HCM KM 設計", workspaceId: fixture.teamWorkspaceId,
        sourceType: "PUBLICATION", ownership: "SOURCE_MANAGED", status: "ACTIVE", syncVersion: 0,
        createdBy: fixture.mike.identity.id, updatedBy: fixture.mike.identity.id,
        archivedBy: null, archivedAt: null, createdAt: new Date(), updatedAt: new Date(),
      })),
    ).rejects.toMatchObject({ code: "INTEGRITY_VIOLATION" });

    await fixture.uow.run((repositories) =>
      repositories.publications.setPublicationStatus(first.publication.id, "ARCHIVED", fixture.mike.identity.id));

    // The archived publication freed its name; a second source may take it.
    await expect(
      fixture.uow.run((repositories) => repositories.sources.insert({
        id: duplicateSourceId, name: "HCM KM 設計", workspaceId: fixture.teamWorkspaceId,
        sourceType: "PUBLICATION", ownership: "SOURCE_MANAGED", status: "ACTIVE", syncVersion: 0,
        createdBy: fixture.mike.identity.id, updatedBy: fixture.mike.identity.id,
        archivedBy: null, archivedAt: null, createdAt: new Date(), updatedAt: new Date(),
      })),
    ).resolves.toBeUndefined();
  });

  it("refuses a publication row attached to a non-publication source", async () => {
    await expect(
      fixture.uow.run((repositories) => repositories.publications.insert({
        id: uuidv7(),
        sourceId: fixture.mikeFolderSourceId,
        teamWorkspaceId: fixture.mikePersonalWorkspaceId,
        name: "Not a publication source",
        kind: "FOLDER",
        creatorUserId: fixture.mike.identity.id,
        status: "ACTIVE",
      })),
    ).rejects.toMatchObject({ code: "INTEGRITY_VIOLATION" });

    const rows = await fixture.pool.query<{ n: unknown }[]>(
      "SELECT COUNT(*) AS n FROM publications WHERE source_id = ?",
      [fixture.mikeFolderSourceId],
    );
    expect(Number(rows[0]?.n ?? 0)).toBe(0);
  });

  it("stores PUBLICATION as a source-managed type and reads its name, workspace and status from the source", async () => {
    const folder = await fixture.createFolder(fixture.mike, "repo/other", "other");
    const created = await fixture.createPublication({
      name: "Payroll 設計",
      kind: "FOLDER",
      creator: fixture.mike,
      origin: { kind: "FOLDER", folderNodeId: folder.treeNodeId },
    });

    const read = await fixture.uow.run((repositories) => repositories.publications.findById(created.publication.id));
    expect(read).toMatchObject({
      id: created.publication.id,
      sourceId: created.sourceId,
      teamWorkspaceId: fixture.teamWorkspaceId,
      name: "Payroll 設計",
      kind: "FOLDER",
      creatorUserId: fixture.mike.identity.id,
      status: "ACTIVE",
    });
    const source = await fixture.pool.query<{ source_type: string; ownership: string }[]>(
      "SELECT source_type, ownership FROM knowledge_sources WHERE id = ?",
      [created.sourceId],
    );
    expect(source[0]).toMatchObject({ source_type: "PUBLICATION", ownership: "SOURCE_MANAGED" });
  });
});

describe("publication claims", () => {
  it("claims joiner originals as well as creator originals", async () => {
    const mikeOriginal = await fixture.createHubOriginal(fixture.mike, "Mike note", "mike");
    const annOriginal = await fixture.createHubOriginal(fixture.ann, "Ann note", "ann");
    const publication = await fixture.createPublication({
      name: "Shared Claims",
      kind: "DOCUMENT",
      creator: fixture.mike,
      origin: { kind: "DOCUMENT", documentId: mikeOriginal.documentId },
    });
    const annContributionId = await fixture.addContribution({
      publicationId: publication.publication.id,
      user: fixture.ann,
      origin: { kind: "DOCUMENT", documentId: annOriginal.documentId },
    });

    const teamDocument = await fixture.createTeamDocument({
      publication,
      creatorContributionId: publication.contributionId,
      originalDocumentId: mikeOriginal.documentId,
      sourcePath: null,
      title: "Shared Claims",
    });

    await fixture.uow.run(async (repositories) => {
      await repositories.publications.bind({
        contributionId: publication.contributionId,
        originalDocumentId: mikeOriginal.documentId,
        teamDocumentId: teamDocument.teamDocumentId,
      });
      await repositories.publications.bind({
        contributionId: annContributionId,
        originalDocumentId: annOriginal.documentId,
        teamDocumentId: teamDocument.teamDocumentId,
      });
    });

    const claims = await fixture.pool.query<{ original_document_id: string; active_team_workspace_id: string }[]>(
      "SELECT original_document_id, active_team_workspace_id FROM publication_bindings WHERE team_document_id = ? ORDER BY original_document_id",
      [teamDocument.teamDocumentId],
    );
    expect(claims).toHaveLength(2);
    expect(claims.every((row) => row.active_team_workspace_id === fixture.teamWorkspaceId)).toBe(true);

    // A second active publication in the same team cannot claim Ann's original.
    const other = await fixture.createPublication({
      name: "Other Publication",
      kind: "DOCUMENT",
      creator: fixture.mike,
      origin: { kind: "DOCUMENT", documentId: mikeOriginal.documentId },
    });
    const otherTeamDocument = await fixture.createTeamDocument({
      publication: other,
      creatorContributionId: other.contributionId,
      originalDocumentId: mikeOriginal.documentId,
      sourcePath: null,
    });
    await expect(
      fixture.uow.run((repositories) => repositories.publications.bind({
        contributionId: other.contributionId,
        originalDocumentId: annOriginal.documentId,
        teamDocumentId: otherTeamDocument.teamDocumentId,
      })),
    ).rejects.toMatchObject({ code: "PUBLICATION_ORIGINAL_TAKEN" });
  });

  it("clears claims on archive and re-claims them on restore", async () => {
    const original = await fixture.createHubOriginal(fixture.mike, "Claim lifecycle", "claim");
    const publication = await fixture.createPublication({
      name: "Claim Lifecycle",
      kind: "DOCUMENT",
      creator: fixture.mike,
      origin: { kind: "DOCUMENT", documentId: original.documentId },
    });
    const teamDocument = await fixture.createTeamDocument({
      publication,
      creatorContributionId: publication.contributionId,
      originalDocumentId: original.documentId,
      sourcePath: null,
    });
    await fixture.uow.run((repositories) => repositories.publications.bind({
      contributionId: publication.contributionId,
      originalDocumentId: original.documentId,
      teamDocumentId: teamDocument.teamDocumentId,
    }));

    await fixture.uow.run((repositories) =>
      repositories.publications.setPublicationStatus(publication.publication.id, "ARCHIVED", fixture.mike.identity.id));
    const [archivedClaim] = await fixture.pool.query<{ active_team_workspace_id: string | null }[]>(
      "SELECT active_team_workspace_id FROM publication_bindings WHERE contribution_id = ?",
      [publication.contributionId],
    );
    expect(archivedClaim.active_team_workspace_id).toBeNull();

    // Another active publication in the team may now claim the released original.
    const other = await fixture.createPublication({
      name: "Claim Taker",
      kind: "DOCUMENT",
      creator: fixture.mike,
      origin: { kind: "DOCUMENT", documentId: original.documentId },
    });
    const otherTeamDocument = await fixture.createTeamDocument({
      publication: other,
      creatorContributionId: other.contributionId,
      originalDocumentId: original.documentId,
      sourcePath: null,
    });
    await fixture.uow.run((repositories) => repositories.publications.bind({
      contributionId: other.contributionId,
      originalDocumentId: original.documentId,
      teamDocumentId: otherTeamDocument.teamDocumentId,
    }));

    // Restoring must fail atomically while the other publication holds the claim.
    await expect(
      fixture.uow.run((repositories) =>
        repositories.publications.setPublicationStatus(publication.publication.id, "ACTIVE", fixture.mike.identity.id)),
    ).rejects.toMatchObject({ code: "PUBLICATION_ORIGINAL_TAKEN" });
    const [stillArchived] = await fixture.pool.query<{ status: string }[]>(
      "SELECT status FROM knowledge_sources WHERE id = ?",
      [publication.sourceId],
    );
    expect(stillArchived.status).toBe("ARCHIVED");

    // Releasing the other publication lets the original publication restore.
    await fixture.uow.run((repositories) =>
      repositories.publications.setPublicationStatus(other.publication.id, "ARCHIVED", fixture.mike.identity.id));
    await fixture.uow.run((repositories) =>
      repositories.publications.setPublicationStatus(publication.publication.id, "ACTIVE", fixture.mike.identity.id));
    const [restoredClaim] = await fixture.pool.query<{ active_team_workspace_id: string | null }[]>(
      "SELECT active_team_workspace_id FROM publication_bindings WHERE contribution_id = ?",
      [publication.contributionId],
    );
    expect(restoredClaim.active_team_workspace_id).toBe(fixture.teamWorkspaceId);
  });

  it("repoint releases the old original and replaces the creator binding", async () => {
    const oldOriginal = await fixture.createHubOriginal(fixture.mike, "Old original", "old");
    const newOriginal = await fixture.createHubOriginal(fixture.mike, "New original", "new");
    const publication = await fixture.createPublication({
      name: "Repoint Publication",
      kind: "DOCUMENT",
      creator: fixture.mike,
      origin: { kind: "DOCUMENT", documentId: oldOriginal.documentId },
    });
    const teamDocument = await fixture.createTeamDocument({
      publication,
      creatorContributionId: publication.contributionId,
      originalDocumentId: oldOriginal.documentId,
      sourcePath: "notes/old.md",
    });
    await fixture.uow.run((repositories) => repositories.publications.bind({
      contributionId: publication.contributionId,
      originalDocumentId: oldOriginal.documentId,
      teamDocumentId: teamDocument.teamDocumentId,
    }));

    await fixture.uow.run((repositories) => repositories.publications.repoint(teamDocument.teamDocumentId, newOriginal.documentId));

    const bindings = await fixture.uow.run((repositories) => repositories.publications.listBindings(publication.contributionId));
    expect(bindings).toEqual([{
      contributionId: publication.contributionId,
      originalDocumentId: newOriginal.documentId,
      teamDocumentId: teamDocument.teamDocumentId,
    }]);
    const [document] = await fixture.pool.query<{ current_original_document_id: string }[]>(
      "SELECT current_original_document_id FROM publication_documents WHERE team_document_id = ?",
      [teamDocument.teamDocumentId],
    );
    expect(document.current_original_document_id).toBe(newOriginal.documentId);

    // The released original can now be claimed by another publication in the team.
    const other = await fixture.createPublication({
      name: "After Repoint",
      kind: "DOCUMENT",
      creator: fixture.mike,
      origin: { kind: "DOCUMENT", documentId: oldOriginal.documentId },
    });
    const otherTeamDocument = await fixture.createTeamDocument({
      publication: other,
      creatorContributionId: other.contributionId,
      originalDocumentId: oldOriginal.documentId,
      sourcePath: null,
    });
    await expect(
      fixture.uow.run((repositories) => repositories.publications.bind({
        contributionId: other.contributionId,
        originalDocumentId: oldOriginal.documentId,
        teamDocumentId: otherTeamDocument.teamDocumentId,
      })),
    ).resolves.toBeUndefined();
  });
});

describe("publication contribution state", () => {
  it("round-trips two set fields while the third stays clear, and lists archived publications on request", async () => {
    const folder = await fixture.createFolder(fixture.mike, `repo/state-${uuidv7()}`, "state");
    const publication = await fixture.createPublication({
      name: `State ${uuidv7()}`,
      kind: "FOLDER",
      creator: fixture.mike,
      origin: { kind: "FOLDER", folderNodeId: folder.treeNodeId },
    });
    const leftAt = new Date("2026-10-31T08:30:00Z");

    await fixture.uow.run((repositories) => repositories.publications.setContributionState(
      publication.contributionId,
      { leftAt, rightsFrozenAt: null, pendingCatchUp: true },
    ));

    const own = await fixture.uow.run((repositories) =>
      repositories.publications.listByContributor(fixture.mike.identity.id));
    const row = own.find((contribution) => contribution.id === publication.contributionId);
    expect(row).toMatchObject({ leftAt, rightsFrozenAt: null, pendingCatchUp: true });

    const listed = await fixture.uow.run((repositories) =>
      repositories.publications.listContributions(publication.publication.id));
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ leftAt, rightsFrozenAt: null, pendingCatchUp: true });

    // The active list hides an archived publication; includeArchived returns it.
    const active = await fixture.uow.run((repositories) =>
      repositories.publications.listByTeam(fixture.teamWorkspaceId));
    expect(active.some((candidate) => candidate.id === publication.publication.id)).toBe(true);
    await fixture.uow.run((repositories) => repositories.publications.setPublicationStatus(
      publication.publication.id, "ARCHIVED", fixture.mike.identity.id));
    const hidden = await fixture.uow.run((repositories) =>
      repositories.publications.listByTeam(fixture.teamWorkspaceId));
    expect(hidden.some((candidate) => candidate.id === publication.publication.id)).toBe(false);
    const withArchived = await fixture.uow.run((repositories) =>
      repositories.publications.listByTeam(fixture.teamWorkspaceId, true));
    expect(withArchived.some((candidate) => candidate.id === publication.publication.id)).toBe(true);
  });
});

describe("publication document paths", () => {
  it("reserves archived paths; accepts multiple NULL paths", async () => {
    const original = await fixture.createHubOriginal(fixture.mike, "Path source", "path");
    const publication = await fixture.createPublication({
      name: "Path Publication",
      kind: "DOCUMENT",
      creator: fixture.mike,
      origin: { kind: "DOCUMENT", documentId: original.documentId },
    });
    await fixture.createTeamDocument({
      publication,
      creatorContributionId: publication.contributionId,
      originalDocumentId: original.documentId,
      sourcePath: "docs/a.md",
      status: "ARCHIVED",
    });
    await expect(
      fixture.createTeamDocument({
        publication,
        creatorContributionId: publication.contributionId,
        originalDocumentId: original.documentId,
        sourcePath: "docs/a.md",
      }),
    ).rejects.toMatchObject({ code: "INTEGRITY_VIOLATION" });

    await expect(
      fixture.createTeamDocument({
        publication,
        creatorContributionId: publication.contributionId,
        originalDocumentId: original.documentId,
        sourcePath: null,
      }),
    ).resolves.toBeTruthy();
    await expect(
      fixture.createTeamDocument({
        publication,
        creatorContributionId: publication.contributionId,
        originalDocumentId: original.documentId,
        sourcePath: null,
      }),
    ).resolves.toBeTruthy();
  });

  it("keeps path case distinct and accepts paths longer than 512", async () => {
    const original = await fixture.createHubOriginal(fixture.mike, "Case source", "case");
    const publication = await fixture.createPublication({
      name: "Case Publication",
      kind: "DOCUMENT",
      creator: fixture.mike,
      origin: { kind: "DOCUMENT", documentId: original.documentId },
    });
    const longPath = `${"nested/".repeat(80)}deep.md`;
    expect(longPath.length).toBeGreaterThan(512);

    for (const sourcePath of ["Docs/A.md", "docs/a.md", longPath]) {
      await expect(
        fixture.createTeamDocument({
          publication,
          creatorContributionId: publication.contributionId,
          originalDocumentId: original.documentId,
          sourcePath,
        }),
      ).resolves.toBeTruthy();
    }
  });

  it("compares the binary path, not only the hash, when reading a document back", async () => {
    const original = await fixture.createHubOriginal(fixture.mike, "Read source", "read");
    const publication = await fixture.createPublication({
      name: "Read Publication",
      kind: "DOCUMENT",
      creator: fixture.mike,
      origin: { kind: "DOCUMENT", documentId: original.documentId },
    });
    const created = await fixture.createTeamDocument({
      publication,
      creatorContributionId: publication.contributionId,
      originalDocumentId: original.documentId,
      sourcePath: "Docs/Read.md",
    });
    const documents = await fixture.uow.run((repositories) => repositories.publications.listDocuments(publication.publication.id));
    const stored = documents.find((document) => document.teamDocumentId === created.teamDocumentId);
    expect(stored?.sourcePath).toBe("Docs/Read.md");
    const [hash] = await fixture.pool.query<{ path_hash: Buffer }[]>(
      "SELECT path_hash FROM publication_documents WHERE team_document_id = ?",
      [created.teamDocumentId],
    );
    expect(hash.path_hash).toHaveLength(32);
  });

  it("applies a path swap in one transaction instead of failing row by row", async () => {
    const original = await fixture.createHubOriginal(fixture.mike, "Swap source", "swap");
    const publication = await fixture.createPublication({
      name: "Swap Publication",
      kind: "FOLDER",
      creator: fixture.mike,
      origin: {
        kind: "FOLDER",
        folderNodeId: (await fixture.createFolder(fixture.mike, "repo/swap", "swap")).treeNodeId,
      },
    });
    const first = await fixture.createTeamDocument({
      publication, creatorContributionId: publication.contributionId,
      originalDocumentId: original.documentId, sourcePath: "a.md",
    });
    const second = await fixture.createTeamDocument({
      publication, creatorContributionId: publication.contributionId,
      originalDocumentId: original.documentId, sourcePath: "b.md",
    });

    await fixture.uow.run((repositories) => repositories.publications.applyPaths(publication.publication.id, [
      { teamDocumentId: first.teamDocumentId, fromPath: "a.md", toPath: "b.md" },
      { teamDocumentId: second.teamDocumentId, fromPath: "b.md", toPath: "a.md" },
    ]));

    const documents = await fixture.uow.run((repositories) => repositories.publications.listDocuments(publication.publication.id));
    expect(documents.map((document) => [document.teamDocumentId, document.sourcePath]).sort()).toEqual([
      [first.teamDocumentId, "b.md"],
      [second.teamDocumentId, "a.md"],
    ].sort());
  });

  it("cannot clear or rewrite another publication's path reservation", async () => {
    const original = await fixture.createHubOriginal(fixture.mike, "Scope source", "scope");
    const firstFolder = await fixture.createFolder(fixture.mike, `repo/scope-a-${uuidv7()}`, "scope-a");
    const secondFolder = await fixture.createFolder(fixture.mike, `repo/scope-b-${uuidv7()}`, "scope-b");
    const first = await fixture.createPublication({
      name: `Scope A ${uuidv7()}`,
      kind: "FOLDER",
      creator: fixture.mike,
      origin: { kind: "FOLDER", folderNodeId: firstFolder.treeNodeId },
    });
    const second = await fixture.createPublication({
      name: `Scope B ${uuidv7()}`,
      kind: "FOLDER",
      creator: fixture.mike,
      origin: { kind: "FOLDER", folderNodeId: secondFolder.treeNodeId },
    });
    const firstDocument = await fixture.createTeamDocument({
      publication: first, creatorContributionId: first.contributionId,
      originalDocumentId: original.documentId, sourcePath: "shared.md",
    });
    const secondDocument = await fixture.createTeamDocument({
      publication: second, creatorContributionId: second.contributionId,
      originalDocumentId: original.documentId, sourcePath: "shared.md",
    });

    // A move routed through the first publication names the second one's
    // document; the publication scope must leave that reservation untouched.
    await fixture.uow.run((repositories) => repositories.publications.applyPaths(first.publication.id, [
      { teamDocumentId: secondDocument.teamDocumentId, fromPath: "shared.md", toPath: "stolen.md" },
    ]));

    const secondDocuments = await fixture.uow.run((repositories) =>
      repositories.publications.listDocuments(second.publication.id));
    expect(secondDocuments.map((document) => document.sourcePath)).toEqual(["shared.md"]);
    const firstDocuments = await fixture.uow.run((repositories) =>
      repositories.publications.listDocuments(first.publication.id));
    expect(firstDocuments.map((document) => document.sourcePath)).toEqual(["shared.md"]);
    expect(firstDocument.teamDocumentId).not.toBe(secondDocument.teamDocumentId);
  });
});

describe("publication document metadata", () => {
  it("answers findDocument only for the publication source that owns the team document", async () => {
    const original = await fixture.createHubOriginal(fixture.mike, "Metadata source", "metadata");
    const folder = await fixture.createFolder(fixture.mike, `repo/metadata-${uuidv7()}`, "metadata");
    const publication = await fixture.createPublication({
      name: `Metadata ${uuidv7()}`,
      kind: "FOLDER",
      creator: fixture.mike,
      origin: { kind: "FOLDER", folderNodeId: folder.treeNodeId },
    });
    const document = await fixture.createTeamDocument({
      publication, creatorContributionId: publication.contributionId,
      originalDocumentId: original.documentId, sourcePath: "notes/a.md",
    });
    const otherFolder = await fixture.createFolder(fixture.mike, `repo/other-meta-${uuidv7()}`, "other-meta");
    const other = await fixture.createPublication({
      name: `Other Metadata ${uuidv7()}`,
      kind: "FOLDER",
      creator: fixture.mike,
      origin: { kind: "FOLDER", folderNodeId: otherFolder.treeNodeId },
    });

    const found = await fixture.uow.run((repositories) =>
      repositories.publications.findDocument(document.teamDocumentId, publication.sourceId));
    expect(found).toEqual({
      creatorUserId: fixture.mike.identity.id,
      publicationId: publication.publication.id,
      sourcePath: "notes/a.md",
    });

    // The same row cannot be read through a different publication's source.
    await expect(fixture.uow.run((repositories) =>
      repositories.publications.findDocument(document.teamDocumentId, other.sourceId)))
      .resolves.toBeNull();
  });
});

describe("publication document views", () => {
  it("carries the creator contribution's state for every member, not just its maintainer", async () => {
    const original = await fixture.createHubOriginal(fixture.mike, "View source", "view");
    const publication = await fixture.createPublication({
      name: "View Publication",
      kind: "DOCUMENT",
      creator: fixture.mike,
      origin: { kind: "DOCUMENT", documentId: original.documentId },
    });
    const created = await fixture.createTeamDocument({
      publication,
      creatorContributionId: publication.contributionId,
      originalDocumentId: original.documentId,
      sourcePath: "view.md",
    });

    const [initial] = await fixture.uow.run((repositories) =>
      repositories.publications.listDocumentViews(publication.publication.id));
    expect(initial).toMatchObject({
      teamDocumentId: created.teamDocumentId,
      creatorUserId: fixture.mike.identity.id,
      creatorName: "Mike",
      leftAt: null,
      rightsFrozenAt: null,
      pendingCatchUp: false,
    });

    const leftAt = new Date("2026-10-20T00:00:00Z");
    await fixture.uow.run((repositories) => repositories.publications.setContributionState(
      publication.contributionId,
      { leftAt, rightsFrozenAt: null, pendingCatchUp: true },
    ));
    const [left] = await fixture.uow.run((repositories) =>
      repositories.publications.listDocumentViews(publication.publication.id));
    expect(left.leftAt?.getTime()).toBe(leftAt.getTime());
    expect(left.pendingCatchUp).toBe(true);

    const frozenAt = new Date("2026-10-21T00:00:00Z");
    await fixture.uow.run((repositories) => repositories.publications.setContributionState(
      publication.contributionId,
      { leftAt: null, rightsFrozenAt: frozenAt, pendingCatchUp: false },
    ));
    const [frozen] = await fixture.uow.run((repositories) =>
      repositories.publications.listDocumentViews(publication.publication.id));
    expect(frozen.rightsFrozenAt?.getTime()).toBe(frozenAt.getTime());
    expect(frozen.leftAt).toBeNull();
  });
});

describe("publication event progress", () => {
  it("one delivery completing leaves the root event unconsumed while another is pending", async () => {
    const original = await fixture.createHubOriginal(fixture.mike, "Delivery source", "delivery");
    const first = await fixture.createPublication({
      name: "Delivery One",
      kind: "DOCUMENT",
      creator: fixture.mike,
      origin: { kind: "DOCUMENT", documentId: original.documentId },
    });
    const second = await fixture.createPublication({
      name: "Delivery Two",
      kind: "DOCUMENT",
      creator: fixture.mike,
      origin: { kind: "DOCUMENT", documentId: original.documentId },
    });
    expect(first.contributionId).not.toBe(second.contributionId);

    await fixture.uow.run(async (repositories) => {
      await repositories.publicationEvents.record({
        documentId: original.documentId,
        treeNodeId: null,
        kind: "REVISION",
        revisionId: original.revisionId,
        at: new Date(),
      });
      await repositories.publications.prepareDeliveries(100);
    });

    const rows = await fixture.pool.query<{ id: string }[]>(
      "SELECT id FROM publication_events WHERE document_id = ? ORDER BY created_at DESC LIMIT 1",
      [original.documentId],
    );
    const eventId = String(rows[0]?.id);
    expect(eventId).not.toBe("");
    const pending = await fixture.uow.run((repositories) => repositories.publications.listPendingEvents(undefined, 100));
    expect(pending.filter((row) => row.eventId === eventId)).toHaveLength(2);
    await fixture.uow.run((repositories) =>
      repositories.publications.completeDelivery(eventId, first.contributionId, "APPLIED"));

    const [half] = await fixture.pool.query<{ consumed_at: Date | null }[]>(
      "SELECT consumed_at FROM publication_events WHERE id = ?",
      [eventId],
    );
    expect(half.consumed_at).toBeNull();

    await fixture.uow.run((repositories) =>
      repositories.publications.completeDelivery(eventId, second.contributionId, "SKIPPED"));

    const [done] = await fixture.pool.query<{ consumed_at: Date | null }[]>(
      "SELECT consumed_at FROM publication_events WHERE id = ?",
      [eventId],
    );
    expect(done.consumed_at).not.toBeNull();
  });

  it("consumes the root event exactly when the last concurrent delivery finishes", async () => {
    const original = await fixture.createHubOriginal(fixture.mike, "Concurrent delivery source", "concurrent");
    const first = await fixture.createPublication({
      name: "Concurrent Delivery One",
      kind: "DOCUMENT",
      creator: fixture.mike,
      origin: { kind: "DOCUMENT", documentId: original.documentId },
    });
    const second = await fixture.createPublication({
      name: "Concurrent Delivery Two",
      kind: "DOCUMENT",
      creator: fixture.mike,
      origin: { kind: "DOCUMENT", documentId: original.documentId },
    });

    for (let round = 0; round < 5; round += 1) {
      await fixture.uow.run(async (repositories) => {
        await repositories.publicationEvents.record({
          documentId: original.documentId,
          treeNodeId: null,
          kind: "REVISION",
          revisionId: original.revisionId,
          at: new Date(Date.now() + round),
        });
        await repositories.publications.prepareDeliveries(100);
      });
      const rows = await fixture.pool.query<{ id: string }[]>(
        "SELECT id FROM publication_events WHERE document_id = ? ORDER BY created_at DESC, id DESC LIMIT 1",
        [original.documentId],
      );
      const eventId = String(rows[0]?.id);
      const pending = (await fixture.uow.run((repositories) =>
        repositories.publications.listPendingEvents(undefined, 100)))
        .filter((row) => row.eventId === eventId);
      expect(pending).toHaveLength(2);

      // Two real transactions on separate pool connections. The event-row lock
      // makes them finish one after the other; whichever finishes last must
      // consume the event, so no interleaving can leave it pending.
      await Promise.all([
        fixture.uow.run((repositories) =>
          repositories.publications.completeDelivery(eventId, first.contributionId, "APPLIED")),
        fixture.uow.run((repositories) =>
          repositories.publications.completeDelivery(eventId, second.contributionId, "SKIPPED")),
      ]);

      const [event] = await fixture.pool.query<{ consumed_at: Date | null }[]>(
        "SELECT consumed_at FROM publication_events WHERE id = ?",
        [eventId],
      );
      expect(event.consumed_at).not.toBeNull();
      const processed = await fixture.pool.query<{ n: unknown }[]>(
        "SELECT COUNT(*) AS n FROM publication_event_deliveries WHERE event_id = ? AND processed_at IS NOT NULL",
        [eventId],
      );
      expect(Number(processed[0]?.n)).toBe(2);
    }
  });

  it("advances past events that already have deliveries when the window is full", async () => {
    const original = await fixture.createHubOriginal(fixture.mike, "Window source", "window");
    const publication = await fixture.createPublication({
      name: "Window Publication",
      kind: "DOCUMENT",
      creator: fixture.mike,
      origin: { kind: "DOCUMENT", documentId: original.documentId },
    });
    for (let index = 0; index < 3; index += 1) {
      await fixture.uow.run((repositories) => repositories.publicationEvents.record({
        documentId: original.documentId,
        treeNodeId: null,
        kind: "REVISION",
        revisionId: original.revisionId,
        at: new Date(Date.now() + index),
      }));
    }
    for (let index = 0; index < 3; index += 1) {
      await fixture.uow.run((repositories) => repositories.publications.prepareDeliveries(1));
    }
    const deliveries = await fixture.pool.query<{ event_id: string }[]>(
      `SELECT DISTINCT d.event_id FROM publication_event_deliveries d
       JOIN publication_events e ON e.id = d.event_id
       WHERE e.document_id = ?`,
      [original.documentId],
    );
    expect(deliveries).toHaveLength(3);
    const pending = await fixture.uow.run((repositories) => repositories.publications.listPendingEvents(undefined, 100));
    expect(pending.filter((row) => row.contributionId === publication.contributionId)).toHaveLength(3);
  });

  it("completes an event with no affected contribution instead of leaving it pending forever", async () => {
    const unrelated = await fixture.createHubOriginal(fixture.mike, "No publication", "unrelated");
    await fixture.uow.run(async (repositories) => {
      await repositories.publicationEvents.record({
        documentId: unrelated.documentId,
        treeNodeId: null,
        kind: "REVISION",
        revisionId: unrelated.revisionId,
        at: new Date(),
      });
      await repositories.publications.prepareDeliveries(100);
    });
    const [row] = await fixture.pool.query<{ consumed_at: Date | null }[]>(
      "SELECT consumed_at FROM publication_events WHERE document_id = ?",
      [unrelated.documentId],
    );
    expect(row.consumed_at).not.toBeNull();
  });

  it("round-trips reconcile reports as JSON", async () => {
    const original = await fixture.createHubOriginal(fixture.mike, "Report source", "report");
    const publication = await fixture.createPublication({
      name: "Report Publication",
      kind: "DOCUMENT",
      creator: fixture.mike,
      origin: { kind: "DOCUMENT", documentId: original.documentId },
    });
    const report = {
      created: 1,
      updated: 2,
      moved: 3,
      archived: 4,
      restored: 5,
      notices: [{
        publicationId: publication.publication.id,
        originalDocumentId: original.documentId,
        code: "PATH_RESERVED" as const,
        existingPublicationName: "Other",
      }],
    };
    await fixture.uow.run((repositories) => repositories.publications.saveReport(publication.contributionId, report));
    const read = await fixture.uow.run((repositories) => repositories.publications.findReport(publication.contributionId));
    expect(read).toEqual(report);
  });
});

describe("nullable link fields", () => {
  it("round-trips NULL link fields without becoming the string \"null\"", async () => {
    const original = await fixture.createHubOriginal(fixture.mike, "Discussion source", "discussion");
    const discussion = await fixture.createDiscussion({
      workspaceId: fixture.mikePersonalWorkspaceId,
      documentId: original.documentId,
      revisionId: await fixture.revisionIdOf(original.documentId),
      authorId: fixture.mike.identity.id,
    });
    // A team comment event carries its recipient instead of a link.
    await fixture.uow.run((repositories) => repositories.shareCommentEvents.insert({
      id: uuidv7(), workspaceId: fixture.mikePersonalWorkspaceId,
      documentId: original.documentId, threadId: discussion.threadId, commentId: discussion.commentId,
      originShareLinkId: null, createdByUserId: fixture.mike.identity.id, mentionedUserId: null,
      recipientUserId: fixture.ann.identity.id, createdAt: new Date(), readAt: null,
    }));

    const publication = await fixture.createPublication({
      name: "Mention Publication",
      kind: "DOCUMENT",
      creator: fixture.mike,
      origin: { kind: "DOCUMENT", documentId: original.documentId },
    });
    const teamDocument = await fixture.createTeamDocument({
      publication,
      creatorContributionId: publication.contributionId,
      originalDocumentId: original.documentId,
      sourcePath: null,
    });
    const teamDiscussion = await fixture.createDiscussion({
      workspaceId: fixture.teamWorkspaceId,
      documentId: teamDocument.teamDocumentId,
      revisionId: await fixture.revisionIdOf(teamDocument.teamDocumentId),
      authorId: fixture.mike.identity.id,
    });
    await fixture.uow.run((repositories) => repositories.reviewMentions.insertMany([{
      commentId: teamDiscussion.commentId, mentionedUserId: fixture.ann.identity.id,
      shareLinkId: null, createdAt: new Date(), readAt: null,
    }]));

    const events = await fixture.uow.run((repositories) => repositories.shareCommentEvents.listRecentByRecipient(fixture.mike.identity.id, undefined, 10));
    expect(events[0].originShareLinkId).toBeNull();
    expect(events[0].recipientUserId).toBe(fixture.ann.identity.id);
    const mentions = await fixture.uow.run((repositories) => repositories.reviewMentions.listRecentByRecipient(fixture.ann.identity.id, 10));
    expect(mentions[0].shareLinkId).toBeNull();
  });

  it("rejects the anonymous both-NULL comment event", async () => {
    const original = await fixture.createHubOriginal(fixture.mike, "Anonymous source", "anonymous");
    const discussion = await fixture.createDiscussion({
      workspaceId: fixture.mikePersonalWorkspaceId,
      documentId: original.documentId,
      revisionId: await fixture.revisionIdOf(original.documentId),
      authorId: fixture.mike.identity.id,
    });
    await expect(
      fixture.uow.run((repositories) => repositories.shareCommentEvents.insert({
        id: uuidv7(), workspaceId: fixture.mikePersonalWorkspaceId,
        documentId: original.documentId, threadId: discussion.threadId, commentId: discussion.commentId,
        originShareLinkId: null, createdByUserId: fixture.mike.identity.id, mentionedUserId: null,
        recipientUserId: null, createdAt: new Date(), readAt: null,
      })),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });

    await expect(
      fixture.pool.query(
        `INSERT INTO share_comment_events
           (id, workspace_id, document_id, thread_id, comment_id, origin_share_link_id, created_by_user_id, mentioned_user_id, recipient_user_id, created_at, read_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, NULL, ?, NULL)`,
        [uuidv7(), fixture.mikePersonalWorkspaceId, original.documentId, discussion.threadId, discussion.commentId, fixture.mike.identity.id, new Date()],
      ),
    ).rejects.toMatchObject({ errno: 4025 });
  });

  it("rejects a link-less mention outside a team publication", async () => {
    const original = await fixture.createHubOriginal(fixture.mike, "Personal mention source", "personal");
    const discussion = await fixture.createDiscussion({
      workspaceId: fixture.mikePersonalWorkspaceId,
      documentId: original.documentId,
      revisionId: await fixture.revisionIdOf(original.documentId),
      authorId: fixture.mike.identity.id,
    });
    await expect(
      fixture.uow.run((repositories) => repositories.reviewMentions.insertMany([{
        commentId: discussion.commentId, mentionedUserId: fixture.ann.identity.id,
        shareLinkId: null, createdAt: new Date(), readAt: null,
      }])),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });
});
