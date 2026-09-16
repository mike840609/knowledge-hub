import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import type { UserIdentity } from "@/modules/identity/domain/user-identity";
import { DEFAULT_HUB_SOURCE_NAME, ensureDefaultHubSource } from "@/modules/sources/application/ensure-default-hub-source";
import { WorkspaceAccessDeniedError } from "@/modules/workspaces/domain/errors";
import { createTeamWorkspaceInsert } from "@/modules/workspaces/domain/workspace";
import { createDirectMembership } from "@/modules/workspaces/domain/workspace-membership";
import { uuidv7 } from "@/shared/ids/uuidv7";

let pool: Pool;
beforeAll(() => { pool = createDatabasePool(databaseConfig("test")); });
afterAll(async () => { await pool.end(); });

const owner: UserIdentity = { id: "00000000-0000-0000-0000-000000000511", emp_id: "P5-OWNER", name: "Owner", org_code: "HRSD" };
const viewer: UserIdentity = { id: "00000000-0000-0000-0000-000000000512", emp_id: "P5-VIEWER", name: "Viewer", org_code: "HRSD" };

async function createWorkspace(): Promise<string> {
  const unitOfWork = new MariaDbUnitOfWork(pool);
  const workspaceId = uuidv7();
  const now = new Date();
  await unitOfWork.run(async (repositories) => {
    for (const identity of [owner, viewer]) await repositories.users.upsertIdentity(identity);
    await repositories.workspaces.insert(createTeamWorkspaceInsert({ id: workspaceId, name: `WS ${workspaceId}`, createdBy: owner.id, now }));
    await repositories.workspaceMemberships.insert(createDirectMembership({ workspaceId, userId: owner.id, role: "OWNER", createdBy: owner.id, now }));
    await repositories.workspaceMemberships.insert(createDirectMembership({ workspaceId, userId: viewer.id, role: "VIEWER", createdBy: owner.id, now }));
  });
  return workspaceId;
}

describe("ensureDefaultHubSource (spec §5)", () => {
  it("creates a Notes source on first use", async () => {
    const workspaceId = await createWorkspace();
    const unitOfWork = new MariaDbUnitOfWork(pool);
    const sourceId = await ensureDefaultHubSource(unitOfWork, callerFromIdentity(owner), workspaceId);
    const sources = await unitOfWork.run((repositories) => repositories.sourcePolicy.listByWorkspaceId(workspaceId));
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ id: sourceId, name: DEFAULT_HUB_SOURCE_NAME, sourceType: "HUB", ownership: "HUB_MANAGED", status: "ACTIVE" });
  });

  it("is idempotent: a second call reuses the same source", async () => {
    const workspaceId = await createWorkspace();
    const unitOfWork = new MariaDbUnitOfWork(pool);
    const caller = callerFromIdentity(owner);
    const first = await ensureDefaultHubSource(unitOfWork, caller, workspaceId);
    const second = await ensureDefaultHubSource(unitOfWork, caller, workspaceId);
    expect(second).toBe(first);
    const sources = await unitOfWork.run((repositories) => repositories.sourcePolicy.listByWorkspaceId(workspaceId));
    expect(sources).toHaveLength(1);
  });

  it("creates exactly one source under concurrent first writes", async () => {
    const workspaceId = await createWorkspace();
    const caller = callerFromIdentity(owner);
    const results = await Promise.all([
      ensureDefaultHubSource(new MariaDbUnitOfWork(pool), caller, workspaceId),
      ensureDefaultHubSource(new MariaDbUnitOfWork(pool), caller, workspaceId),
    ]);
    expect(results[0]).toBe(results[1]);
    const sources = await new MariaDbUnitOfWork(pool).run((repositories) => repositories.sourcePolicy.listByWorkspaceId(workspaceId));
    expect(sources).toHaveLength(1);
  });

  it("refuses a caller without document.write", async () => {
    const workspaceId = await createWorkspace();
    await expect(ensureDefaultHubSource(new MariaDbUnitOfWork(pool), callerFromIdentity(viewer), workspaceId))
      .rejects.toBeInstanceOf(WorkspaceAccessDeniedError);
  });
});
