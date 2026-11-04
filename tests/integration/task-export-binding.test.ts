import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbTaskKnowledgeUnitOfWork } from "@/infrastructure/database/mariadb/task-knowledge-transaction";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import { ManageExportBindingService } from "@/modules/task-knowledge/application/manage-export-binding";
import { hashExportToken } from "@/modules/task-knowledge/domain/export-credential";
import { TeamWorkspaceService } from "@/modules/workspaces/application/team-workspace-service";
import { uuidv7 } from "@/shared/ids/uuidv7";
import { newIdentity, seedMySpace, seedMySpaceWithFolderSource } from "./task-knowledge-fixtures";

let pool: Pool;
beforeAll(() => { pool = createDatabasePool(databaseConfig("test")); });
afterAll(async () => { await pool.end(); });

const service = () => new ManageExportBindingService(new MariaDbTaskKnowledgeUnitOfWork(pool));
const credentialStatus = async (token: string) =>
  (await new MariaDbTaskKnowledgeUnitOfWork(pool).run((r) => r.taskExports.findCredentialByHash(hashExportToken(token))))?.status ?? null;

async function owned() {
  const seed = await seedMySpaceWithFolderSource(pool);
  return { ...seed, caller: callerFromIdentity(seed.owner) };
}

async function errorCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return (error as { code?: string }).code ?? "NO_CODE";
  }
  throw new Error("expected a rejection");
}

describe("creating a binding", () => {
  it("issues a token once and lists the binding without credential material", async () => {
    const { caller, workspaceId } = await owned();
    const { bindingId, token } = await service().create(caller, { workspaceId, label: "laptop" });
    expect(token).toMatch(/^khx_[A-Za-z0-9_-]{43}$/);
    expect(await credentialStatus(token)).toBe("ACTIVE");
    const list = await service().list(caller, workspaceId);
    expect(list).toEqual([expect.objectContaining({ bindingId, label: "laptop", status: "ACTIVE", hasActiveCredential: true })]);
    const serialized = JSON.stringify(list);
    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain(Buffer.from(hashExportToken(token)).toString("hex"));
    expect(serialized).not.toMatch(/token|hash/i);
  });

  it("never stores the plaintext token", async () => {
    const { caller, workspaceId } = await owned();
    const { bindingId, token } = await service().create(caller, { workspaceId, label: "laptop" });
    const rows = await pool.query<{ token_hash: Buffer }[]>("SELECT token_hash FROM task_export_credentials WHERE binding_id = ?", [bindingId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash.toString("utf8")).not.toContain(token);
    expect(Buffer.from(rows[0].token_hash).equals(Buffer.from(hashExportToken(token)))).toBe(true);
  });

  it("refuses a Team Workspace", async () => {
    const { caller } = await owned();
    const creator = { ...caller, platformCapabilities: ["workspace.create_team" as const] };
    const team = await new TeamWorkspaceService(new MariaDbUnitOfWork(pool)).createTeamWorkspace(creator, { name: `Team ${uuidv7().slice(-6)}` });
    expect(await errorCode(service().create(caller, { workspaceId: team.id, label: "x" }))).toBe("WORKSPACE_NOT_FOUND");
  });

  it("refuses another user's My Space and a forged caller", async () => {
    const { workspaceId } = await owned();
    const other = await owned();
    expect(await errorCode(service().create(other.caller, { workspaceId, label: "x" }))).toBe("WORKSPACE_NOT_FOUND");
    const forged = callerFromIdentity(newIdentity("Forged"));
    expect(await errorCode(service().create(forged, { workspaceId, label: "x" }))).toBe("WORKSPACE_NOT_FOUND");
  });

  it("needs no synced folder: a binding names the My Space only", async () => {
    const seed = await seedMySpace(pool);
    const caller = callerFromIdentity(seed.owner);
    const { bindingId } = await service().create(caller, { workspaceId: seed.workspaceId, label: "laptop" });
    expect(await service().list(caller, seed.workspaceId)).toEqual([expect.objectContaining({ bindingId, label: "laptop", status: "ACTIVE" })]);
  });

  it("refuses an archived Workspace", async () => {
    const { owner, caller, workspaceId } = await owned();
    await pool.query("UPDATE workspaces SET lifecycle_state = 'ARCHIVED', archived_by = ?, archived_at = CURRENT_TIMESTAMP(6) WHERE id = ?", [owner.id, workspaceId]);
    expect(await errorCode(service().create(caller, { workspaceId, label: "x" }))).toBe("WORKSPACE_ARCHIVED");
  });

  it.each(["", "   ", "x".repeat(201)])("refuses the label %j", async (label) => {
    const { caller, workspaceId } = await owned();
    expect(await errorCode(service().create(caller, { workspaceId, label }))).toBe("INVALID_REQUEST");
  });
});

describe("rotating and revoking", () => {
  it("rotation issues a new token and the previous one stops working", async () => {
    const { caller, workspaceId } = await owned();
    const { bindingId, token } = await service().create(caller, { workspaceId, label: "laptop" });
    const rotated = await service().rotate(caller, { workspaceId, bindingId });
    expect(rotated.token).not.toBe(token);
    expect(await credentialStatus(token)).toBe("REVOKED");
    expect(await credentialStatus(rotated.token)).toBe("ACTIVE");
    const [{ active }] = await pool.query<{ active: number }[]>(
      "SELECT COUNT(*) AS active FROM task_export_credentials WHERE binding_id = ? AND status = 'ACTIVE'",
      [bindingId],
    );
    expect(Number(active)).toBe(1);
    expect((await service().list(caller, workspaceId))[0]).toMatchObject({ hasActiveCredential: true });
  });

  it("revocation makes the credential unusable on the next read", async () => {
    const { caller, workspaceId } = await owned();
    const { bindingId, token } = await service().create(caller, { workspaceId, label: "laptop" });
    await service().revoke(caller, { workspaceId, bindingId });
    expect(await credentialStatus(token)).toBe("REVOKED");
    expect((await service().list(caller, workspaceId))[0]).toMatchObject({ status: "REVOKED", hasActiveCredential: false });
    await service().revoke(caller, { workspaceId, bindingId });
  });

  it("refuses to rotate a revoked binding and leaves no active credential", async () => {
    const { caller, workspaceId } = await owned();
    const { bindingId } = await service().create(caller, { workspaceId, label: "laptop" });
    await service().revoke(caller, { workspaceId, bindingId });
    expect(await errorCode(service().rotate(caller, { workspaceId, bindingId }))).toBe("BINDING_REVOKED");
    const [{ active }] = await pool.query<{ active: number }[]>(
      "SELECT COUNT(*) AS active FROM task_export_credentials WHERE binding_id = ? AND status = 'ACTIVE'",
      [bindingId],
    );
    expect(Number(active)).toBe(0);
  });

  it("refuses rotation and revocation by a non-owner, and an unknown binding alike", async () => {
    const { caller, workspaceId } = await owned();
    const { bindingId, token } = await service().create(caller, { workspaceId, label: "laptop" });
    const other = await owned();
    expect(await errorCode(service().rotate(other.caller, { workspaceId, bindingId }))).toBe("TASK_EXPORT_BINDING_NOT_FOUND");
    expect(await errorCode(service().revoke(other.caller, { workspaceId, bindingId }))).toBe("TASK_EXPORT_BINDING_NOT_FOUND");
    expect(await errorCode(service().revoke(other.caller, { workspaceId: other.workspaceId, bindingId }))).toBe("TASK_EXPORT_BINDING_NOT_FOUND");
    expect(await errorCode(service().rotate(caller, { workspaceId, bindingId: uuidv7() }))).toBe("TASK_EXPORT_BINDING_NOT_FOUND");
    expect(await errorCode(service().list(other.caller, workspaceId))).toBe("WORKSPACE_NOT_FOUND");
    expect(await credentialStatus(token)).toBe("ACTIVE");
  });
});
