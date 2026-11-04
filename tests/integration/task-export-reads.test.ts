import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbTaskKnowledgeUnitOfWork } from "@/infrastructure/database/mariadb/task-knowledge-transaction";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import { IngestTaskResultService } from "@/modules/task-knowledge/application/ingest-task-result";
import { ManageExportBindingService } from "@/modules/task-knowledge/application/manage-export-binding";
import { TaskLifecycleService } from "@/modules/task-knowledge/application/manage-task-lifecycle";
import { TaskResultReadService } from "@/modules/task-knowledge/application/read-task-results";
import { insertSyncedDocument, seedMySpaceWithFolderSource } from "./task-knowledge-fixtures";

let pool: Pool;
beforeAll(() => { pool = createDatabasePool(databaseConfig("test")); });
afterAll(async () => { await pool.end(); });

const uow = () => new MariaDbTaskKnowledgeUnitOfWork(pool);
const reads = () => new TaskResultReadService(uow());
const lifecycle = () => new TaskLifecycleService(uow());
const base = JSON.parse(readFileSync(path.join(process.cwd(), "tests/fixtures/task-artifact/artifact/valid.json"), "utf8"));

async function exporter() {
  const seed = await seedMySpaceWithFolderSource(pool);
  const caller = callerFromIdentity(seed.owner);
  const bindings = new ManageExportBindingService(uow());
  const { bindingId, token } = await bindings.create(caller, { workspaceId: seed.workspaceId, sourceId: seed.sourceId, label: "laptop" });
  const ingest = (body: Record<string, unknown>) => new IngestTaskResultService(uow()).ingest(token, { ...base, ...body });
  return { ...seed, caller, bindings, bindingId, token, ingest };
}

const codeOf = async (promise: Promise<unknown>) => promise.then(() => "OK", (error: { code?: string }) => error.code);

describe("owner reads", () => {
  it("lists and shows a task with resolved and unresolved references and the binding status", async () => {
    const { owner, sourceId, workspaceId, caller, ingest } = await exporter();
    const documentId = await insertSyncedDocument(pool, sourceId, owner.id, "architecture/auth.md");
    const { taskResultId } = await ingest({
      taskId: crypto.randomUUID(), artifactRevision: 1, title: "繁體中文 task — émoji ✅",
      references: [{ type: "WIKI", path: "architecture/auth.md" }, { type: "WIKI", path: "missing.md" }, { type: "PR_URL", url: "https://github.com/o/r/pull/1" }],
    });

    const list = await reads().list(caller, workspaceId, {});
    expect(list.items.map((item) => [item.taskResultId, item.title, item.lifecycle])).toEqual([[taskResultId, "繁體中文 task — émoji ✅", "ACTIVE"]]);

    const detail = await reads().get(caller, workspaceId, taskResultId);
    expect(detail.content.title).toBe("繁體中文 task — émoji ✅");
    expect(detail.binding).toMatchObject({ label: "laptop", status: "ACTIVE" });
    expect(detail.revisions.map((revision) => revision.revisionNo)).toEqual([1]);
    expect(detail.references.map((ref) => [ref.state, ref.document?.documentId ?? null])).toEqual([
      ["RESOLVED", documentId], ["UNRESOLVED", null], [null, null],
    ]);
    expect(detail.references[0].document).toMatchObject({ documentId, sourceId });
  });

  it("answers not found to an unrelated user and through another Workspace, for reads and lifecycle", async () => {
    const { workspaceId, ingest } = await exporter();
    const { taskResultId } = await ingest({ taskId: crypto.randomUUID(), artifactRevision: 1 });
    const stranger = await exporter();
    expect(await codeOf(reads().get(stranger.caller, workspaceId, taskResultId))).toBe("WORKSPACE_NOT_FOUND");
    expect(await codeOf(reads().list(stranger.caller, workspaceId, {}))).toBe("WORKSPACE_NOT_FOUND");
    expect(await codeOf(reads().get(stranger.caller, stranger.workspaceId, taskResultId))).toBe("TASK_RESULT_NOT_FOUND");
    expect(await codeOf(lifecycle().archive(stranger.caller, workspaceId, taskResultId))).toBe("WORKSPACE_NOT_FOUND");
    expect(await codeOf(lifecycle().archive(stranger.caller, stranger.workspaceId, taskResultId))).toBe("TASK_RESULT_NOT_FOUND");
    expect(await codeOf(reads().get(stranger.caller, stranger.workspaceId, "not-a-uuid"))).toBe("TASK_RESULT_NOT_FOUND");
  });

  it("shows the chosen revision", async () => {
    const { workspaceId, caller, ingest } = await exporter();
    const taskId = crypto.randomUUID();
    const { taskResultId } = await ingest({ taskId, artifactRevision: 1, title: "first" });
    await ingest({ taskId, artifactRevision: 2, title: "second" });
    expect((await reads().get(caller, workspaceId, taskResultId)).content.title).toBe("second");
    const first = await reads().get(caller, workspaceId, taskResultId, { revisionNo: 1 });
    expect([first.revisionNo, first.content.title]).toEqual([1, "first"]);
    expect(first.revisions.map((revision) => revision.revisionNo)).toEqual([2, 1]);
    expect(await codeOf(reads().get(caller, workspaceId, taskResultId, { revisionNo: 9 }))).toBe("TASK_RESULT_NOT_FOUND");
  });
});

describe("archive and restore", () => {
  it("moves a task between the default and archived lists, keeps it readable, and gates new revisions", async () => {
    const { workspaceId, caller, ingest } = await exporter();
    const taskId = crypto.randomUUID();
    const { taskResultId } = await ingest({ taskId, artifactRevision: 1 });

    await lifecycle().archive(caller, workspaceId, taskResultId);
    await lifecycle().archive(caller, workspaceId, taskResultId);
    expect((await reads().list(caller, workspaceId, {})).items).toEqual([]);
    expect((await reads().list(caller, workspaceId, { lifecycle: "ARCHIVED" })).items.map((item) => item.taskResultId)).toEqual([taskResultId]);
    expect((await reads().get(caller, workspaceId, taskResultId)).lifecycle).toBe("ARCHIVED");
    expect(await codeOf(ingest({ taskId, artifactRevision: 2 }))).toBe("TASK_ARCHIVED");

    await lifecycle().restore(caller, workspaceId, taskResultId);
    await lifecycle().restore(caller, workspaceId, taskResultId);
    expect((await reads().list(caller, workspaceId, {})).items.map((item) => item.taskResultId)).toEqual([taskResultId]);
    expect(await codeOf(ingest({ taskId, artifactRevision: 2 }))).toBe("OK");
  });
});

describe("after the scope changes", () => {
  it("keeps tasks of a revoked binding readable and shows it revoked", async () => {
    const { workspaceId, caller, bindings, bindingId, ingest } = await exporter();
    const { taskResultId } = await ingest({ taskId: crypto.randomUUID(), artifactRevision: 1 });
    await bindings.revoke(caller, { workspaceId, bindingId });
    expect((await reads().get(caller, workspaceId, taskResultId)).binding.status).toBe("REVOKED");
    expect((await reads().list(caller, workspaceId, {})).items[0].bindingStatus).toBe("REVOKED");
  });

  it("hides the document link of an archived Source without leaking its title", async () => {
    const { owner, sourceId, workspaceId, caller, ingest } = await exporter();
    await insertSyncedDocument(pool, sourceId, owner.id, "secret-title.md");
    const { taskResultId } = await ingest({ taskId: crypto.randomUUID(), artifactRevision: 1, references: [{ type: "WIKI", path: "secret-title.md" }] });
    await pool.query("UPDATE knowledge_sources SET status = 'ARCHIVED', archived_by = ?, archived_at = CURRENT_TIMESTAMP(6) WHERE id = ?", [owner.id, sourceId]);
    const [ref] = (await reads().get(caller, workspaceId, taskResultId)).references;
    expect(ref.state).toBe("UNAVAILABLE");
    expect(ref.document).toBeNull();
  });
});
