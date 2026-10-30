import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CallerContext } from "@/modules/identity/domain/caller-context";
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
  expected: Pick<PublicationNotice, "code" | "originalDocumentId" | "publicationId"> & { maintainerUserId?: string },
): boolean {
  return notices.some((notice) =>
    notice.code === expected.code
    && notice.originalDocumentId === expected.originalDocumentId
    && notice.publicationId === expected.publicationId
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
) {
  return fixture.uow.run(async (repositories) => {
    const source = await repositories.sources.findById(fixture.mikeFolderSourceId);
    const entry = await repositories.entries.findByDocumentId(documentId);
    if (!source || !entry) throw new Error("Fixture source entry is missing.");
    return {
      sourceId: fixture.mikeFolderSourceId,
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

    const applied = await services.apply.apply(fixture.ann, snapshotId);
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
    const applied = await importServices().apply.apply(fixture.ann, snapshotId);
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
});
