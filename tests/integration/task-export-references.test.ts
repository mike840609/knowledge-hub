import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbTaskKnowledgeUnitOfWork } from "@/infrastructure/database/mariadb/task-knowledge-transaction";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import { IngestTaskResultService } from "@/modules/task-knowledge/application/ingest-task-result";
import { readTaskReferenceAvailability } from "@/modules/task-knowledge/application/internal/resolve-task-references";
import { ManageExportBindingService } from "@/modules/task-knowledge/application/manage-export-binding";
import { parseTaskArtifact } from "@/modules/task-knowledge/domain/task-artifact";
import type { TaskReferenceInput } from "@/modules/task-knowledge/domain/task-references";
import { insertFolderSource, insertSyncedDocument, seedMySpaceWithFolderSource } from "./task-knowledge-fixtures";

let pool: Pool;
beforeAll(() => { pool = createDatabasePool(databaseConfig("test")); });
afterAll(async () => { await pool.end(); });

const uow = () => new MariaDbTaskKnowledgeUnitOfWork(pool);
const base = JSON.parse(readFileSync(path.join(process.cwd(), "tests/fixtures/task-artifact/artifact/valid.json"), "utf8"));

async function exporter() {
  const seed = await seedMySpaceWithFolderSource(pool);
  const caller = callerFromIdentity(seed.owner);
  const { bindingId, token } = await new ManageExportBindingService(uow()).create(caller, { workspaceId: seed.workspaceId, label: "laptop" });
  return { ...seed, caller, bindingId, token };
}

/** Ingests one artifact carrying `references` and returns what was stored for it. */
async function stored(token: string, references: TaskReferenceInput[]) {
  const { taskResultId } = await new IngestTaskResultService(uow()).ingest(token, { ...base, taskId: crypto.randomUUID(), artifactRevision: 1, references });
  return uow().run((r) => r.taskExports.listReferences(taskResultId, 1));
}

describe("exact Wiki resolution in the binding's My Space", () => {
  it("resolves an exact path and the variants Folder Sync normalizes to it", async () => {
    const { owner, sourceId, token } = await exporter();
    const documentId = await insertSyncedDocument(pool, sourceId, owner.id, "architecture/auth.md");
    const refs = await stored(token, [
      { type: "WIKI", path: "architecture/auth.md" },
      { type: "WIKI", path: "architecture\\auth.md" },
      { type: "WIKI", path: "./architecture/auth.md" },
    ]);
    expect(refs.map((ref) => [ref.resolution, ref.resolvedDocumentId])).toEqual([
      ["RESOLVED", documentId], ["RESOLVED", documentId], ["RESOLVED", documentId],
    ]);
    expect(refs.map((ref) => ref.reference)).toEqual([
      { type: "WIKI", path: "architecture/auth.md" }, { type: "WIKI", path: "architecture\\auth.md" }, { type: "WIKI", path: "./architecture/auth.md" },
    ]);
  });

  it("stores a path the adapter cannot normalize as UNRESOLVED without failing the ingest", async () => {
    const { token } = await exporter();
    const refs = await stored(token, [{ type: "WIKI", path: "." }, { type: "WIKI", path: "./" }]);
    expect(refs.map((ref) => ref.resolution)).toEqual(["UNRESOLVED", "UNRESOLVED"]);
  });

  it("resolves across every synced folder of the My Space, and calls a path in two folders ambiguous", async () => {
    const { owner, workspaceId, sourceId, token } = await exporter();
    const second = await insertFolderSource(pool, workspaceId, owner.id);
    const only = await insertSyncedDocument(pool, second, owner.id, "notes/only.md");
    await insertSyncedDocument(pool, sourceId, owner.id, "README.md");
    await insertSyncedDocument(pool, second, owner.id, "README.md");
    const refs = await stored(token, [{ type: "WIKI", path: "notes/only.md" }, { type: "WIKI", path: "README.md" }, { type: "WIKI", documentId: only }]);
    expect(refs.map((ref) => [ref.resolution, ref.resolvedDocumentId])).toEqual([["RESOLVED", only], ["AMBIGUOUS", null], ["RESOLVED", only]]);
  });

  it("never resolves into another Workspace or an archived Source", async () => {
    const { owner, workspaceId, token } = await exporter();
    const stranger = await exporter();
    const foreign = await insertSyncedDocument(pool, stranger.sourceId, stranger.owner.id, "foreign.md");
    const archivedSource = await insertFolderSource(pool, workspaceId, owner.id, "ARCHIVED");
    const inArchived = await insertSyncedDocument(pool, archivedSource, owner.id, "old-folder.md");
    const refs = await stored(token, [
      { type: "WIKI", path: "foreign.md" }, { type: "WIKI", documentId: foreign },
      { type: "WIKI", path: "old-folder.md" }, { type: "WIKI", documentId: inArchived },
    ]);
    expect(refs.map((ref) => [ref.resolution, ref.resolvedDocumentId])).toEqual([["UNRESOLVED", null], ["UNRESOLVED", null], ["UNRESOLVED", null], ["UNRESOLVED", null]]);
  });

  it("does not guess for missing, archived, case-colliding or ambiguous references", async () => {
    const { owner, sourceId, token } = await exporter();
    await insertSyncedDocument(pool, sourceId, owner.id, "gone.md", { entryStatus: "ARCHIVED", documentStatus: "ARCHIVED" });
    await insertSyncedDocument(pool, sourceId, owner.id, "stale.md", { documentStatus: "ARCHIVED" });
    await insertSyncedDocument(pool, sourceId, owner.id, "Guide.md");
    await insertSyncedDocument(pool, sourceId, owner.id, "twice.md");
    await insertSyncedDocument(pool, sourceId, owner.id, "twice.md");
    const refs = await stored(token, [
      { type: "WIKI", path: "missing.md" },
      { type: "WIKI", path: "gone.md" },
      { type: "WIKI", path: "stale.md" },
      { type: "WIKI", path: "guide.md" },
      { type: "WIKI", path: "twice.md" },
    ]);
    expect(refs.map((ref) => [ref.resolution, ref.resolvedDocumentId])).toEqual([
      ["UNRESOLVED", null], ["UNRESOLVED", null], ["UNRESOLVED", null], ["UNRESOLVED", null], ["AMBIGUOUS", null],
    ]);
  });

  it("resolves a Document ID only when it is an ACTIVE document of the bound Source", async () => {
    const { owner, sourceId, token } = await exporter();
    const active = await insertSyncedDocument(pool, sourceId, owner.id, "a.md");
    const archived = await insertSyncedDocument(pool, sourceId, owner.id, "b.md", { documentStatus: "ARCHIVED" });
    const refs = await stored(token, [{ type: "WIKI", documentId: active }, { type: "WIKI", documentId: archived }]);
    expect(refs.map((ref) => [ref.resolution, ref.resolvedDocumentId])).toEqual([["RESOLVED", active], ["UNRESOLVED", null]]);
  });

  it("rejects traversal and absolute paths in the contract, before resolution", () => {
    for (const bad of ["../../x.md", "/etc/x.md"]) {
      expect(() => parseTaskArtifact({ ...base, references: [{ type: "WIKI", path: bad }] })).toThrow(/references\[0\]\.path/);
    }
  });

  it("keeps CODE_FILE, COMMIT and PR_URL external", async () => {
    const { token } = await exporter();
    const refs = await stored(token, [
      { type: "CODE_FILE", path: "architecture/auth.md" },
      { type: "COMMIT", id: "abc1234" },
      { type: "PR_URL", url: "https://github.com/org/repo/pull/1" },
    ]);
    expect(refs.map((ref) => [ref.resolution, ref.resolvedDocumentId])).toEqual([[null, null], [null, null], [null, null]]);
  });
});

describe("availability on read", () => {
  it("keeps the resolved id after a move and checks the live document", async () => {
    const { owner, sourceId, workspaceId, token, caller } = await exporter();
    const documentId = await insertSyncedDocument(pool, sourceId, owner.id, "old/place.md");
    const [ref] = await stored(token, [{ type: "WIKI", path: "old/place.md" }]);
    await pool.query("UPDATE source_entries SET source_path = 'new/place.md' WHERE document_id = ?", [documentId]);
    expect(ref.resolvedDocumentId).toBe(documentId);
    expect(await uow().run((r) => readTaskReferenceAvailability(r, caller, { workspaceId, reference: ref }))).toBe("RESOLVED");
  });

  it("answers UNAVAILABLE once the document or Source is archived, or for anyone but the owner", async () => {
    const { owner, sourceId, workspaceId, token, caller } = await exporter();
    const documentId = await insertSyncedDocument(pool, sourceId, owner.id, "doc.md");
    const [ref] = await stored(token, [{ type: "WIKI", path: "doc.md" }]);
    const availability = (who = caller) => uow().run((r) => readTaskReferenceAvailability(r, who, { workspaceId, reference: ref }));

    const stranger = (await exporter()).caller;
    const answer = await availability(stranger);
    expect(answer).toBe("UNAVAILABLE");
    expect(JSON.stringify(answer)).not.toContain("doc.md");

    await pool.query("UPDATE knowledge_documents SET status = 'ARCHIVED', archived_by = ?, archived_at = CURRENT_TIMESTAMP(6) WHERE id = ?", [owner.id, documentId]);
    expect(await availability()).toBe("UNAVAILABLE");
    await pool.query("UPDATE knowledge_documents SET status = 'ACTIVE', archived_by = NULL, archived_at = NULL WHERE id = ?", [documentId]);
    expect(await availability()).toBe("RESOLVED");
    await pool.query("UPDATE knowledge_sources SET status = 'ARCHIVED', archived_by = ?, archived_at = CURRENT_TIMESTAMP(6) WHERE id = ?", [owner.id, sourceId]);
    expect(await availability()).toBe("UNAVAILABLE");
  });

  it("never makes an unresolved reference available", async () => {
    const { workspaceId, token, caller } = await exporter();
    const [ref] = await stored(token, [{ type: "WIKI", path: "missing.md" }]);
    expect(await uow().run((r) => readTaskReferenceAvailability(r, caller, { workspaceId, reference: ref }))).toBe("UNAVAILABLE");
  });
});
