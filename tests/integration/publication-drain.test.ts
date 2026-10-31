import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CallerContext } from "@/modules/identity/domain/caller-context";
import { HubKnowledgeCommandServiceImpl } from "@/modules/knowledge/application/hub-knowledge-command-service";
import { ApplyFolderImportService } from "@/modules/sources/application/apply-folder-import";
import {
  CreateFolderImportService,
  type ImportManifestEntry,
} from "@/modules/sources/application/create-folder-import";
import { FinalizeFolderImportService } from "@/modules/sources/application/finalize-folder-import";
import { GetFolderImportPreviewService } from "@/modules/sources/application/get-folder-import-preview";
import { drainPublicationEvents } from "@/modules/sources/application/publication-drain";
import { PublicationService } from "@/modules/sources/application/publication-service";
import { UploadFolderImportEntriesService } from "@/modules/sources/application/upload-folder-import-entries";
import { SourceApplicationService } from "@/modules/sources/application/source-version-guard";
import { DEFAULT_IMPORT_LIMITS } from "@/modules/sources/domain/import-limits";
import type { PublicationNotice } from "@/modules/sources/domain/publication";
import type { SourceRepositories, SourceUnitOfWork } from "@/modules/sources/ports/unit-of-work";
import { schedulePublicationDrain, withPostCommitDrain } from "@/server/publication-post-commit";
import { createDirectMembership } from "@/modules/workspaces/domain/workspace-membership";
import { uuidv7 } from "@/shared/ids/uuidv7";
import { createPublicationFixture, type PublicationFixture } from "../fixtures/publications";

let fixture: PublicationFixture;

beforeAll(async () => {
  fixture = await createPublicationFixture();
});

afterAll(async () => {
  await fixture.dispose();
});

beforeEach(async () => {
  await fixture.pool.query("DELETE FROM publication_event_deliveries");
  await fixture.pool.query("DELETE FROM publication_events");
});

type SyncedDocument = Awaited<ReturnType<PublicationFixture["createSyncedOriginal"]>>;

type FailureOptions = {
  /** Throws once when this publication is read by a reconcile. */
  failPublicationOnce?: string;
  /** Throws once instead of completing a delivery, rolling the transaction back. */
  failCompleteOnce?: boolean;
  /** Inserts one extra event inside a delivery transaction. */
  insertEventOnce?: { documentId: string; revisionId: string };
};

/**
 * A real unit of work with one injected fault, so the retry path is exercised
 * through the production drain rather than a fake reconciler.
 */
function failingUow(base: SourceUnitOfWork, options: FailureOptions): SourceUnitOfWork {
  let tripped = false;
  return {
    async run<T>(work: (repositories: SourceRepositories) => Promise<T>): Promise<T> {
      return base.run(async (repositories) => {
        const publications = new Proxy(repositories.publications, {
          get(target, property, receiver) {
            if (
              property === "findById"
              && options.failPublicationOnce !== undefined
              && !tripped
            ) {
              return async (id: string) => {
                if (id === options.failPublicationOnce) {
                  tripped = true;
                  throw new Error("injected publication failure");
                }
                return target.findById(id);
              };
            }
            if (
              property === "completeDelivery"
              && !tripped
              && (options.failCompleteOnce === true || options.insertEventOnce !== undefined)
            ) {
              return async (eventId: string, contributionId: string, outcome: "APPLIED" | "SKIPPED") => {
                tripped = true;
                if (options.insertEventOnce) {
                  await repositories.publicationEvents.recordMany([{
                    documentId: options.insertEventOnce.documentId,
                    treeNodeId: null,
                    sourceId: null,
                    kind: "REVISION",
                    revisionId: options.insertEventOnce.revisionId,
                    at: new Date(),
                  }]);
                }
                if (options.failCompleteOnce) throw new Error("injected delivery failure");
                return target.completeDelivery(eventId, contributionId, outcome);
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
  };
}

/** Counts full publication-source tree reads made inside `run`. */
function countingTreeReads(base: SourceUnitOfWork): {
  uow: SourceUnitOfWork;
  reads: () => number;
} {
  let reads = 0;
  return {
    reads: () => reads,
    uow: {
      async run<T>(work: (repositories: SourceRepositories) => Promise<T>): Promise<T> {
        return base.run(async (repositories) => {
          const tree = new Proxy(repositories.tree, {
            get(target, property, receiver) {
              if (property === "listBySource") {
                return async (sourceId: string) => {
                  reads += 1;
                  return target.listBySource(sourceId);
                };
              }
              return Reflect.get(target, property, receiver);
            },
          });
          const wrapped = new Proxy(repositories, {
            get(target, property, receiver) {
              return property === "tree" ? tree : Reflect.get(target, property, receiver);
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

/** The import must commit even when the display-only notice lookup throws. */
function noticeFailingUow(base: SourceUnitOfWork): SourceUnitOfWork {
  return {
    async run<T>(work: (repositories: SourceRepositories) => Promise<T>): Promise<T> {
      return base.run(async (repositories) => {
        const publications = new Proxy(repositories.publications, {
          get(target, property, receiver) {
            if (property === "listByContributor") {
              return async () => {
                throw new Error("injected notice lookup failure");
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
  };
}

async function folderWithDocuments(
  caller: CallerContext,
  folderPath: string,
  files: readonly { name: string; text: string; title?: string }[],
): Promise<{ folderNodeId: string; documents: Record<string, SyncedDocument> }> {
  const folder = await fixture.createFolder(caller, folderPath, folderPath.split("/").at(-1) ?? folderPath);
  const documents: Record<string, SyncedDocument> = {};
  for (const file of files) {
    documents[file.name] = await fixture.createSyncedOriginal(caller, {
      parentId: folder.treeNodeId,
      sourcePath: `${folderPath}/${file.name}`,
      title: file.title ?? file.name,
      markdown: file.text,
    });
  }
  return { folderNodeId: folder.treeNodeId, documents };
}

async function publishFolder(
  caller: CallerContext,
  teamWorkspaceId: string,
  name: string,
  folderNodeId: string,
) {
  return fixture.createPublication({
    teamWorkspaceId,
    name,
    kind: "FOLDER",
    creator: caller,
    origin: { kind: "FOLDER", folderNodeId },
  });
}

async function publicationDocuments(publicationId: string) {
  return fixture.uow.run((repositories) => repositories.publications.listDocuments(publicationId));
}

async function contributionOf(publicationId: string, userId: string) {
  const contributions = await fixture.uow.run((repositories) =>
    repositories.publications.listContributions(publicationId));
  return contributions.find((contribution) => contribution.userId === userId);
}

async function discussionCount(documentId: string): Promise<number> {
  const [row] = await fixture.pool.query<{ total: unknown }[]>(
    "SELECT COUNT(*) AS total FROM document_review_threads WHERE document_id = ?",
    [documentId],
  );
  return Number(row?.total ?? 0);
}

async function eventRows(documentId: string): Promise<{ id: string; consumed_at: Date | null }[]> {
  return fixture.pool.query<{ id: string; consumed_at: Date | null }[]>(
    "SELECT id, consumed_at FROM publication_events WHERE document_id = ? ORDER BY created_at, id",
    [documentId],
  );
}

async function deliveryRows(eventId: string): Promise<{ contribution_id: string; processed_at: Date | null; outcome: string | null }[]> {
  return fixture.pool.query<{ contribution_id: string; processed_at: Date | null; outcome: string | null }[]>(
    `SELECT contribution_id, processed_at, outcome
     FROM publication_event_deliveries WHERE event_id = ? ORDER BY contribution_id`,
    [eventId],
  );
}

async function revisionCount(documentId: string): Promise<number> {
  const [row] = await fixture.pool.query<{ total: number }[]>(
    "SELECT COUNT(*) AS total FROM knowledge_revisions WHERE document_id = ?",
    [documentId],
  );
  return Number(row.total);
}

async function currentTitle(documentId: string): Promise<string> {
  const [row] = await fixture.pool.query<{ title: string }[]>(
    `SELECT r.title FROM knowledge_revisions r
     JOIN knowledge_documents d ON d.current_revision_id = r.id
     WHERE d.id = ?`,
    [documentId],
  );
  return row.title;
}

function noticesOf(value: { publicationNotices?: PublicationNotice[] } | null): PublicationNotice[] {
  return value?.publicationNotices ?? [];
}

function hasNotice(
  notices: readonly PublicationNotice[],
  expected: Pick<PublicationNotice, "code" | "publicationId"> & {
    originalDocumentId?: string;
    sourcePath?: string;
    maintainerUserId?: string;
  },
): boolean {
  return notices.some((notice) =>
    notice.code === expected.code
    && notice.publicationId === expected.publicationId
    && (expected.originalDocumentId === undefined
      || notice.originalDocumentId === expected.originalDocumentId)
    && (expected.sourcePath === undefined || notice.sourcePath === expected.sourcePath)
    && (expected.maintainerUserId === undefined || notice.maintainerUserId === expected.maintainerUserId));
}

async function adoptExternalId(caller: CallerContext, sourceId: string, documentId: string, externalId: string): Promise<void> {
  const entry = await fixture.uow.run((repositories) => repositories.entries.findByDocumentId(documentId));
  if (!entry || entry.sourceId !== sourceId) throw new Error("Fixture document has no source entry.");
  await fixture.uow.run((repositories) =>
    repositories.entries.update({ ...entry, externalId, updatedBy: caller.identity.id }));
}

async function knownEntryInput(
  documentId: string,
  content: { title: string; markdown: string },
  sourceId = fixture.mikeFolderSourceId,
) {
  return fixture.uow.run(async (repositories) => {
    const source = await repositories.sources.findById(sourceId);
    const entry = await repositories.entries.findByDocumentId(documentId);
    if (!source || !entry) throw new Error("Fixture source entry is missing.");
    return {
      sourceId,
      basedOnVersion: source.syncVersion,
      entryId: entry.id,
      documentId,
      externalId: entry.externalId,
      sourcePath: entry.sourcePath,
      content: { ...content, metadata: {} },
    };
  });
}

function importServices() {
  const uow = fixture.uow;
  return {
    create: new CreateFolderImportService(uow, { limits: DEFAULT_IMPORT_LIMITS }),
    upload: new UploadFolderImportEntriesService(uow, { limits: DEFAULT_IMPORT_LIMITS }),
    finalize: new FinalizeFolderImportService(uow, { limits: DEFAULT_IMPORT_LIMITS }),
    apply: new ApplyFolderImportService(uow),
    preview: new GetFolderImportPreviewService(uow),
  };
}

async function readyResync(
  caller: CallerContext,
  sourceId: string,
  rootName: string,
  files: readonly { path: string; text: string }[],
): Promise<string> {
  const services = importServices();
  const entries = files.map((file, index) => {
    const bytes = new TextEncoder().encode(file.text);
    const manifest: ImportManifestEntry = {
      uploadKey: `f${index}`,
      relativePath: file.path,
      kind: "MARKDOWN",
      size: bytes.byteLength,
    };
    return { manifest, bytes };
  });
  const session = await services.create.createResync(caller, {
    sourceId,
    rootName,
    manifest: entries.map((entry) => entry.manifest),
  });
  await services.upload.upload(caller, {
    snapshotId: session.snapshotId,
    entries: entries.map((entry, index) => ({ uploadKey: `f${index}`, bytes: entry.bytes })),
  });
  await services.finalize.finalize(caller, session.snapshotId);
  return session.snapshotId;
}

describe("publication drain", () => {
  it("keeps the root event unconsumed when one team fails and catches up on retry", async () => {
    const path = `fanout-${uuidv7()}`;
    const { folderNodeId, documents } = await folderWithDocuments(fixture.mike, path, [
      { name: "a.md", text: "# A\n\nfirst\n" },
    ]);
    const first = await publishFolder(
      fixture.mike, fixture.teamWorkspaceId, `First ${path}`, folderNodeId);
    const second = await publishFolder(
      fixture.mike, fixture.groupTeamWorkspaceId, `Second ${path}`, folderNodeId);

    const failing = failingUow(fixture.uow, { failPublicationOnce: second.publication.id });
    const result = await drainPublicationEvents(failing, {
      judge: { kind: "CALLER", caller: fixture.mike },
    });
    expect(result.failed).toBeGreaterThanOrEqual(1);
    expect(result.applied).toBeGreaterThanOrEqual(1);

    const [event] = await eventRows(documents["a.md"].documentId);
    expect(event.consumed_at).toBeNull();
    const deliveries = await deliveryRows(event.id);
    expect(deliveries).toHaveLength(2);
    expect(deliveries.filter((delivery) => delivery.processed_at !== null)).toHaveLength(1);
    expect(await publicationDocuments(first.publication.id)).toHaveLength(1);
    expect(await publicationDocuments(second.publication.id)).toHaveLength(0);
    const firstDocumentId = (await publicationDocuments(first.publication.id))[0].teamDocumentId;
    const revisionsAfterFirst = await revisionCount(firstDocumentId);

    const retry = await drainPublicationEvents(fixture.uow, {
      judge: { kind: "CALLER", caller: fixture.mike },
    });
    expect(retry.applied).toBeGreaterThanOrEqual(1);
    const [retried] = await eventRows(documents["a.md"].documentId);
    expect(retried.consumed_at).not.toBeNull();
    expect(await publicationDocuments(second.publication.id)).toHaveLength(1);
    expect(await revisionCount(firstDocumentId)).toBe(revisionsAfterFirst);
    expect(await publicationDocuments(first.publication.id)).toHaveLength(1);
  });

  it("rolls back reconciliation and delivery consumption together", async () => {
    const path = `rollback-${uuidv7()}`;
    const { folderNodeId, documents } = await folderWithDocuments(fixture.mike, path, [
      { name: "a.md", text: "# A\n\nrollback\n" },
    ]);
    const publication = await publishFolder(
      fixture.mike, fixture.teamWorkspaceId, `Rollback ${path}`, folderNodeId);

    const result = await drainPublicationEvents(
      failingUow(fixture.uow, { failCompleteOnce: true }),
      { judge: { kind: "CALLER", caller: fixture.mike } },
    );
    expect(result.failed).toBeGreaterThanOrEqual(1);

    const [event] = await eventRows(documents["a.md"].documentId);
    expect(event.consumed_at).toBeNull();
    expect((await deliveryRows(event.id))[0].processed_at).toBeNull();
    expect(await publicationDocuments(publication.publication.id)).toHaveLength(0);

    const retry = await drainPublicationEvents(fixture.uow, {
      judge: { kind: "CALLER", caller: fixture.mike },
    });
    expect(retry.applied).toBeGreaterThanOrEqual(1);
    expect((await publicationDocuments(publication.publication.id))[0]).toBeDefined();
    expect((await eventRows(documents["a.md"].documentId))[0].consumed_at).not.toBeNull();
  });

  it("lets a late or repeated event re-read current state without regressing a revision", async () => {
    const path = `late-${uuidv7()}`;
    const { folderNodeId, documents } = await folderWithDocuments(fixture.mike, path, [
      { name: "a.md", text: "# A\n\nv1\n", title: "A" },
    ]);
    const publication = await publishFolder(
      fixture.mike, fixture.teamWorkspaceId, `Late ${path}`, folderNodeId);
    await drainPublicationEvents(fixture.uow, { judge: { kind: "CALLER", caller: fixture.mike } });

    const original = documents["a.md"];
    const v2 = await fixture.uow.run(async (repositories) => {
      const { bindSourceProjection } = await import(
        "@/modules/sources/application/source-knowledge-projection-service"
      );
      return bindSourceProjection(repositories, {
        id: fixture.mikeFolderSourceId,
        workspaceId: fixture.mikePersonalWorkspaceId,
      }).projectRevision(fixture.mike, {
        documentId: original.documentId,
        expectedCurrentRevisionId: original.revisionId,
        title: "A",
        markdown: "# A\n\nv2\n",
        metadata: {},
      });
    });
    await drainPublicationEvents(fixture.uow, { judge: { kind: "CALLER", caller: fixture.mike } });

    const [teamDocument] = await publicationDocuments(publication.publication.id);
    expect(await currentTitle(teamDocument.teamDocumentId)).toBe("A");
    const revisions = await revisionCount(teamDocument.teamDocumentId);
    expect(revisions).toBe(2);

    await fixture.uow.run((repositories) => repositories.publicationEvents.recordMany([{
      documentId: original.documentId,
      treeNodeId: null,
      sourceId: null,
      kind: "REVISION",
      revisionId: v2.revisionId,
      at: new Date(),
    }]));
    await drainPublicationEvents(fixture.uow, { judge: { kind: "CALLER", caller: fixture.mike } });
    await drainPublicationEvents(fixture.uow, { judge: { kind: "CALLER", caller: fixture.mike } });

    expect(await revisionCount(teamDocument.teamDocumentId)).toBe(revisions);
    expect((await fixture.uow.run((repositories) =>
      repositories.revisions.findCurrent(teamDocument.teamDocumentId)))?.markdown).toContain("v2");
  });

  it("drains only the caller's contributions and leaves another person's event", async () => {
    const path = `caller-${uuidv7()}`;
    const mike = await folderWithDocuments(fixture.mike, `${path}/mike`, [
      { name: "a.md", text: "# Mike\n\nmike\n" },
    ]);
    const mikePublication = await publishFolder(
      fixture.mike, fixture.teamWorkspaceId, `Mike ${path}`, mike.folderNodeId);
    const ann = await folderWithDocuments(fixture.ann, `${path}/ann`, [
      { name: "b.md", text: "# Ann\n\nann\n" },
    ]);
    const annPublication = await publishFolder(
      fixture.ann, fixture.teamWorkspaceId, `Ann ${path}`, ann.folderNodeId);

    const mikeResult = await drainPublicationEvents(fixture.uow, {
      judge: { kind: "CALLER", caller: fixture.mike },
    });
    expect(mikeResult.applied).toBeGreaterThanOrEqual(1);
    expect(await publicationDocuments(mikePublication.publication.id)).toHaveLength(1);
    expect(await publicationDocuments(annPublication.publication.id)).toHaveLength(0);
    expect((await eventRows(ann.documents["b.md"].documentId))[0].consumed_at).toBeNull();

    const annResult = await drainPublicationEvents(fixture.uow, {
      judge: { kind: "CALLER", caller: fixture.ann },
    });
    expect(annResult.applied).toBeGreaterThanOrEqual(1);
    expect(await publicationDocuments(annPublication.publication.id)).toHaveLength(1);
    expect((await eventRows(ann.documents["b.md"].documentId))[0].consumed_at).not.toBeNull();
  });

  it("applies direct members, pends group-only contributors, and keeps a rights freeze under no caller", async () => {
    const path = `nocaller-${uuidv7()}`;
    const direct = await folderWithDocuments(fixture.mike, `${path}/direct`, [
      { name: "a.md", text: "# Direct\n\ndirect\n" },
    ]);
    const directPublication = await publishFolder(
      fixture.mike, fixture.teamWorkspaceId, `Direct ${path}`, direct.folderNodeId);

    const group = await folderWithDocuments(fixture.ann, `${path}/group`, [
      { name: "g.md", text: "# Group\n\ngroup\n" },
    ]);
    const groupPublication = await publishFolder(
      fixture.ann, fixture.groupTeamWorkspaceId, `Group ${path}`, group.folderNodeId);

    const frozen = await folderWithDocuments(fixture.mike, `${path}/frozen`, [
      { name: "f.md", text: "# Frozen\n\nfrozen\n" },
    ]);
    const frozenPublication = await publishFolder(
      fixture.mike, fixture.teamWorkspaceId, `Frozen ${path}`, frozen.folderNodeId);
    await fixture.uow.run((repositories) => repositories.publications.setContributionState(
      frozenPublication.contributionId,
      { leftAt: null, rightsFrozenAt: new Date(), pendingCatchUp: false },
    ));

    const result = await drainPublicationEvents(fixture.uow, { judge: { kind: "NO_CALLER" } });
    expect(result.applied).toBeGreaterThanOrEqual(1);
    expect(result.pending).toBeGreaterThanOrEqual(2);

    expect(await publicationDocuments(directPublication.publication.id)).toHaveLength(1);
    expect(await publicationDocuments(groupPublication.publication.id)).toHaveLength(0);
    expect(await publicationDocuments(frozenPublication.publication.id)).toHaveLength(0);

    const contributions = await fixture.uow.run((repositories) =>
      repositories.publications.listContributions(groupPublication.publication.id));
    expect(contributions[0].pendingCatchUp).toBe(true);
    expect(contributions[0].rightsFrozenAt).toBeNull();
    const frozenContribution = (await fixture.uow.run((repositories) =>
      repositories.publications.listContributions(frozenPublication.publication.id)))[0];
    expect(frozenContribution.rightsFrozenAt).not.toBeNull();

    expect((await eventRows(group.documents["g.md"].documentId))[0].consumed_at).toBeNull();
    expect((await eventRows(frozen.documents["f.md"].documentId))[0].consumed_at).toBeNull();
  });

  it("backs off permanently pending worker rows so a bounded run reaches a later applicable delivery", async () => {
    const path = `backoff-${uuidv7()}`;
    const pendingFolders: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const pending = await folderWithDocuments(fixture.ann, `${path}/pending-${index}`, [
        { name: `g${index}.md`, text: `# Group ${index}\n\npending\n` },
      ]);
      pendingFolders.push(pending.folderNodeId);
      await publishFolder(
        fixture.ann,
        fixture.groupTeamWorkspaceId,
        `Backoff pending ${index} ${path}`,
        pending.folderNodeId,
      );
    }
    const applicable = await folderWithDocuments(fixture.mike, `${path}/applicable`, [
      { name: "a.md", text: "# Applicable\n\napply\n" },
    ]);
    pendingFolders.push(applicable.folderNodeId);
    const applicablePublication = await publishFolder(
      fixture.mike,
      fixture.teamWorkspaceId,
      `Backoff applicable ${path}`,
      applicable.folderNodeId,
    );

    // Only the document events matter; the folder events would add unrelated
    // deliveries to the head window.
    await fixture.pool.query(
      `DELETE FROM publication_events WHERE tree_node_id IN (${pendingFolders.map(() => "?").join(", ")})`,
      pendingFolders,
    );
    await fixture.uow.run((repositories) => repositories.publications.prepareDeliveries(100));

    const clock = new Date();
    const now = () => new Date(clock.getTime());
    const first = await drainPublicationEvents(fixture.uow, {
      judge: { kind: "NO_CALLER" },
      limit: 2,
      now,
      retryDelayMs: 60_000,
    });
    expect(first.pending).toBe(2);
    expect(await publicationDocuments(applicablePublication.publication.id)).toHaveLength(0);

    const second = await drainPublicationEvents(fixture.uow, {
      judge: { kind: "NO_CALLER" },
      limit: 2,
      now,
      retryDelayMs: 60_000,
    });
    expect(second.applied).toBeGreaterThanOrEqual(1);
    expect(await publicationDocuments(applicablePublication.publication.id)).toHaveLength(1);
  });

  it("lets the contributor's own drain clear a pending catch-up and a rights freeze", async () => {
    const path = `caller-recover-${uuidv7()}`;
    const { folderNodeId } = await folderWithDocuments(fixture.mike, path, [
      { name: "a.md", text: "# Recover\n\nrecover\n" },
    ]);
    const publication = await publishFolder(
      fixture.mike, fixture.teamWorkspaceId, `Recover ${path}`, folderNodeId);
    await fixture.uow.run((repositories) => repositories.publications.setContributionState(
      publication.contributionId,
      { leftAt: null, rightsFrozenAt: new Date(), pendingCatchUp: true },
    ));

    const result = await drainPublicationEvents(fixture.uow, {
      judge: { kind: "CALLER", caller: fixture.mike },
    });
    expect(result.applied).toBeGreaterThanOrEqual(1);
    expect(await publicationDocuments(publication.publication.id)).toHaveLength(1);
    const contribution = (await fixture.uow.run((repositories) =>
      repositories.publications.listContributions(publication.publication.id)))[0];
    expect(contribution.rightsFrozenAt).toBeNull();
    expect(contribution.pendingCatchUp).toBe(false);
  });

  it("reconciles a restored group-only contributor on a no-op save even with no delivery left", async () => {
    const path = `restore-nodelivery-${uuidv7()}`;
    const mike = await folderWithDocuments(fixture.mike, `${path}/mike`, [
      { name: "a.md", text: "# Mike\n\nmike\n" },
    ]);
    const publication = await publishFolder(
      fixture.mike, fixture.groupTeamWorkspaceId, `Restore ${path}`, mike.folderNodeId);
    await drainPublicationEvents(fixture.uow, { judge: { kind: "CALLER", caller: fixture.mike } });

    const ann = await folderWithDocuments(fixture.ann, `${path}/ann`, [
      { name: "ann.md", text: "# Ann\n\nv1\n", title: "Ann" },
    ]);
    const service = new PublicationService(fixture.uow);
    const joined = await service.join(fixture.ann, {
      publicationId: publication.publication.id,
      folderNodeId: ann.folderNodeId,
      acknowledgeLowOverlap: true,
    });
    await drainPublicationEvents(fixture.uow, { judge: { kind: "CALLER", caller: fixture.ann } });
    const annOriginal = ann.documents["ann.md"];
    const annTeamDocument = (await publicationDocuments(publication.publication.id))
      .find((document) => document.creatorContributionId === joined.contributionId)!;
    expect(annTeamDocument).toBeDefined();
    expect(await currentTitle(annTeamDocument.teamDocumentId)).toBe("Ann");

    // Archive, change her original, and let her own drain consume the event as
    // SKIPPED: after this point no delivery row is left to reconcile.
    await service.unpublish(fixture.mike, publication.publication.id);
    const v2 = await fixture.uow.run(async (repositories) => {
      const { bindSourceProjection } = await import(
        "@/modules/sources/application/source-knowledge-projection-service"
      );
      return bindSourceProjection(repositories, {
        id: fixture.annFolderSourceId,
        workspaceId: fixture.annPersonalWorkspaceId,
      }).projectRevision(fixture.ann, {
        documentId: annOriginal.documentId,
        expectedCurrentRevisionId: annOriginal.revisionId,
        title: "Ann v2",
        markdown: "# Ann\n\nv2\n",
        metadata: {},
      });
    });
    expect(v2.changed).toBe(true);
    const skipped = await drainPublicationEvents(fixture.uow, {
      judge: { kind: "CALLER", caller: fixture.ann },
    });
    expect(skipped.failed).toBe(0);
    const pendingDeliveries = await fixture.pool.query<{ total: unknown }[]>(
      `SELECT COUNT(*) AS total FROM publication_event_deliveries
       WHERE contribution_id = ? AND processed_at IS NULL`,
      [joined.contributionId],
    );
    expect(Number(pendingDeliveries[0]?.total ?? 0)).toBe(0);

    // The restorer cannot judge group-derived rights, so she is pending and her
    // team copy is still stale.
    await service.restore(fixture.mike, publication.publication.id);
    expect(await currentTitle(annTeamDocument.teamDocumentId)).toBe("Ann");
    expect((await contributionOf(publication.publication.id, fixture.ann.identity.id))?.pendingCatchUp)
      .toBe(true);
    expect((await service.status(fixture.ann, publication.publication.id)).pending).toBe(true);

    // A no-op save still has to reconcile the pending contribution itself.
    let scheduled: (() => Promise<void>) | undefined;
    const sources = withPostCommitDrain(
      new SourceApplicationService(fixture.uow),
      ["applyKnownEntry"],
      (caller) => {
        schedulePublicationDrain(caller, {
          schedule: (task) => { scheduled = task; },
          drain: (captured) => drainPublicationEvents(fixture.uow, {
            judge: { kind: "CALLER", caller: captured },
          }),
        });
      },
    );
    const noop = await sources.applyKnownEntry(
      fixture.ann,
      await knownEntryInput(
        annOriginal.documentId,
        { title: "Ann v2", markdown: "# Ann\n\nv2\n" },
        fixture.annFolderSourceId,
      ),
    );
    expect(noop.changed).toBe(false);
    expect(scheduled).toBeTypeOf("function");
    await scheduled?.();

    expect(await currentTitle(annTeamDocument.teamDocumentId)).toBe("Ann v2");
    const recovered = await contributionOf(publication.publication.id, fixture.ann.identity.id);
    expect(recovered?.pendingCatchUp).toBe(false);
    expect(recovered?.rightsFrozenAt).toBeNull();
    expect((await service.status(fixture.ann, publication.publication.id)).pending).toBe(false);
  });

  it("reads the publication tree a bounded number of times regardless of document count", async () => {
    const path = `tree-reads-${uuidv7()}`;
    const single = await folderWithDocuments(fixture.mike, `${path}/single`, [
      { name: "one.md", text: "# One\n\none\n" },
    ]);
    await publishFolder(
      fixture.mike, fixture.teamWorkspaceId, `Tree reads one ${path}`, single.folderNodeId);

    const singleCount = countingTreeReads(fixture.uow);
    await drainPublicationEvents(singleCount.uow, { judge: { kind: "CALLER", caller: fixture.mike } });

    const many = await folderWithDocuments(fixture.mike, `${path}/many`, [
      { name: "docs/a.md", text: "# A\n\na\n" },
      { name: "docs/b.md", text: "# B\n\nb\n" },
      { name: "docs/nested/c.md", text: "# C\n\nc\n" },
      { name: "docs/nested/d.md", text: "# D\n\nd\n" },
      { name: "other/e.md", text: "# E\n\ne\n" },
      { name: "other/f.md", text: "# F\n\nf\n" },
    ]);
    const manyPublication = await publishFolder(
      fixture.mike, fixture.teamWorkspaceId, `Tree reads many ${path}`, many.folderNodeId);

    const manyCount = countingTreeReads(fixture.uow);
    await drainPublicationEvents(manyCount.uow, { judge: { kind: "CALLER", caller: fixture.mike } });

    // The projection's tx-local view plus the one post-apply read; no per-copy,
    // per-placement or per-folder full read.
    expect(manyCount.reads()).toBe(singleCount.reads());
    expect(manyCount.reads()).toBeLessThanOrEqual(2);
    expect(await publicationDocuments(manyPublication.publication.id)).toHaveLength(6);
  });

  it("archives a Hub document moved out of a published folder and keeps its discussion", async () => {
    const hub = new HubKnowledgeCommandServiceImpl(fixture.uow);
    const label = `hub-out-${uuidv7()}`;
    const folder = await hub.createFolder(fixture.mike, {
      sourceId: fixture.mikeHubSourceId, parentId: null, name: label,
    });
    const original = await hub.createDocument(fixture.mike, {
      sourceId: fixture.mikeHubSourceId,
      parentId: folder.treeNodeId,
      title: "Hub Out",
      markdown: "# Hub Out\n\nbody\n",
      metadata: {},
    });
    const publication = await publishFolder(
      fixture.mike, fixture.teamWorkspaceId, `Hub out ${label}`, folder.treeNodeId);
    await drainPublicationEvents(fixture.uow, { judge: { kind: "CALLER", caller: fixture.mike } });
    const [teamDocument] = await publicationDocuments(publication.publication.id);
    expect(teamDocument.status).toBe("ACTIVE");
    await fixture.createDiscussion({
      workspaceId: fixture.teamWorkspaceId,
      documentId: teamDocument.teamDocumentId,
      revisionId: await fixture.revisionIdOf(teamDocument.teamDocumentId),
      authorId: fixture.mike.identity.id,
    });

    await hub.moveTreeNode(fixture.mike, {
      nodeId: original.treeNodeId, newParentId: null, newPosition: 0,
    });
    await drainPublicationEvents(fixture.uow, { judge: { kind: "CALLER", caller: fixture.mike } });

    const [archived] = await publicationDocuments(publication.publication.id);
    expect(archived.teamDocumentId).toBe(teamDocument.teamDocumentId);
    expect(archived.status).toBe("ARCHIVED");
    expect(await discussionCount(teamDocument.teamDocumentId)).toBe(1);
  });

  it("archives a Hub folder moved out of a published folder", async () => {
    const hub = new HubKnowledgeCommandServiceImpl(fixture.uow);
    const label = `hub-sub-out-${uuidv7()}`;
    const root = await hub.createFolder(fixture.mike, {
      sourceId: fixture.mikeHubSourceId, parentId: null, name: label,
    });
    const sub = await hub.createFolder(fixture.mike, {
      sourceId: fixture.mikeHubSourceId, parentId: root.treeNodeId, name: "sub",
    });
    await hub.createDocument(fixture.mike, {
      sourceId: fixture.mikeHubSourceId,
      parentId: sub.treeNodeId,
      title: "Hub Sub",
      markdown: "# Hub Sub\n\nbody\n",
      metadata: {},
    });
    const publication = await publishFolder(
      fixture.mike, fixture.teamWorkspaceId, `Hub sub out ${label}`, root.treeNodeId);
    await drainPublicationEvents(fixture.uow, { judge: { kind: "CALLER", caller: fixture.mike } });
    expect((await publicationDocuments(publication.publication.id))[0].status).toBe("ACTIVE");

    await hub.moveTreeNode(fixture.mike, {
      nodeId: sub.treeNodeId, newParentId: null, newPosition: 0,
    });
    await drainPublicationEvents(fixture.uow, { judge: { kind: "CALLER", caller: fixture.mike } });

    expect((await publicationDocuments(publication.publication.id))[0].status).toBe("ARCHIVED");
  });

  it("archives a synced document moved out of a published folder and reserves its path", async () => {
    const path = `sync-out-${uuidv7()}`;
    const folder = await folderWithDocuments(fixture.mike, path, [
      { name: "a.md", text: "# Sync Out\n\nbody\n" },
    ]);
    const publication = await publishFolder(
      fixture.mike, fixture.teamWorkspaceId, `Sync out ${path}`, folder.folderNodeId);
    await drainPublicationEvents(fixture.uow, { judge: { kind: "CALLER", caller: fixture.mike } });
    const [teamDocument] = await publicationDocuments(publication.publication.id);
    expect(teamDocument.status).toBe("ACTIVE");
    expect(teamDocument.sourcePath).toBe("a.md");
    await fixture.createDiscussion({
      workspaceId: fixture.teamWorkspaceId,
      documentId: teamDocument.teamDocumentId,
      revisionId: await fixture.revisionIdOf(teamDocument.teamDocumentId),
      authorId: fixture.mike.identity.id,
    });

    const original = folder.documents["a.md"];
    const node = await fixture.uow.run((repositories) =>
      repositories.tree.findByDocumentId(original.documentId));
    await fixture.uow.run(async (repositories) => {
      const { bindSourceProjection } = await import(
        "@/modules/sources/application/source-knowledge-projection-service"
      );
      const projection = bindSourceProjection(repositories, {
        id: fixture.mikeFolderSourceId,
        workspaceId: fixture.mikePersonalWorkspaceId,
      });
      await projection.moveProjectedNode(fixture.mike, {
        nodeId: node!.id, newParentId: null, newPosition: 0,
      });
    });
    await drainPublicationEvents(fixture.uow, { judge: { kind: "CALLER", caller: fixture.mike } });

    const [archived] = await publicationDocuments(publication.publication.id);
    expect(archived.teamDocumentId).toBe(teamDocument.teamDocumentId);
    expect(archived.status).toBe("ARCHIVED");
    expect(archived.sourcePath).toBe("a.md");
    expect(await discussionCount(teamDocument.teamDocumentId)).toBe(1);
  });

  it("archives a synced subfolder moved out of a published folder and reserves its document path", async () => {
    const path = `sync-sub-out-${uuidv7()}`;
    const folder = await folderWithDocuments(fixture.mike, path, [
      { name: "top.md", text: "# Top\n\ntop\n" },
    ]);
    const sub = await fixture.uow.run(async (repositories) => {
      const { bindSourceProjection } = await import(
        "@/modules/sources/application/source-knowledge-projection-service"
      );
      const projection = bindSourceProjection(repositories, {
        id: fixture.mikeFolderSourceId,
        workspaceId: fixture.mikePersonalWorkspaceId,
      });
      return projection.projectFolder(fixture.mike, {
        sourceId: fixture.mikeFolderSourceId,
        mapping: { sourceEntryId: uuidv7(), externalId: null, sourcePath: `${path}/sub` },
        parentId: folder.folderNodeId,
        name: "sub",
      });
    });
    await fixture.createSyncedOriginal(fixture.mike, {
      parentId: sub.treeNodeId,
      sourcePath: `${path}/sub/nested.md`,
      title: "Nested",
      markdown: "# Nested\n\nbody\n",
    });
    const publication = await publishFolder(
      fixture.mike, fixture.teamWorkspaceId, `Sync sub out ${path}`, folder.folderNodeId);
    await drainPublicationEvents(fixture.uow, { judge: { kind: "CALLER", caller: fixture.mike } });
    const documents = await publicationDocuments(publication.publication.id);
    expect(documents).toHaveLength(2);
    const nested = documents.find((document) => document.sourcePath === "sub/nested.md");
    expect(nested?.status).toBe("ACTIVE");

    await fixture.uow.run(async (repositories) => {
      const { bindSourceProjection } = await import(
        "@/modules/sources/application/source-knowledge-projection-service"
      );
      const projection = bindSourceProjection(repositories, {
        id: fixture.mikeFolderSourceId,
        workspaceId: fixture.mikePersonalWorkspaceId,
      });
      await projection.moveProjectedNode(fixture.mike, {
        nodeId: sub.treeNodeId, newParentId: null, newPosition: 0,
      });
    });
    await drainPublicationEvents(fixture.uow, { judge: { kind: "CALLER", caller: fixture.mike } });

    const after = await publicationDocuments(publication.publication.id);
    expect(after.find((document) => document.teamDocumentId === nested!.teamDocumentId)?.status)
      .toBe("ARCHIVED");
    expect(after.find((document) => document.teamDocumentId === nested!.teamDocumentId)?.sourcePath)
      .toBe("sub/nested.md");
  });

  it("leaves events inserted during a batch visible to the next run", async () => {
    const path = `midbatch-${uuidv7()}`;
    const first = await folderWithDocuments(fixture.mike, `${path}/first`, [
      { name: "a.md", text: "# First\n\nfirst\n" },
    ]);
    const firstPublication = await publishFolder(
      fixture.mike, fixture.teamWorkspaceId, `Mid ${path}`, first.folderNodeId);
    const second = await folderWithDocuments(fixture.ann, `${path}/second`, [
      { name: "b.md", text: "# Second\n\nsecond\n" },
    ]);
    await publishFolder(
      fixture.ann, fixture.teamWorkspaceId, `Mid second ${path}`, second.folderNodeId);
    const late = await folderWithDocuments(fixture.ann, `${path}/late`, [
      { name: "c.md", text: "# Late\n\nlate\n" },
    ]);
    const latePublication = await publishFolder(
      fixture.ann, fixture.teamWorkspaceId, `Mid late ${path}`, late.folderNodeId);
    // The late document exists, but its events are inserted only mid-batch.
    await fixture.pool.query(
      "DELETE FROM publication_events WHERE document_id = ? OR tree_node_id = ?",
      [late.documents["c.md"].documentId, late.folderNodeId],
    );

    const result = await drainPublicationEvents(
      failingUow(fixture.uow, {
        insertEventOnce: {
          documentId: late.documents["c.md"].documentId,
          revisionId: late.documents["c.md"].revisionId,
        },
      }),
      { judge: { kind: "NO_CALLER" } },
    );
    expect(result.applied).toBeGreaterThanOrEqual(2);
    expect(await publicationDocuments(firstPublication.publication.id)).toHaveLength(1);
    expect(await publicationDocuments(latePublication.publication.id)).toHaveLength(0);
    expect((await eventRows(late.documents["c.md"].documentId))[0].consumed_at).toBeNull();

    const next = await drainPublicationEvents(fixture.uow, { judge: { kind: "NO_CALLER" } });
    expect(next.applied).toBeGreaterThanOrEqual(1);
    expect(await publicationDocuments(latePublication.publication.id)).toHaveLength(1);
    expect((await eventRows(late.documents["c.md"].documentId))[0].consumed_at).not.toBeNull();
  });

  it("drains pending work after a no-op Hub save, and a failed drain leaves the original committed", async () => {
    const path = `noop-${uuidv7()}`;
    const { folderNodeId, documents } = await folderWithDocuments(fixture.mike, path, [
      { name: "a.md", text: "# A\n\nv1\n" },
    ]);
    const publication = await publishFolder(
      fixture.mike, fixture.teamWorkspaceId, `Noop ${path}`, folderNodeId);
    await drainPublicationEvents(fixture.uow, { judge: { kind: "CALLER", caller: fixture.mike } });

    const original = documents["a.md"];
    const v2 = await fixture.uow.run(async (repositories) => {
      const { bindSourceProjection } = await import(
        "@/modules/sources/application/source-knowledge-projection-service"
      );
      return bindSourceProjection(repositories, {
        id: fixture.mikeFolderSourceId,
        workspaceId: fixture.mikePersonalWorkspaceId,
      }).projectRevision(fixture.mike, {
        documentId: original.documentId,
        expectedCurrentRevisionId: original.revisionId,
        title: "A",
        markdown: "# A\n\nv2\n",
        metadata: {},
      });
    });
    expect(v2.changed).toBe(true);

    let scheduled: (() => Promise<void>) | undefined;
    const sources = withPostCommitDrain(
      new SourceApplicationService(fixture.uow),
      ["applyKnownEntry"],
      (caller) => {
        schedulePublicationDrain(caller, {
          schedule: (task) => { scheduled = task; },
          drain: (captured) => drainPublicationEvents(fixture.uow, {
            judge: { kind: "CALLER", caller: captured },
          }),
        });
      },
    );
    const noop = await sources.applyKnownEntry(
      fixture.mike,
      await knownEntryInput(original.documentId, { title: "A", markdown: "# A\n\nv2\n" }),
    );
    expect(noop.changed).toBe(false);
    expect(scheduled).toBeTypeOf("function");
    await scheduled?.();

    const [teamDocument] = await publicationDocuments(publication.publication.id);
    expect((await fixture.uow.run((repositories) =>
      repositories.revisions.findCurrent(teamDocument.teamDocumentId)))?.markdown).toContain("v2");

    // A throwing drain is logged; the committed original and its event remain.
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    let failingTask: (() => Promise<void>) | undefined;
    const failingSources = withPostCommitDrain(
      new SourceApplicationService(fixture.uow),
      ["applyKnownEntry"],
      (caller) => {
        schedulePublicationDrain(caller, {
          schedule: (task) => { failingTask = task; },
          drain: async () => { throw new Error("drain exploded"); },
        });
      },
    );
    const committed = await failingSources.applyKnownEntry(
      fixture.mike,
      await knownEntryInput(original.documentId, { title: "A", markdown: "# A\n\nv3\n" }),
    );
    expect(committed.changed).toBe(true);
    const committedRevision = await fixture.uow.run((repositories) =>
      repositories.revisions.findCurrent(original.documentId));
    expect(committedRevision?.markdown).toContain("v3");
    await expect(failingTask?.()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
    expect((await eventRows(original.documentId)).some((event) => event.consumed_at === null)).toBe(true);
    error.mockRestore();
  });

  it("schedules nothing while Team workspaces are off", async () => {
    const path = `off-${uuidv7()}`;
    const { folderNodeId, documents } = await folderWithDocuments(fixture.mike, path, [
      { name: "a.md", text: "# Off\n\noff\n" },
    ]);
    const publication = await publishFolder(
      fixture.mike, fixture.teamWorkspaceId, `Off ${path}`, folderNodeId);

    const previous = process.env.KM_TEAM_WORKSPACES_ENABLED;
    process.env.KM_TEAM_WORKSPACES_ENABLED = "false";
    try {
      const schedule = vi.fn();
      const sources = withPostCommitDrain(
        new SourceApplicationService(fixture.uow),
        ["applyKnownEntry"],
        (caller) => {
          schedulePublicationDrain(caller, {
            schedule,
            drain: (captured) => drainPublicationEvents(fixture.uow, {
              judge: { kind: "CALLER", caller: captured },
            }),
          });
        },
      );
      await sources.applyKnownEntry(
        fixture.mike,
        await knownEntryInput(documents["a.md"].documentId, {
          title: "a.md",
          markdown: "# Off\n\noff\n",
        }),
      );
      expect(schedule).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.KM_TEAM_WORKSPACES_ENABLED;
      else process.env.KM_TEAM_WORKSPACES_ENABLED = previous;
    }

    expect(await publicationDocuments(publication.publication.id)).toHaveLength(0);
    expect((await eventRows(documents["a.md"].documentId))[0].consumed_at).toBeNull();
    const contribution = (await fixture.uow.run((repositories) =>
      repositories.publications.listContributions(publication.publication.id)))[0];
    expect(contribution.rightsFrozenAt).toBeNull();
  });

  it("schedules nothing when the original save rolls back", async () => {
    const path = `save-rollback-${uuidv7()}`;
    const { documents } = await folderWithDocuments(fixture.mike, path, [
      { name: "a.md", text: "# A\n\none\n" },
    ]);
    const schedule = vi.fn();
    const sources = withPostCommitDrain(
      new SourceApplicationService(fixture.uow),
      ["applyKnownEntry"],
      schedule,
    );
    const input = await knownEntryInput(documents["a.md"].documentId, {
      title: "a.md",
      markdown: "# A\n\ntwo\n",
    });
    await expect(sources.applyKnownEntry(fixture.mike, {
      ...input,
      basedOnVersion: input.basedOnVersion + 1,
    })).rejects.toThrow();
    expect(schedule).not.toHaveBeenCalled();
  });
});

describe("publication notices in import preview and result", () => {
  it("shows the maintainer for a proposed final path and never after lost team access", async () => {
    const root = `notice-${uuidv7()}`;
    const mike = await folderWithDocuments(fixture.mike, root, [
      { name: "a.md", text: "# A\n\nmike\n" },
    ]);
    const publication = await publishFolder(
      fixture.mike, fixture.teamWorkspaceId, `Notice ${root}`, mike.folderNodeId);
    await drainPublicationEvents(fixture.uow, { judge: { kind: "CALLER", caller: fixture.mike } });

    const annFolder = await fixture.createFolder(fixture.ann, root, "notice");
    const joined = await new PublicationService(fixture.uow).join(fixture.ann, {
      publicationId: publication.publication.id,
      folderNodeId: annFolder.treeNodeId,
      acknowledgeLowOverlap: true,
    });
    const temp = await fixture.createSyncedOriginal(fixture.ann, {
      parentId: annFolder.treeNodeId,
      sourcePath: `${root}/temp.md`,
      title: "Temp",
      markdown: "# T\n\nann\n",
    });
    await adoptExternalId(fixture.ann, fixture.annFolderSourceId, temp.documentId, "ann-temp");

    const snapshotId = await readyResync(fixture.ann, fixture.annFolderSourceId, root, [{
      path: `${root}/a.md`,
      text: "---\nknowledge_id: ann-temp\n---\n# T\n\nann\n",
    }]);
    const services = importServices();
    const preview = await services.preview.get(fixture.ann, snapshotId);
    expect(hasNotice(noticesOf(preview), {
      code: "MAINTAINED_BY_OTHER",
      originalDocumentId: temp.documentId,
      publicationId: publication.publication.id,
      maintainerUserId: fixture.mike.identity.id,
    })).toBe(true);

    const applied = await services.apply.apply(fixture.ann, snapshotId, {
      planHash: preview.planHash ?? "",
      sourceName: preview.sourceName ?? "",
    });
    if (applied.kind !== "APPLIED") throw new Error("expected APPLIED");
    expect(hasNotice(noticesOf(applied), {
      code: "MAINTAINED_BY_OTHER",
      originalDocumentId: temp.documentId,
      publicationId: publication.publication.id,
      maintainerUserId: fixture.mike.identity.id,
    })).toBe(true);

    await drainPublicationEvents(fixture.uow, { judge: { kind: "CALLER", caller: fixture.ann } });
    const report = await fixture.uow.run((repositories) =>
      repositories.publications.findReport(joined.contributionId));
    expect(report?.notices).toContainEqual(expect.objectContaining({
      code: "MAINTAINED_BY_OTHER",
      originalDocumentId: temp.documentId,
      maintainerUserId: fixture.mike.identity.id,
    }));
    expect(await publicationDocuments(publication.publication.id)).toHaveLength(1);

    // Losing the team hides the maintainer from the same caller's preview.
    await fixture.pool.query(
      "DELETE FROM workspace_memberships WHERE workspace_id = ? AND user_id = ?",
      [fixture.teamWorkspaceId, fixture.ann.identity.id],
    );
    const hidden = await services.preview.get(fixture.ann, snapshotId);
    expect(noticesOf(hidden)).toEqual([]);

    // Restore the shared fixture's membership for the remaining tests.
    await fixture.uow.run((repositories) => repositories.workspaceMemberships.insert(
      createDirectMembership({
        workspaceId: fixture.teamWorkspaceId,
        userId: fixture.ann.identity.id,
        role: "EDITOR",
        now: new Date(),
      }),
    ));
  });

  it("keeps a blocked creator move's team path and reports PATH_RESERVED", async () => {
    const root = `reserve-${uuidv7()}`;
    const mike = await folderWithDocuments(fixture.mike, root, [
      { name: "a.md", text: "# A\n\nmike\n" },
    ]);
    const publication = await publishFolder(
      fixture.mike, fixture.teamWorkspaceId, `Reserve ${root}`, mike.folderNodeId);
    await drainPublicationEvents(fixture.uow, { judge: { kind: "CALLER", caller: fixture.mike } });

    const annFolder = await fixture.createFolder(fixture.ann, root, "reserve");
    const annDocument = await fixture.createSyncedOriginal(fixture.ann, {
      parentId: annFolder.treeNodeId,
      sourcePath: `${root}/b.md`,
      title: "B",
      markdown: "# B\n\nann v1\n",
    });
    const joined = await new PublicationService(fixture.uow).join(fixture.ann, {
      publicationId: publication.publication.id,
      folderNodeId: annFolder.treeNodeId,
      acknowledgeLowOverlap: true,
    });
    await adoptExternalId(fixture.ann, fixture.annFolderSourceId, annDocument.documentId, "ann-b");

    const snapshotId = await readyResync(fixture.ann, fixture.annFolderSourceId, root, [{
      path: `${root}/a.md`,
      text: "---\nknowledge_id: ann-b\n---\n# B\n\nann v2\n",
    }]);
    const preview = await importServices().preview.get(fixture.ann, snapshotId);
    const applied = await importServices().apply.apply(fixture.ann, snapshotId, {
      planHash: preview.planHash ?? "",
      sourceName: preview.sourceName ?? "",
    });
    if (applied.kind !== "APPLIED") throw new Error("expected APPLIED");
    expect(hasNotice(noticesOf(applied), {
      code: "PATH_RESERVED",
      originalDocumentId: annDocument.documentId,
      publicationId: publication.publication.id,
    })).toBe(true);

    const entry = await fixture.uow.run((repositories) =>
      repositories.entries.findByDocumentId(annDocument.documentId));
    expect(entry?.sourcePath).toBe(`${root}/a.md`);

    const teamDocuments = await publicationDocuments(publication.publication.id);
    const annTeamDocument = teamDocuments.find(
      (document) => document.creatorContributionId === joined.contributionId);
    expect(annTeamDocument?.sourcePath).toBe("b.md");

    await drainPublicationEvents(fixture.uow, { judge: { kind: "CALLER", caller: fixture.ann } });
    const report = await fixture.uow.run((repositories) =>
      repositories.publications.findReport(joined.contributionId));
    expect(report?.notices).toContainEqual(expect.objectContaining({
      code: "PATH_RESERVED",
      originalDocumentId: annDocument.documentId,
    }));
    const current = await fixture.uow.run((repositories) =>
      repositories.revisions.findCurrent(annTeamDocument?.teamDocumentId ?? ""));
    expect(current?.markdown).toContain("ann v2");
  });

  it("keeps each notice scoped to the publication that actually holds the path", async () => {
    const root = `scope-${uuidv7()}`;
    const mikeA = await folderWithDocuments(fixture.mike, root, [
      { name: "a.md", text: "# A\n\nmike\n" },
    ]);
    const publicationA = await publishFolder(
      fixture.mike, fixture.teamWorkspaceId, `Scope A ${root}`, mikeA.folderNodeId);
    const mikeB = await folderWithDocuments(fixture.mike, root, [
      { name: "b.md", text: "# B\n\nmike\n" },
    ]);
    const publicationB = await publishFolder(
      fixture.mike, fixture.groupTeamWorkspaceId, `Scope B ${root}`, mikeB.folderNodeId);
    await drainPublicationEvents(fixture.uow, { judge: { kind: "CALLER", caller: fixture.mike } });

    const annFolder = await fixture.createFolder(fixture.ann, root, "scope");
    const publicationService = new PublicationService(fixture.uow);
    await publicationService.join(fixture.ann, {
      publicationId: publicationA.publication.id,
      folderNodeId: annFolder.treeNodeId,
      acknowledgeLowOverlap: true,
    });
    await publicationService.join(fixture.ann, {
      publicationId: publicationB.publication.id,
      folderNodeId: annFolder.treeNodeId,
      acknowledgeLowOverlap: true,
    });

    const snapshotId = await readyResync(fixture.ann, fixture.annFolderSourceId, root, [
      { path: `${root}/a.md`, text: "# A\n\nann\n" },
      { path: `${root}/b.md`, text: "# B\n\nann\n" },
    ]);
    const preview = await importServices().preview.get(fixture.ann, snapshotId);
    const notices = noticesOf(preview).filter((notice) => notice.code === "MAINTAINED_BY_OTHER");
    expect(hasNotice(notices, {
      code: "MAINTAINED_BY_OTHER",
      publicationId: publicationA.publication.id,
      sourcePath: `${root}/a.md`,
      maintainerUserId: fixture.mike.identity.id,
    })).toBe(true);
    expect(hasNotice(notices, {
      code: "MAINTAINED_BY_OTHER",
      publicationId: publicationB.publication.id,
      sourcePath: `${root}/b.md`,
      maintainerUserId: fixture.mike.identity.id,
    })).toBe(true);
    expect(notices.filter((notice) => notice.publicationId === publicationA.publication.id)).toHaveLength(1);
    expect(notices.filter((notice) => notice.publicationId === publicationB.publication.id)).toHaveLength(1);
  });

  it("warns for a brand-new file on another contributor's path and still applies when notices fail", async () => {
    const root = `newfile-${uuidv7()}`;
    const mike = await folderWithDocuments(fixture.mike, root, [
      { name: "a.md", text: "# A\n\nmike\n" },
    ]);
    const publication = await publishFolder(
      fixture.mike, fixture.teamWorkspaceId, `New file ${root}`, mike.folderNodeId);
    await drainPublicationEvents(fixture.uow, { judge: { kind: "CALLER", caller: fixture.mike } });

    const annFolder = await fixture.createFolder(fixture.ann, root, "newfile");
    await new PublicationService(fixture.uow).join(fixture.ann, {
      publicationId: publication.publication.id,
      folderNodeId: annFolder.treeNodeId,
      acknowledgeLowOverlap: true,
    });
    const snapshotId = await readyResync(fixture.ann, fixture.annFolderSourceId, root, [{
      path: `${root}/a.md`,
      text: "# New\n\nann\n",
    }]);
    const preview = await importServices().preview.get(fixture.ann, snapshotId);
    const previewNotice = noticesOf(preview).find((notice) =>
      notice.code === "MAINTAINED_BY_OTHER"
      && notice.publicationId === publication.publication.id
      && notice.sourcePath === `${root}/a.md`);
    expect(previewNotice).toBeDefined();
    expect(previewNotice?.originalDocumentId).toBeUndefined();
    expect(previewNotice?.maintainerUserId).toBe(fixture.mike.identity.id);

    // Display-only notices fail open for preview and finalize too.
    const safePreview = await new GetFolderImportPreviewService(noticeFailingUow(fixture.uow))
      .get(fixture.ann, snapshotId);
    expect(noticesOf(safePreview)).toEqual([]);
    const safeFinalize = await new FinalizeFolderImportService(
      noticeFailingUow(fixture.uow),
      { limits: DEFAULT_IMPORT_LIMITS },
    ).finalize(fixture.ann, snapshotId);
    expect(noticesOf(safeFinalize)).toEqual([]);

    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const applied = await new ApplyFolderImportService(noticeFailingUow(fixture.uow))
      .apply(fixture.ann, snapshotId, {
        planHash: preview.planHash ?? "",
        sourceName: preview.sourceName ?? "",
      });
    expect(applied.kind).toBe("APPLIED");
    if (applied.kind !== "APPLIED") throw new Error("expected APPLIED");
    expect(noticesOf(applied)).toEqual([]);
    expect(error).toHaveBeenCalled();
    error.mockRestore();

    const entry = await fixture.uow.run((repositories) =>
      repositories.entries.findBySourcePath(fixture.annFolderSourceId, `${root}/a.md`));
    expect(entry?.documentId).toBeTruthy();
  });
});
