import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbTaskKnowledgeUnitOfWork } from "@/infrastructure/database/mariadb/task-knowledge-transaction";
import { IntegrityViolationError } from "@/modules/knowledge/domain/errors";
import { DatabaseUnavailableError } from "@/modules/task-knowledge/domain/task-errors";
import type { TaskKnowledgeRepositories } from "@/modules/task-knowledge/ports/unit-of-work";
import { uuidv7 } from "@/shared/ids/uuidv7";
import { insertFolderSource, insertSyncedDocument, newToken, seedMySpaceWithFolderSource, tokenHash } from "./task-knowledge-fixtures";

let pool: Pool;
beforeAll(() => { pool = createDatabasePool(databaseConfig("test")); });
afterAll(async () => { await pool.end(); });

const run = <T>(work: (r: TaskKnowledgeRepositories) => Promise<T>) => new MariaDbTaskKnowledgeUnitOfWork(pool).run(work);

async function binding() {
  const seed = await seedMySpaceWithFolderSource(pool);
  const bindingId = uuidv7();
  await run((r) => r.taskExports.insertBinding({ id: bindingId, ownerUserId: seed.owner.id, workspaceId: seed.workspaceId, label: "laptop" }));
  return { ...seed, bindingId };
}

async function task(bindingId: string, taskId = crypto.randomUUID()) {
  return run((r) => r.taskExports.insertTaskIfAbsent({ id: uuidv7(), bindingId, taskId }));
}

const revision = (taskResultId: string, revisionNo: number, hash = "a".repeat(64)) => ({
  id: uuidv7(), taskResultId, revisionNo, artifactJson: JSON.stringify({ revisionNo }), contentHash: hash,
});

const columns = async (table: string) =>
  (await pool.query<{ COLUMN_NAME: string; COLLATION_NAME: string | null }[]>(
    "SELECT COLUMN_NAME, COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
    [table],
  ));

describe("task export schema", () => {
  it("creates the five tables", async () => {
    const rows = await pool.query<{ TABLE_NAME: string }[]>(
      "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE 'task\\_%' ORDER BY TABLE_NAME",
    );
    expect(rows.map((row) => row.TABLE_NAME).sort()).toEqual([
      "task_export_bindings", "task_export_credentials", "task_result_references", "task_result_revisions", "task_results",
    ]);
  });

  it("stores no owner, workspace or status on task rows, and lifecycle with provenance", async () => {
    const names = (await columns("task_results")).map((c) => c.COLUMN_NAME);
    expect(names).not.toContain("owner_user_id");
    expect(names).not.toContain("workspace_id");
    expect(names).not.toContain("status");
    expect(names).toEqual(expect.arrayContaining(["lifecycle", "archived_by", "archived_at", "latest_revision_no"]));
    const { bindingId } = await binding();
    const id = await task(bindingId);
    await expect(pool.query("UPDATE task_results SET lifecycle = 'ARCHIVED' WHERE id = ?", [id])).rejects.toThrow();
    await expect(pool.query("UPDATE task_results SET lifecycle = 'DELETED' WHERE id = ?", [id])).rejects.toThrow();
  });

  it("binds to a Workspace, never to a Source", async () => {
    const names = (await columns("task_export_bindings")).map((c) => c.COLUMN_NAME);
    expect(names).toContain("workspace_id");
    expect(names).not.toContain("source_id");
  });

  it("compares task ids, labels and locators case-sensitively", async () => {
    const collation = (rows: Awaited<ReturnType<typeof columns>>, name: string) => rows.find((c) => c.COLUMN_NAME === name)?.COLLATION_NAME;
    expect(collation(await columns("task_results"), "task_id")).toBe("utf8mb4_bin");
    expect(collation(await columns("task_export_bindings"), "label")).toBe("utf8mb4_bin");
    expect(collation(await columns("task_result_references"), "locator")).toBe("utf8mb4_bin");
    const { bindingId } = await binding();
    const lower = await task(bindingId, "abc");
    const upper = await task(bindingId, "ABC");
    expect(lower).not.toBe(upper);
  });

  it("puts foreign keys exactly on credential, binding, task, revision and reference", async () => {
    const rows = await pool.query<{ TABLE_NAME: string; COLUMN_NAME: string; REFERENCED_TABLE_NAME: string }[]>(
      `SELECT TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE 'task\\_%' AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY TABLE_NAME, COLUMN_NAME`,
    );
    expect(rows.map((r) => `${r.TABLE_NAME}.${r.COLUMN_NAME}->${r.REFERENCED_TABLE_NAME}`).sort()).toEqual([
      "task_export_bindings.workspace_id->workspaces",
      "task_export_credentials.binding_id->task_export_bindings",
      "task_result_references.task_result_id->task_results",
      "task_result_revisions.task_result_id->task_results",
      "task_results.binding_id->task_export_bindings",
    ]);
  });
});

describe("task export store", () => {
  it("rejects orphan revisions and references", async () => {
    await expect(run((r) => r.taskExports.insertRevision(revision(uuidv7(), 1)))).rejects.toBeInstanceOf(IntegrityViolationError);
    await expect(
      run((r) => r.taskExports.insertReferences(uuidv7(), 1, [{ ordinal: 0, reference: { type: "COMMIT", id: "abc1234" }, resolution: null, resolvedDocumentId: null }])),
    ).rejects.toBeInstanceOf(IntegrityViolationError);
  });

  it("returns the same task row for a repeated (binding, task id) and never throws on it", async () => {
    const { bindingId } = await binding();
    const taskId = crypto.randomUUID();
    const first = await task(bindingId, taskId);
    expect(await task(bindingId, taskId)).toBe(first);
    expect(await run((r) => r.taskExports.findTask(bindingId, taskId))).toMatchObject({ id: first, latestRevisionNo: 0, lifecycle: "ACTIVE" });
  });

  it("rejects a duplicate revision number for one task", async () => {
    const { bindingId } = await binding();
    const id = await task(bindingId);
    await run((r) => r.taskExports.insertRevision(revision(id, 1)));
    await expect(run((r) => r.taskExports.insertRevision(revision(id, 1, "b".repeat(64))))).rejects.toBeInstanceOf(IntegrityViolationError);
    expect(await run((r) => r.taskExports.getRevision(id, 1))).toMatchObject({ revisionNo: 1, contentHash: "a".repeat(64) });
  });

  it("allows one active credential per binding; revoked ones do not collide", async () => {
    const { bindingId } = await binding();
    await run((r) => r.taskExports.insertCredential({ id: uuidv7(), bindingId, tokenHash: tokenHash(newToken()) }));
    await expect(
      run((r) => r.taskExports.insertCredential({ id: uuidv7(), bindingId, tokenHash: tokenHash(newToken()) })),
    ).rejects.toBeInstanceOf(IntegrityViolationError);
    await run((r) => r.taskExports.revokeCredentialsForBinding(bindingId));
    await run((r) => r.taskExports.insertCredential({ id: uuidv7(), bindingId, tokenHash: tokenHash(newToken()) }));
  });

  it("rotation revokes the old hash in the same transaction", async () => {
    const { bindingId } = await binding();
    const oldToken = newToken();
    const newOne = newToken();
    await run((r) => r.taskExports.insertCredential({ id: uuidv7(), bindingId, tokenHash: tokenHash(oldToken) }));
    await run((r) => r.taskExports.rotateCredential(bindingId, { id: uuidv7(), tokenHash: tokenHash(newOne) }));
    expect(await run((r) => r.taskExports.findCredentialByHash(tokenHash(oldToken)))).toMatchObject({ status: "REVOKED" });
    expect(await run((r) => r.taskExports.findCredentialByHash(tokenHash(newOne)))).toMatchObject({ bindingId, status: "ACTIVE" });
  });

  it("revokes a binding and its credentials atomically", async () => {
    const { bindingId } = await binding();
    const token = newToken();
    await run((r) => r.taskExports.insertCredential({ id: uuidv7(), bindingId, tokenHash: tokenHash(token) }));
    await expect(
      run(async (r) => {
        await r.taskExports.revokeBinding(bindingId);
        await r.taskExports.revokeCredentialsForBinding(bindingId);
        throw new Error("abort");
      }),
    ).rejects.toThrow();
    expect(await run((r) => r.taskExports.getBinding(bindingId))).toMatchObject({ status: "ACTIVE", revokedAt: null });
    expect(await run((r) => r.taskExports.findCredentialByHash(tokenHash(token)))).toMatchObject({ status: "ACTIVE" });
    await run(async (r) => {
      await r.taskExports.revokeBinding(bindingId);
      await r.taskExports.revokeCredentialsForBinding(bindingId);
    });
    expect(await run((r) => r.taskExports.lockBindingShared(bindingId))).toMatchObject({ status: "REVOKED" });
    expect(await run((r) => r.taskExports.findCredentialByHash(tokenHash(token)))).toMatchObject({ status: "REVOKED" });
  });

  it("never lowers the latest revision", async () => {
    const { bindingId } = await binding();
    const id = await task(bindingId);
    await run((r) => r.taskExports.advanceLatestRevision(id, 3));
    await run((r) => r.taskExports.advanceLatestRevision(id, 2));
    expect(await run((r) => r.taskExports.lockTaskForUpdate(id))).toMatchObject({ latestRevisionNo: 3 });
  });

  it("leaves no task, revision or reference rows after a rollback", async () => {
    const { bindingId } = await binding();
    const taskId = crypto.randomUUID();
    await expect(
      run(async (r) => {
        const id = await r.taskExports.insertTaskIfAbsent({ id: uuidv7(), bindingId, taskId });
        await r.taskExports.insertRevision(revision(id, 1));
        await r.taskExports.insertReferences(id, 1, [{ ordinal: 0, reference: { type: "WIKI", path: "a.md" }, resolution: "UNRESOLVED", resolvedDocumentId: null }]);
        throw new Error("abort");
      }),
    ).rejects.toThrow();
    expect(await run((r) => r.taskExports.findTask(bindingId, taskId))).toBeNull();
    const [{ count }] = await pool.query<{ count: number }[]>(
      "SELECT COUNT(*) AS count FROM task_result_references r JOIN task_results t ON t.id = r.task_result_id WHERE t.binding_id = ?",
      [bindingId],
    );
    expect(Number(count)).toBe(0);
  });

  it("round-trips stored references of every type", async () => {
    const { bindingId } = await binding();
    const id = await task(bindingId);
    const documentId = uuidv7();
    const stored = [
      { ordinal: 0, reference: { type: "WIKI" as const, path: "Arch/Auth.md" }, resolution: "RESOLVED" as const, resolvedDocumentId: documentId },
      { ordinal: 1, reference: { type: "WIKI" as const, documentId }, resolution: "UNRESOLVED" as const, resolvedDocumentId: null },
      { ordinal: 2, reference: { type: "CODE_FILE" as const, path: "src/x.ts" }, resolution: null, resolvedDocumentId: null },
      { ordinal: 3, reference: { type: "COMMIT" as const, id: "abc1234" }, resolution: null, resolvedDocumentId: null },
      { ordinal: 4, reference: { type: "PR_URL" as const, url: "https://h/p/1" }, resolution: null, resolvedDocumentId: null },
    ];
    await run(async (r) => {
      await r.taskExports.insertRevision(revision(id, 1));
      await r.taskExports.insertReferences(id, 1, stored);
    });
    expect(await run((r) => r.taskExports.listReferences(id, 1))).toEqual(stored);
  });
});

describe("task knowledge lookups", () => {
  it("finds a synced entry by the path Folder Sync would have normalized, byte-exactly", async () => {
    const { owner, workspaceId, sourceId } = await seedMySpaceWithFolderSource(pool);
    const documentId = await insertSyncedDocument(pool, sourceId, owner.id, "architecture/auth.md");
    for (const raw of ["architecture/auth.md", "architecture\\auth.md", "./architecture/auth.md", "architecture//auth.md"]) {
      expect(await run((r) => r.entries.findActiveEntriesByPath(workspaceId, raw))).toEqual({ kind: "FOUND", candidates: [{ documentId }] });
    }
    expect(await run((r) => r.entries.findActiveEntriesByPath(workspaceId, "Architecture/auth.md"))).toEqual({ kind: "FOUND", candidates: [] });
  });

  it("answers INVALID_PATH for a path normalizeImportPath rejects", async () => {
    const { workspaceId } = await seedMySpaceWithFolderSource(pool);
    for (const raw of [".", "./", "../x.md"]) {
      expect(await run((r) => r.entries.findActiveEntriesByPath(workspaceId, raw))).toEqual({ kind: "INVALID_PATH" });
    }
  });

  it("ignores archived entries, archived Sources and other Workspaces", async () => {
    const { owner, workspaceId, sourceId } = await seedMySpaceWithFolderSource(pool);
    await insertSyncedDocument(pool, sourceId, owner.id, "old.md", { entryStatus: "ARCHIVED" });
    const archivedSource = await insertFolderSource(pool, workspaceId, owner.id, "ARCHIVED");
    await insertSyncedDocument(pool, archivedSource, owner.id, "shelved.md");
    const other = await seedMySpaceWithFolderSource(pool);
    await insertSyncedDocument(pool, other.sourceId, other.owner.id, "theirs.md");
    for (const raw of ["old.md", "shelved.md", "theirs.md"]) {
      expect(await run((r) => r.entries.findActiveEntriesByPath(workspaceId, raw))).toEqual({ kind: "FOUND", candidates: [] });
    }
  });

  it("returns the same path from every synced folder of the Workspace", async () => {
    const { owner, workspaceId, sourceId } = await seedMySpaceWithFolderSource(pool);
    const second = await insertFolderSource(pool, workspaceId, owner.id);
    const a = await insertSyncedDocument(pool, sourceId, owner.id, "README.md");
    const b = await insertSyncedDocument(pool, second, owner.id, "README.md");
    const found = await run((r) => r.entries.findActiveEntriesByPath(workspaceId, "README.md"));
    expect(found.kind === "FOUND" ? found.candidates.map((c) => c.documentId).sort() : found).toEqual([a, b].sort());
  });

  it("reads workspace, source and document state through the local ports", async () => {
    const { owner, workspaceId, sourceId } = await seedMySpaceWithFolderSource(pool);
    const documentId = await insertSyncedDocument(pool, sourceId, owner.id, "a.md", { documentStatus: "ARCHIVED", entryStatus: "ARCHIVED" });
    expect(await run((r) => r.workspaces.lockSharedById(workspaceId))).toEqual({ workspaceId, kind: "PERSONAL", status: "ACTIVE", ownerUserId: owner.id });
    const source = { sourceId, workspaceId, sourceType: "FOLDER_SYNC", status: "ACTIVE" };
    expect(await run((r) => r.sources.getById(sourceId))).toEqual(source);
    expect(await run((r) => r.documents.getState(documentId))).toEqual({ documentId, sourceId, status: "ARCHIVED", title: null });
    expect(await run((r) => r.workspaces.lockSharedById(uuidv7()))).toBeNull();
  });
});

describe("task knowledge unit of work", () => {
  it("reports a failed connection acquire as DatabaseUnavailableError", async () => {
    const failing = { getConnection: () => Promise.reject(new Error("pool timeout")) } as unknown as Pool;
    await expect(new MariaDbTaskKnowledgeUnitOfWork(failing).run(async () => 1)).rejects.toBeInstanceOf(DatabaseUnavailableError);
  });
});
