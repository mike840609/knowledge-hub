import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import type { CallerContext } from "@/modules/identity/domain/caller-context";
import type { UserIdentity } from "@/modules/identity/domain/user-identity";
import { lockWorkspaceForMutation } from "@/modules/workspaces/application/workspace-mutation-guard";
import { PersonalWorkspaceService } from "@/modules/workspaces/application/personal-workspace-service";
import { CreateFolderImportService } from "@/modules/sources/application/create-folder-import";
import { DEFAULT_IMPORT_LIMITS } from "@/modules/sources/domain/import-limits";
import { PersonalWorkspaceFrozenError, WorkspaceAccessDeniedError } from "@/modules/workspaces/domain/errors";
import { createTeamWorkspaceInsert } from "@/modules/workspaces/domain/workspace";
import { createDirectMembership } from "@/modules/workspaces/domain/workspace-membership";
import { uuidv7 } from "@/shared/ids/uuidv7";
import { disposeIsolatedDatabase, provisionIsolatedDatabase } from "../../scripts/db/test-database";
import { runMigrations, type IsolatedDatabaseHandle } from "../../scripts/db/migrate";

const owner: UserIdentity = { id: "0199f400-0000-7000-8000-000000000001", emp_id: "P3-GUARD-OWNER", name: "Guard Owner", org_code: "P3" };
const editor: UserIdentity = { id: "0199f400-0000-7000-8000-000000000002", emp_id: "P3-GUARD-EDITOR", name: "Guard Editor", org_code: "P3" };
const viewer: UserIdentity = { id: "0199f400-0000-7000-8000-000000000003", emp_id: "P3-GUARD-VIEWER", name: "Guard Viewer", org_code: "P3" };

let handle: IsolatedDatabaseHandle;
let pool: Pool;
let workspaceId: string;

function callerFor(identity: UserIdentity): CallerContext {
  return { identity: { ...identity }, validatedExternalGroupIds: [], platformCapabilities: [] };
}

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
  workspaceId = uuidv7();
  const now = new Date();
  await new MariaDbUnitOfWork(pool).run(async (repositories) => {
    await repositories.users.upsertIdentity(owner);
    await repositories.users.upsertIdentity(editor);
    await repositories.users.upsertIdentity(viewer);
    await repositories.workspaces.insert(createTeamWorkspaceInsert({ id: workspaceId, name: "Guard Team", createdBy: owner.id, now }));
    await repositories.workspaceMemberships.insert(createDirectMembership({ workspaceId, userId: owner.id, role: "OWNER", now }));
    await repositories.workspaceMemberships.insert(createDirectMembership({ workspaceId, userId: editor.id, role: "EDITOR", now }));
    await repositories.workspaceMemberships.insert(createDirectMembership({ workspaceId, userId: viewer.id, role: "VIEWER", now }));
  });
});

afterAll(async () => {
  await pool.end();
  await disposeIsolatedDatabase(handle);
});

describe("Phase 3 mutation guard direct-role write gate (F1)", () => {
  it("denies content-write for a direct VIEWER", async () => {
    await expect(
      new MariaDbUnitOfWork(pool).run((repositories) =>
        lockWorkspaceForMutation(repositories, callerFor(viewer), workspaceId, "content-write"),
      ),
    ).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);
  });

  it("denies source-import for a direct VIEWER", async () => {
    await expect(
      new MariaDbUnitOfWork(pool).run((repositories) =>
        lockWorkspaceForMutation(repositories, callerFor(viewer), workspaceId, "source-import"),
      ),
    ).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);
  });

  it("allows content-write and source-import for direct OWNER and EDITOR", async () => {
    const uow = new MariaDbUnitOfWork(pool);
    await expect(
      uow.run((repositories) => lockWorkspaceForMutation(repositories, callerFor(owner), workspaceId, "content-write")),
    ).resolves.toMatchObject({ id: workspaceId });
    await expect(
      uow.run((repositories) => lockWorkspaceForMutation(repositories, callerFor(editor), workspaceId, "source-import")),
    ).resolves.toMatchObject({ id: workspaceId });
  });
});

describe("Phase 3 My-Space content pass-through (F3)", () => {
  it("lets the owner content-write and source-import in My Space while governance stays frozen", async () => {
    const me: UserIdentity = { id: uuidv7(), emp_id: `P3-GUARD-MYSPACE-${uuidv7().slice(0, 8)}`, name: "My Space Owner", org_code: "P3" };
    const uow = new MariaDbUnitOfWork(pool);
    await uow.run((repositories) => repositories.users.upsertIdentity(me));
    const { workspace } = await new PersonalWorkspaceService(uow).ensurePersonalWorkspace(me.id);

    await expect(
      uow.run((repositories) => lockWorkspaceForMutation(repositories, callerFor(me), workspace.id, "content-write")),
    ).resolves.toMatchObject({ id: workspace.id });
    await expect(
      uow.run((repositories) => lockWorkspaceForMutation(repositories, callerFor(me), workspace.id, "source-import")),
    ).resolves.toMatchObject({ id: workspace.id });

    const created = await new CreateFolderImportService(uow, { limits: DEFAULT_IMPORT_LIMITS }).createInitial(
      callerFor(me),
      {
        workspaceId: workspace.id,
        sourceName: "My Wiki",
        rootName: "wiki",
        manifest: [{ uploadKey: "m1", relativePath: "docs/readme.md", kind: "MARKDOWN", size: 20 }],
      },
    );
    expect(created.state).toBe("BUILDING");

    await expect(
      uow.run((repositories) => lockWorkspaceForMutation(repositories, callerFor(me), workspace.id, "add-member")),
    ).rejects.toBeInstanceOf(PersonalWorkspaceFrozenError);
    await expect(
      uow.run((repositories) => lockWorkspaceForMutation(repositories, callerFor(me), workspace.id, "rename")),
    ).rejects.toBeInstanceOf(PersonalWorkspaceFrozenError);
  });
});
