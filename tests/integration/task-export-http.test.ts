import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbTaskKnowledgeUnitOfWork } from "@/infrastructure/database/mariadb/task-knowledge-transaction";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import { IngestTaskResultService } from "@/modules/task-knowledge/application/ingest-task-result";
import { ManageExportBindingService } from "@/modules/task-knowledge/application/manage-export-binding";
import { seedMySpaceWithFolderSource } from "./task-knowledge-fixtures";

const injected = vi.hoisted(() => ({ service: null as unknown }));
vi.mock("@/server/composition", () => ({ taskIngestService: () => injected.service }));

import { POST } from "@/app/api/task-results/ingest/route";

let pool: Pool;
beforeAll(() => {
  pool = createDatabasePool(databaseConfig("test"));
  injected.service = new IngestTaskResultService(new MariaDbTaskKnowledgeUnitOfWork(pool));
});
afterAll(async () => { await pool.end(); });

const base = JSON.parse(readFileSync(path.join(process.cwd(), "tests/fixtures/task-artifact/artifact/valid.json"), "utf8"));
const send = (token: string, body: unknown) =>
  POST(new Request("https://km.example.com/api/task-results/ingest", {
    method: "POST",
    headers: { "content-type": "application/json", "x-knowledge-hub-export-token": token },
    body: JSON.stringify(body),
  }));

async function exporter() {
  const seed = await seedMySpaceWithFolderSource(pool);
  const caller = callerFromIdentity(seed.owner);
  const bindings = new ManageExportBindingService(new MariaDbTaskKnowledgeUnitOfWork(pool));
  const { bindingId, token } = await bindings.create(caller, { workspaceId: seed.workspaceId, label: "laptop" });
  return { ...seed, caller, bindings, bindingId, token };
}

describe("task ingest over HTTP", () => {
  it("creates, replays, and continues a task with a real credential", async () => {
    const { token, bindingId, workspaceId } = await exporter();
    const taskId = crypto.randomUUID();
    const first = await send(token, { ...base, taskId, artifactRevision: 1 });
    expect(first.status).toBe(201);
    const body = await first.json();
    expect(body).toEqual({ taskResultId: expect.any(String), revisionNo: 1, bindingId, url: `/w/${workspaceId}/tasks/${body.taskResultId}` });
    expect((await send(token, { ...base, taskId, artifactRevision: 1 })).status).toBe(200);
    const skipped = await send(token, { ...base, taskId, artifactRevision: 3 });
    expect(skipped.status).toBe(409);
    expect((await skipped.json()).error).toMatchObject({ code: "REVISION_OUT_OF_ORDER", latestRevisionNo: 1 });
  });

  it("answers 401 for a rotated-out credential", async () => {
    const { token, caller, bindings, bindingId, workspaceId } = await exporter();
    await bindings.rotate(caller, { workspaceId, bindingId });
    expect((await send(token, { ...base, taskId: crypto.randomUUID(), artifactRevision: 1 })).status).toBe(401);
  });

  it("answers 403 for a credential whose My Space was archived", async () => {
    const { token, owner, workspaceId } = await exporter();
    await pool.query("UPDATE workspaces SET lifecycle_state = 'ARCHIVED', archived_by = ?, archived_at = CURRENT_TIMESTAMP(6) WHERE id = ?", [owner.id, workspaceId]);
    expect((await send(token, { ...base, taskId: crypto.randomUUID(), artifactRevision: 1 })).status).toBe(403);
  });
});
