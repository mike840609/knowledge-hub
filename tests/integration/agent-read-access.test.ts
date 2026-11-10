import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbTaskKnowledgeUnitOfWork } from "@/infrastructure/database/mariadb/task-knowledge-transaction";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import { AgentReadAccessService } from "@/modules/task-knowledge/application/agent-read-access";
import { ManageExportBindingService } from "@/modules/task-knowledge/application/manage-export-binding";
import { insertFolderSource, insertSyncedDocument, seedMySpaceWithFolderSource } from "./task-knowledge-fixtures";

let pool: Pool;
beforeAll(() => { pool = createDatabasePool(databaseConfig("test")); });
afterAll(async () => { await pool.end(); });

async function setup() {
  const seed = await seedMySpaceWithFolderSource(pool);
  const caller = callerFromIdentity(seed.owner);
  const uow = new MariaDbTaskKnowledgeUnitOfWork(pool);
  const bindings = new ManageExportBindingService(uow);
  const { bindingId, token } = await bindings.create(caller, { workspaceId: seed.workspaceId, label: "laptop" });
  return { seed, caller, bindings, bindingId, token, service: new AgentReadAccessService(uow) };
}

describe("agent read access", () => {
  it("yields the owner's caller pinned to the binding's My Space", async () => {
    const { seed, bindingId, token, service } = await setup();
    const scope = await service.authorize(token);
    expect(scope.workspaceId).toBe(seed.workspaceId);
    expect(scope.bindingId).toBe(bindingId);
    expect(scope.documentId).toBeNull();
    expect(scope.caller).toEqual({ identity: seed.owner, identitySynced: true, personalWorkspaceOnly: seed.workspaceId, validatedExternalGroupIds: [], platformCapabilities: [] });
  });

  it("refuses an unknown token, a rotated token and a revoked binding", async () => {
    const { seed, caller, bindings, bindingId, token, service } = await setup();
    await expect(service.authorize("khx_unknown")).rejects.toMatchObject({ code: "CREDENTIAL_INVALID" });
    const { token: next } = await bindings.rotate(caller, { workspaceId: seed.workspaceId, bindingId });
    await expect(service.authorize(token)).rejects.toMatchObject({ code: "CREDENTIAL_INVALID" });
    await bindings.revoke(caller, { workspaceId: seed.workspaceId, bindingId });
    await expect(service.authorize(next)).rejects.toMatchObject({ code: "CREDENTIAL_INVALID" });
  });

  it("refuses a token whose owner has no user row", async () => {
    const { seed, token, service } = await setup();
    const connection = await pool.getConnection();
    try {
      await connection.query("SET FOREIGN_KEY_CHECKS = 0");
      await connection.query("DELETE FROM users WHERE id = ?", [seed.owner.id]);
      await connection.query("SET FOREIGN_KEY_CHECKS = 1");
    } finally {
      await connection.release();
    }
    await expect(service.authorize(token)).rejects.toMatchObject({ code: "CREDENTIAL_INVALID" });
  });

  it("refuses when the My Space is archived", async () => {
    const { seed, token, service } = await setup();
    await pool.query("UPDATE workspaces SET lifecycle_state = 'ARCHIVED', archived_by = ?, archived_at = CURRENT_TIMESTAMP(6) WHERE id = ?", [seed.owner.id, seed.workspaceId]);
    await expect(service.authorize(token)).rejects.toMatchObject({ code: "SCOPE_DENIED" });
  });

  it("resolves one path, reports several, and finds none", async () => {
    const { seed, token, service } = await setup();
    const documentId = await insertSyncedDocument(pool, seed.sourceId, seed.owner.id, "architecture/auth.md");
    const a = await insertSyncedDocument(pool, seed.sourceId, seed.owner.id, "shared/dup.md");
    const second = await insertFolderSource(pool, seed.workspaceId, seed.owner.id);
    const b = await insertSyncedDocument(pool, second, seed.owner.id, "shared/dup.md");
    expect((await service.authorize(token, "architecture/auth.md")).documentId).toBe(documentId);
    await expect(service.authorize(token, "shared/dup.md")).rejects.toMatchObject({ code: "AMBIGUOUS", candidateDocumentIds: expect.arrayContaining([a, b]) });
    await expect(service.authorize(token, "missing.md")).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
  });

  it("passes a UUID ref through without a lookup", async () => {
    const { token, service } = await setup();
    const id = crypto.randomUUID();
    expect((await service.authorize(token, id)).documentId).toBe(id);
  });
});
