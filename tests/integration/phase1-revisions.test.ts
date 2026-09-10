import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { MariaDbRevisionRepository } from "@/infrastructure/database/mariadb/repositories/revisions";
import { HubKnowledgeCommandServiceImpl } from "@/modules/knowledge/application/hub-knowledge-command-service";
import { RevisionConflictError } from "@/modules/knowledge/domain/errors";
import { KnowledgeApplicationService } from "@/modules/knowledge/application/service";
import { revisionContentHash, normalizeRevisionContent, type KnowledgeMetadata } from "@/modules/knowledge/domain/content";
import { disposeIsolatedDatabase, provisionIsolatedDatabase } from "../../scripts/db/test-database";
import { runMigrations, type IsolatedDatabaseHandle } from "../../scripts/db/migrate";
import { createSourceFixture, ensureUser, fixtureCaller, fixtureIdentity } from "../fixtures/knowledge";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import { uuidv7 } from "@/shared/ids/uuidv7";

let handle: IsolatedDatabaseHandle;
let pool: Pool;

beforeAll(async () => {
  handle = await provisionIsolatedDatabase("test");
  const previous = process.env.KM_TEST_DB_NAME;
  process.env.KM_TEST_DB_NAME = handle.databaseName;
  try {
    pool = createDatabasePool(databaseConfig("test"));
  } finally {
    if (previous === undefined) delete process.env.KM_TEST_DB_NAME;
    else process.env.KM_TEST_DB_NAME = previous;
  }
  await runMigrations(pool);
});

afterAll(async () => {
  await pool.end();
  await disposeIsolatedDatabase(handle);
});

function phase0Hash(title: string, markdown: string, metadata: unknown): string {
  // Phase 0 contentFingerprint: unprefixed SHA-256 over the raw JSON payload.
  return createHash("sha256").update(JSON.stringify({ title, markdown, metadata }), "utf8").digest("hex");
}

async function insertLegacyDocument(options: { sourceId: string; folderId: string; title: string; markdown: string; metadata: KnowledgeMetadata }): Promise<{ documentId: string; revisionId: string }> {
  const documentId = uuidv7();
  const revisionId = uuidv7();
  const now = new Date();
  const user = fixtureIdentity.id;
  await ensureUser(pool, fixtureIdentity);
  // Phase 0-encoded row: raw title/markdown/metadata with the legacy unprefixed
  // hash. Inserted draft-first (NULL current) to satisfy the
  // (document_id, current_revision_id) FK ordering.
  await new MariaDbUnitOfWork(pool).run(async (repositories) => {
    await repositories.documents.insertDraft({
      id: documentId, sourceId: options.sourceId, currentRevisionId: null, status: "ACTIVE",
      createdBy: user, updatedBy: user, archivedBy: null, archivedAt: null, createdAt: now, updatedAt: now,
    });
    await repositories.revisions.insert({
      id: revisionId, documentId, revisionNo: 1, title: options.title, markdown: options.markdown,
      metadata: options.metadata, contentHash: phase0Hash(options.title, options.markdown, options.metadata),
      createdBy: user, createdAt: now,
    });
    await repositories.documents.setCurrentRevision(documentId, revisionId, user);
    await repositories.tree.insert({
      id: uuidv7(), sourceId: options.sourceId, parentId: options.folderId, nodeType: "DOCUMENT",
      name: null, documentId, position: 0, status: "ACTIVE", updatedBy: user, archivedBy: null, archivedAt: null,
    });
    await repositories.documents.assertComplete(documentId);
  });
  return { documentId, revisionId };
}

async function readRevisionRow(revisionId: string) {
  const rows = await pool.query<Record<string, unknown>[]>("SELECT * FROM knowledge_revisions WHERE id = ?", [revisionId]);
  const row = rows[0] as Record<string, unknown>;
  const rawMetadata = row.metadata as unknown;
  return {
    title: String(row.title),
    markdown: String(row.markdown),
    metadata: typeof rawMetadata === "string" ? (JSON.parse(rawMetadata) as unknown) : rawMetadata,
    contentHash: String(row.content_hash),
    revisionNo: Number(row.revision_no),
  };
}

describe("immutable knowledge revisions", () => {
  it("creates R1 and resolves it as the current revision", async () => {
    const { source, folderId } = await createSourceFixture(pool);
    const service = new KnowledgeApplicationService(new MariaDbUnitOfWork(pool));
    const hub = new HubKnowledgeCommandServiceImpl(new MariaDbUnitOfWork(pool));
    const { documentId, revisionId } = await hub.createDocument(fixtureCaller(), {
      sourceId: source.id,
      parentId: folderId,
      title: "First",
      markdown: "body",
      metadata: {},
    });
    const current = await service.getCurrentRevision(fixtureCaller(), documentId);
    expect(current?.id).toBe(revisionId);
    expect(current?.revisionNo).toBe(1);
    const listed = await new MariaDbUnitOfWork(pool).run((repositories) => repositories.revisions.listByDocument(documentId));
    expect(listed.map((revision) => revision.revisionNo)).toEqual([1]);
  });

  it("treats canonically identical content as NOOP and returns the existing revision", async () => {
    const { source, folderId } = await createSourceFixture(pool);
    const hub = new HubKnowledgeCommandServiceImpl(new MariaDbUnitOfWork(pool));
    const created = await hub.createDocument(callerFromIdentity(fixtureIdentity), {
      sourceId: source.id,
      parentId: folderId,
      title: "Spaced",
      markdown: "a\nb",
      metadata: { a: 1, b: 2 },
    });
    const result = await hub.createRevision(callerFromIdentity(fixtureIdentity), {
      documentId: created.documentId,
      expectedCurrentRevisionId: created.revisionId,
      title: "  Spaced  ",
      markdown: "a\r\nb",
      metadata: { b: 2, a: 1 },
    });
    expect(result.changed).toBe(false);
    expect(result.revisionId).toBe(created.revisionId);
    expect(result.revisionNo).toBe(1);
    const listed = await new MariaDbUnitOfWork(pool).run((repositories) => repositories.revisions.listByDocument(created.documentId));
    expect(listed).toHaveLength(1);
  });

  it("creates R2 on real change while leaving R1 byte-stable", async () => {
    const { source, folderId } = await createSourceFixture(pool);
    const service = new KnowledgeApplicationService(new MariaDbUnitOfWork(pool));
    const hub = new HubKnowledgeCommandServiceImpl(new MariaDbUnitOfWork(pool));
    const created = await hub.createDocument(fixtureCaller(), {
      sourceId: source.id,
      parentId: folderId,
      title: "Stable",
      markdown: "v1",
      metadata: {},
    });
    const before = await readRevisionRow(created.revisionId);
    const result = await hub.createRevision(fixtureCaller(), {
      documentId: created.documentId,
      expectedCurrentRevisionId: created.revisionId,
      title: "Stable",
      markdown: "v2",
      metadata: {},
    });
    expect(result.changed).toBe(true);
    expect(result.revisionNo).toBe(2);
    const current = await service.getCurrentRevision(fixtureCaller(), created.documentId);
    expect(current?.id).toBe(result.revisionId);
    expect(await readRevisionRow(created.revisionId)).toEqual(before);
    const listed = await new MariaDbUnitOfWork(pool).run((repositories) => repositories.revisions.listByDocument(created.documentId));
    expect(listed.map((revision) => revision.revisionNo)).toEqual([1, 2]);
  });

  it("assigns unique increasing revision numbers and rejects duplicates", async () => {
    const { source, folderId } = await createSourceFixture(pool);
    const hub = new HubKnowledgeCommandServiceImpl(new MariaDbUnitOfWork(pool));
    const created = await hub.createDocument(fixtureCaller(), {
      sourceId: source.id,
      parentId: folderId,
      title: "Numbered",
      markdown: "v1",
      metadata: {},
    });
    const second = await hub.createRevision(fixtureCaller(), {
      documentId: created.documentId, expectedCurrentRevisionId: created.revisionId,
      title: "Numbered", markdown: "v2", metadata: {},
    });
    const third = await hub.createRevision(fixtureCaller(), {
      documentId: created.documentId, expectedCurrentRevisionId: second.revisionId,
      title: "Numbered", markdown: "v3", metadata: {},
    });
    expect([second.revisionNo, third.revisionNo]).toEqual([2, 3]);
    await expect(
      new MariaDbUnitOfWork(pool).run((repositories) =>
        repositories.revisions.insert({
          id: uuidv7(),
          documentId: created.documentId,
          revisionNo: 2,
          title: "Numbered",
          markdown: "duplicate",
          metadata: {},
          contentHash: "x",
          createdBy: fixtureIdentity.id,
          createdAt: new Date(),
        }),
      ),
    ).rejects.toThrow();
  });

  it("exposes no update or delete revision API", () => {
    const prototype = MariaDbRevisionRepository.prototype as unknown as Record<string, unknown>;
    for (const forbidden of ["update", "updateContent", "delete", "remove", "deleteById", "save", "upsert"]) {
      expect(prototype).not.toHaveProperty(forbidden);
    }
    expect(typeof prototype.insert).toBe("function");
    expect(typeof prototype.findById).toBe("function");
    expect(typeof prototype.findCurrent).toBe("function");
    expect(typeof prototype.listByDocument).toBe("function");
  });

  it("reads a Phase 0 legacy row as-is and corrects a whitespace-only legacy title", async () => {
    const { source, folderId } = await createSourceFixture(pool);
    const service = new KnowledgeApplicationService(new MariaDbUnitOfWork(pool));
    const hub = new HubKnowledgeCommandServiceImpl(new MariaDbUnitOfWork(pool));
    const legacy = await insertLegacyDocument({
      sourceId: source.id,
      folderId,
      title: "   ",
      markdown: "legacy\r\nbody",
      metadata: { b: 2, a: 1 },
    });
    const current = await service.getCurrentRevision(fixtureCaller(), legacy.documentId);
    expect(current?.title).toBe("   ");
    const before = await readRevisionRow(legacy.revisionId);
    const result = await hub.createRevision(fixtureCaller(), {
      documentId: legacy.documentId, expectedCurrentRevisionId: legacy.revisionId,
      title: "Fixed",
      markdown: "legacy\nbody",
      metadata: { a: 1, b: 2 },
    });
    expect(result.changed).toBe(true);
    expect(result.revisionNo).toBe(2);
    const stored = await readRevisionRow(result.revisionId);
    expect(stored.contentHash).toBe(
      revisionContentHash(normalizeRevisionContent({ title: "Fixed", markdown: "legacy\nbody", metadata: { a: 1, b: 2 } })),
    );
    expect(await readRevisionRow(legacy.revisionId)).toEqual(before);
  });

  it("rejects a stale expected revision with REVISION_CONFLICT and writes nothing", async () => {
    const { source, folderId } = await createSourceFixture(pool);
    const hub = new HubKnowledgeCommandServiceImpl(new MariaDbUnitOfWork(pool));
    const created = await hub.createDocument(fixtureCaller(), {
      sourceId: source.id, parentId: folderId, title: "Stale", markdown: "v1", metadata: {},
    });
    const second = await hub.createRevision(fixtureCaller(), {
      documentId: created.documentId, expectedCurrentRevisionId: created.revisionId,
      title: "Stale", markdown: "v2", metadata: {},
    });
    expect(second.revisionNo).toBe(2);
    const failure = await hub.createRevision(fixtureCaller(), {
      documentId: created.documentId, expectedCurrentRevisionId: created.revisionId,
      title: "Stale", markdown: "stale", metadata: {},
    }).then(
      (): null => null,
      (caught: unknown) => caught,
    );
    expect(failure).toBeInstanceOf(RevisionConflictError);
    expect((failure as RevisionConflictError).code).toBe("REVISION_CONFLICT");
    const listed = await new MariaDbUnitOfWork(pool).run((repositories) => repositories.revisions.listByDocument(created.documentId));
    expect(listed.map((revision) => revision.revisionNo)).toEqual([1, 2]);
  });

  it("NOOPs a Phase 0 legacy row against canonically equal candidate content", async () => {
    const { source, folderId } = await createSourceFixture(pool);
    const hub = new HubKnowledgeCommandServiceImpl(new MariaDbUnitOfWork(pool));
    const legacy = await insertLegacyDocument({
      sourceId: source.id,
      folderId,
      title: "  Legacy  ",
      markdown: "a\r\nb",
      metadata: { b: 2, a: 1 },
    });
    const result = await hub.createRevision(fixtureCaller(), {
      documentId: legacy.documentId, expectedCurrentRevisionId: legacy.revisionId,
      title: "Legacy",
      markdown: "a\nb",
      metadata: { a: 1, b: 2 },
    });
    expect(result.changed).toBe(false);
    expect(result.revisionId).toBe(legacy.revisionId);
    const listed = await new MariaDbUnitOfWork(pool).run((repositories) => repositories.revisions.listByDocument(legacy.documentId));
    expect(listed).toHaveLength(1);
    expect(listed[0]?.contentHash).toBe(phase0Hash("  Legacy  ", "a\r\nb", { b: 2, a: 1 }));
  });
});
