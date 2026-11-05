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
import type { TaskKnowledgeRepositories, TaskKnowledgeUnitOfWork } from "@/modules/task-knowledge/ports/unit-of-work";
import { WorkspaceBusyError } from "@/shared/domain/errors";
import { uuidv7 } from "@/shared/ids/uuidv7";
import { newIdentity, seedMySpaceWithFolderSource } from "./task-knowledge-fixtures";

let pool: Pool;
beforeAll(() => { pool = createDatabasePool(databaseConfig("test")); });
afterAll(async () => { await pool.end(); });

const uow = () => new MariaDbTaskKnowledgeUnitOfWork(pool);
const ingest = (token: string, body: unknown, unitOfWork: TaskKnowledgeUnitOfWork = uow()) => new IngestTaskResultService(unitOfWork).ingest(token, typeof body === "string" ? new TextEncoder().encode(body) : new TextEncoder().encode(JSON.stringify(body)));
const bindings = () => new ManageExportBindingService(uow());
const base = JSON.parse(readFileSync(path.join(process.cwd(), "tests/fixtures/task-artifact/artifact/valid.json"), "utf8"));
const artifact = (taskId: string, artifactRevision: number, summary = `Revision ${artifactRevision}.`) => ({ ...base, taskId, artifactRevision, summary });

/** Wraps the real unit of work so a test can patch one repository call. */
function patched(patch: (r: TaskKnowledgeRepositories) => TaskKnowledgeRepositories): TaskKnowledgeUnitOfWork {
  const inner = uow();
  return { run: (work) => inner.run((r) => work(patch(r))) };
}

async function exporter() {
  const seed = await seedMySpaceWithFolderSource(pool);
  const caller = callerFromIdentity(seed.owner);
  const { bindingId, token } = await bindings().create(caller, { workspaceId: seed.workspaceId, label: "laptop" });
  return { ...seed, caller, bindingId, token };
}

async function rejection(promise: Promise<unknown>): Promise<{ code: string; latestRevisionNo?: number }> {
  try {
    await promise;
  } catch (error) {
    return error as { code: string; latestRevisionNo?: number };
  }
  throw new Error("expected a rejection");
}

async function counts(bindingId: string) {
  const [row] = await pool.query<{ tasks: number; revisions: number; refs: number }[]>(
    `SELECT (SELECT COUNT(*) FROM task_results WHERE binding_id = ?) AS tasks,
            (SELECT COUNT(*) FROM task_result_revisions r JOIN task_results t ON t.id = r.task_result_id WHERE t.binding_id = ?) AS revisions,
            (SELECT COUNT(*) FROM task_result_references f JOIN task_results t ON t.id = f.task_result_id WHERE t.binding_id = ?) AS refs`,
    [bindingId, bindingId, bindingId],
  );
  return { tasks: Number(row.tasks), revisions: Number(row.revisions), refs: Number(row.refs) };
}

const latest = async (taskResultId: string) =>
  Number((await pool.query<{ n: number }[]>("SELECT latest_revision_no AS n FROM task_results WHERE id = ?", [taskResultId]))[0].n);

describe("revision sequence", () => {
  it("creates revision 1, answers an exact replay EXISTING, and stores revision 2 beside it", async () => {
    const { token, bindingId, workspaceId } = await exporter();
    const taskId = crypto.randomUUID();
    const first = await ingest(token, artifact(taskId, 1));
    expect(first).toEqual({ state: "CREATED", taskResultId: expect.any(String), revisionNo: 1, bindingId, workspaceId });
    expect(await ingest(token, artifact(taskId, 1))).toEqual({ ...first, state: "EXISTING" });
    expect(await ingest(token, artifact(taskId, 2))).toMatchObject({ state: "CREATED", taskResultId: first.taskResultId, revisionNo: 2 });
    expect(await counts(bindingId)).toMatchObject({ tasks: 1, revisions: 2 });
    expect(await latest(first.taskResultId)).toBe(2);
  });

  it("refuses a skipped number, and revision 2 of an unknown task, with the known latest", async () => {
    const { token, bindingId } = await exporter();
    expect(await rejection(ingest(token, artifact(crypto.randomUUID(), 2)))).toMatchObject({ code: "REVISION_OUT_OF_ORDER", latestRevisionNo: 0 });
    const taskId = crypto.randomUUID();
    await ingest(token, artifact(taskId, 1));
    expect(await rejection(ingest(token, artifact(taskId, 3)))).toMatchObject({ code: "REVISION_OUT_OF_ORDER", latestRevisionNo: 1 });
    expect(await counts(bindingId)).toMatchObject({ tasks: 1, revisions: 1 });
  });

  it("answers a late replay of a stored revision EXISTING or REVISION_CONFLICT, never moving backwards", async () => {
    const { token } = await exporter();
    const taskId = crypto.randomUUID();
    const { taskResultId } = await ingest(token, artifact(taskId, 1));
    await ingest(token, artifact(taskId, 2));
    await ingest(token, artifact(taskId, 3));
    expect(await ingest(token, artifact(taskId, 2))).toMatchObject({ state: "EXISTING", revisionNo: 2 });
    expect(await rejection(ingest(token, artifact(taskId, 2, "Different.")))).toMatchObject({ code: "REVISION_CONFLICT", latestRevisionNo: 3 });
    expect(await rejection(ingest(token, artifact(taskId, 1, "Different.")))).toMatchObject({ code: "REVISION_CONFLICT", latestRevisionNo: 3 });
    expect(await latest(taskResultId)).toBe(3);
  });

  it("treats reordered keys as the same content", async () => {
    const { token } = await exporter();
    const taskId = crypto.randomUUID();
    await ingest(token, artifact(taskId, 1));
    const reordered = Object.fromEntries(Object.entries(artifact(taskId, 1)).reverse());
    expect(await ingest(token, reordered)).toMatchObject({ state: "EXISTING" });
  });
});

describe("archived tasks", () => {
  it("refuses a new revision and still answers an exact replay", async () => {
    const { token, owner, bindingId } = await exporter();
    const taskId = crypto.randomUUID();
    const { taskResultId } = await ingest(token, artifact(taskId, 1));
    await pool.query("UPDATE task_results SET lifecycle = 'ARCHIVED', archived_by = ?, archived_at = CURRENT_TIMESTAMP(6) WHERE id = ?", [owner.id, taskResultId]);
    expect(await rejection(ingest(token, artifact(taskId, 2)))).toMatchObject({ code: "TASK_ARCHIVED" });
    expect(await counts(bindingId)).toMatchObject({ revisions: 1 });
    expect(await ingest(token, artifact(taskId, 1))).toMatchObject({ state: "EXISTING" });
  });
});

describe("concurrency", () => {
  it("meets two simultaneous first ingests on the task row: one CREATED, one EXISTING", async () => {
    const { token, bindingId } = await exporter();
    const taskId = crypto.randomUUID();
    const results = await Promise.all([ingest(token, artifact(taskId, 1)), ingest(token, artifact(taskId, 1))]);
    expect(results.map((result) => result.state).sort()).toEqual(["CREATED", "EXISTING"]);
    expect(await counts(bindingId)).toMatchObject({ tasks: 1, revisions: 1 });
  });

  it("does not wait for a Folder Sync Apply that holds the Workspace shared", async () => {
    const { token, workspaceId } = await exporter();
    const apply = await pool.getConnection();
    try {
      await apply.beginTransaction();
      await apply.query("SELECT id FROM workspaces WHERE id = ? LOCK IN SHARE MODE", [workspaceId]);
      const result = await Promise.race([
        ingest(token, artifact(crypto.randomUUID(), 1)),
        new Promise((_, reject) => setTimeout(() => reject(new Error("ingest waited on the Apply")), 5000)),
      ]);
      expect(result).toMatchObject({ state: "CREATED" });
    } finally {
      await apply.rollback();
      apply.release();
    }
  });
});

describe("revocation and rotation", () => {
  it("rejects after revocation and after the My Space is archived, but not for an archived Source", async () => {
    const revoked = await exporter();
    await bindings().revoke(revoked.caller, { workspaceId: revoked.workspaceId, bindingId: revoked.bindingId });
    expect(await rejection(ingest(revoked.token, artifact(crypto.randomUUID(), 1)))).toMatchObject({ code: "CREDENTIAL_INVALID" });

    const workspace = await exporter();
    await pool.query("UPDATE workspaces SET lifecycle_state = 'ARCHIVED', archived_by = ?, archived_at = CURRENT_TIMESTAMP(6) WHERE id = ?", [workspace.owner.id, workspace.workspaceId]);
    expect(await rejection(ingest(workspace.token, artifact(crypto.randomUUID(), 1)))).toMatchObject({ code: "SCOPE_DENIED" });

    const source = await exporter();
    await pool.query("UPDATE knowledge_sources SET status = 'ARCHIVED', archived_by = ?, archived_at = CURRENT_TIMESTAMP(6) WHERE id = ?", [source.owner.id, source.sourceId]);
    // The binding names the My Space; a Source only serves reference resolution.
    expect(await ingest(source.token, artifact(crypto.randomUUID(), 1))).toMatchObject({ state: "CREATED" });
  });

  it("rejects an unknown or empty token", async () => {
    expect(await rejection(ingest("khx_unknown", artifact(crypto.randomUUID(), 1)))).toMatchObject({ code: "CREDENTIAL_INVALID" });
    expect(await rejection(ingest("", artifact(crypto.randomUUID(), 1)))).toMatchObject({ code: "CREDENTIAL_INVALID" });
  });

  it("rotation invalidates the old token's ingest", async () => {
    const { token, caller, workspaceId, bindingId } = await exporter();
    const rotated = await bindings().rotate(caller, { workspaceId, bindingId });
    expect(await rejection(ingest(token, artifact(crypto.randomUUID(), 1)))).toMatchObject({ code: "CREDENTIAL_INVALID" });
    expect(await ingest(rotated.token, artifact(crypto.randomUUID(), 1))).toMatchObject({ state: "CREATED" });
  });

  it("an ingest waiting on a revoke's binding lock rejects once the revoke commits", async () => {
    const { token, bindingId } = await exporter();
    const revoke = await pool.getConnection();
    try {
      await revoke.beginTransaction();
      await revoke.query("SELECT id FROM task_export_bindings WHERE id = ? FOR UPDATE", [bindingId]);
      const pending = rejection(ingest(token, artifact(crypto.randomUUID(), 1)));
      await new Promise((resolve) => setTimeout(resolve, 300));
      await revoke.query("UPDATE task_export_bindings SET status = 'REVOKED', revoked_at = CURRENT_TIMESTAMP(6) WHERE id = ?", [bindingId]);
      await revoke.query("UPDATE task_export_credentials SET status = 'REVOKED', revoked_at = CURRENT_TIMESTAMP(6) WHERE binding_id = ?", [bindingId]);
      await revoke.commit();
      expect(await pending).toMatchObject({ code: "CREDENTIAL_INVALID" });
      expect(await counts(bindingId)).toMatchObject({ tasks: 0 });
    } finally {
      revoke.release();
    }
  });

  it("a revoke waits for an ingest that already holds the binding shared, and commits after it", async () => {
    const { token, caller, workspaceId, bindingId } = await exporter();
    let reached!: () => void;
    let release!: () => void;
    const atLock = new Promise<void>((resolve) => { reached = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const gated = patched((r) => ({
      ...r,
      taskExports: Object.assign(Object.create(r.taskExports), {
        lockBindingShared: async (id: string) => {
          const row = await r.taskExports.lockBindingShared(id);
          reached();
          await gate;
          return row;
        },
      }),
    }));
    const ingesting = ingest(token, artifact(crypto.randomUUID(), 1), gated);
    await atLock;
    let revoked = false;
    const revoking = bindings().revoke(caller, { workspaceId, bindingId }).then(() => { revoked = true; });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(revoked).toBe(false);
    release();
    expect(await ingesting).toMatchObject({ state: "CREATED" });
    await revoking;
    expect(await rejection(ingest(token, artifact(crypto.randomUUID(), 1)))).toMatchObject({ code: "CREDENTIAL_INVALID" });
  });
});

describe("scope", () => {
  it.each(["workspaceId", "sourceId", "bindingId", "ownerUserId"])("rejects a payload carrying %s", async (field) => {
    const { token, bindingId } = await exporter();
    expect(await rejection(ingest(token, { ...artifact(crypto.randomUUID(), 1), [field]: uuidv7() }))).toMatchObject({ code: "INVALID_ARTIFACT" });
    expect(await counts(bindingId)).toMatchObject({ tasks: 0 });
  });

  it("denies the write once the binding owner no longer owns the Workspace", async () => {
    const { token, bindingId } = await exporter();
    await pool.query("UPDATE task_export_bindings SET owner_user_id = ? WHERE id = ?", [newIdentity("Other").id, bindingId]);
    expect(await rejection(ingest(token, artifact(crypto.randomUUID(), 1)))).toMatchObject({ code: "SCOPE_DENIED" });
  });

  it("returns no token field", async () => {
    const { token } = await exporter();
    const result = await ingest(token, artifact(crypto.randomUUID(), 1));
    expect(JSON.stringify(result)).not.toContain(token);
    expect(Object.keys(result).sort()).toEqual(["bindingId", "revisionNo", "state", "taskResultId", "workspaceId"]);
  });
});

describe("failures", () => {
  const failing = (error: Error) =>
    patched((r) => ({
      ...r,
      taskExports: Object.assign(Object.create(r.taskExports), {
        insertRevision: async () => { throw error; },
      }),
    }));

  it.each([
    ["deadlock", Object.assign(new Error("Deadlock found"), { errno: 1213, code: "ER_LOCK_DEADLOCK" })],
    ["lock wait timeout", Object.assign(new Error("Lock wait timeout exceeded"), { errno: 1205, code: "ER_LOCK_WAIT_TIMEOUT" })],
  ])("surfaces a %s as WorkspaceBusyError and writes nothing", async (_name, error) => {
    const { token, bindingId } = await exporter();
    await expect(ingest(token, artifact(crypto.randomUUID(), 1), failing(error))).rejects.toBeInstanceOf(WorkspaceBusyError);
    expect(await counts(bindingId)).toEqual({ tasks: 0, revisions: 0, refs: 0 });
  });

  it("rolls back every row when a write fails after the task insert", async () => {
    const { token, bindingId } = await exporter();
    await expect(ingest(token, artifact(crypto.randomUUID(), 1), failing(new Error("boom")))).rejects.toThrow();
    expect(await counts(bindingId)).toEqual({ tasks: 0, revisions: 0, refs: 0 });
  });

  it("judges the credential before the body: a stranger learns nothing about the contract", async () => {
    for (const body of [{ ...base, schemaVersion: 2 }, { ...base, references: [{ type: "constructor" }] }, "{not json"]) {
      expect(await rejection(ingest("khx_unknown", body))).toMatchObject({ code: "CREDENTIAL_INVALID" });
    }
  });

  it("answers a live credential's malformed or invalid body, and writes nothing", async () => {
    const { token, bindingId } = await exporter();
    expect(await rejection(ingest(token, "{not json"))).toMatchObject({ code: "MALFORMED_JSON" });
    expect(await rejection(ingest(token, { ...base, schemaVersion: 2 }))).toMatchObject({ code: "UNSUPPORTED_SCHEMA_VERSION" });
    expect(await counts(bindingId)).toEqual({ tasks: 0, revisions: 0, refs: 0 });
  });
});
