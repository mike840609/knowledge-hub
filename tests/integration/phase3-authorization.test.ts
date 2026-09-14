import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import type { CallerContext } from "@/modules/identity/domain/caller-context";
import type { UserIdentity } from "@/modules/identity/domain/user-identity";
import { IntegrityViolationError } from "@/modules/knowledge/domain/errors";
import {
  describeOtherUserAccess,
  evaluateEffectiveCapabilities,
  OTHER_USER_GROUP_ACCESS_UNKNOWN,
  requireWorkspaceRead,
} from "@/modules/workspaces/application/workspace-authorization";
import { WorkspaceQueryService, WorkspaceMembershipPolicy } from "@/modules/workspaces/application/workspace-query-service";
import type { WorkspaceCapability } from "@/modules/workspaces/domain/workspace-capability";
import { WorkspaceAccessDeniedError, WorkspaceNotFoundError } from "@/modules/workspaces/domain/errors";
import {
  createPersonalWorkspaceInsert,
  createTeamWorkspaceInsert,
} from "@/modules/workspaces/domain/workspace";
import { createDirectMembership, createSystemPersonalMembership } from "@/modules/workspaces/domain/workspace-membership";
import { uuidv7 } from "@/shared/ids/uuidv7";
import { disposeIsolatedDatabase, provisionIsolatedDatabase } from "../../scripts/db/test-database";
import { runMigrations, type IsolatedDatabaseHandle } from "../../scripts/db/migrate";
import { migrations } from "@/infrastructure/database/mariadb/migrations";

const owner: UserIdentity = { id: "0199f360-0000-7000-8000-000000000001", emp_id: "P3-AUTH-OWNER", name: "Auth Owner", org_code: "ORG-A" };
const viewer: UserIdentity = { id: "0199f360-0000-7000-8000-000000000002", emp_id: "P3-AUTH-VIEWER", name: "Auth Viewer", org_code: "ORG-A" };
const crossOrgEditor: UserIdentity = { id: "0199f360-0000-7000-8000-000000000003", emp_id: "P3-AUTH-XORG", name: "Cross Org", org_code: "ORG-B" };
const groupOnly: UserIdentity = { id: "0199f360-0000-7000-8000-000000000004", emp_id: "P3-AUTH-GROUP", name: "Group Only", org_code: "ORG-B" };
const stranger: UserIdentity = { id: "0199f360-0000-7000-8000-000000000005", emp_id: "P3-AUTH-STRANGER", name: "Stranger", org_code: "ORG-A" };

function callerFor(identity: UserIdentity, validatedExternalGroupIds: readonly string[] = []): CallerContext {
  return { identity: { ...identity }, validatedExternalGroupIds: [...validatedExternalGroupIds], platformCapabilities: [] };
}

let handle: IsolatedDatabaseHandle;
let pool: Pool;
let sharedPersonalWorkspaceId: string;

async function openPool(): Promise<Pool> {
  const previous = process.env.KM_TEST_DB_NAME;
  process.env.KM_TEST_DB_NAME = handle.databaseName;
  try {
    return createDatabasePool(databaseConfig("test"));
  } finally {
    if (previous === undefined) delete process.env.KM_TEST_DB_NAME;
    else process.env.KM_TEST_DB_NAME = previous;
  }
}

type Fixture = {
  teamWorkspaceId: string;
  groupWorkspaceId: string;
  personalWorkspaceId: string;
  editorGroupId: string;
  viewerGroupId: string;
};

async function setupFixture(): Promise<Fixture> {
  const teamWorkspaceId = uuidv7();
  const groupWorkspaceId = uuidv7();
  const personalWorkspaceId = sharedPersonalWorkspaceId;
  const editorGroupId = `sso-group-auth-editor-${uuidv7()}`;
  const viewerGroupId = `sso-group-auth-viewer-${uuidv7()}`;
  const now = new Date();
  await new MariaDbUnitOfWork(pool).run(async (repositories) => {
    for (const user of [owner, viewer, crossOrgEditor, groupOnly, stranger]) {
      await repositories.users.upsertIdentity(user);
    }
    await repositories.workspaces.insert(createTeamWorkspaceInsert({ id: teamWorkspaceId, name: "Auth Team", createdBy: owner.id, now }));
    await repositories.workspaces.insert(createTeamWorkspaceInsert({ id: groupWorkspaceId, name: "Auth Group Grant", createdBy: owner.id, now }));
    await repositories.workspaceMemberships.insert(createDirectMembership({ workspaceId: teamWorkspaceId, userId: owner.id, role: "OWNER", now }));
    await repositories.workspaceMemberships.insert(createDirectMembership({ workspaceId: teamWorkspaceId, userId: viewer.id, role: "VIEWER", now }));
    await repositories.workspaceMemberships.insert(
      createDirectMembership({ workspaceId: teamWorkspaceId, userId: crossOrgEditor.id, role: "EDITOR", now }),
    );
    await repositories.groupMappings.insert({
      id: uuidv7(), workspaceId: teamWorkspaceId, externalGroupId: editorGroupId, role: "EDITOR",
      createdBy: owner.id, createdAt: now, updatedAt: now,
    });
    await repositories.groupMappings.insert({
      id: uuidv7(), workspaceId: groupWorkspaceId, externalGroupId: viewerGroupId, role: "VIEWER",
      createdBy: owner.id, createdAt: now, updatedAt: now,
    });
  });
  return { teamWorkspaceId, groupWorkspaceId, personalWorkspaceId, editorGroupId, viewerGroupId };
}

beforeAll(async () => {
  handle = await provisionIsolatedDatabase("test");
  pool = await openPool();
  // Full manifest: canonical writers record membership provenance
  // (created_by/updated_at, migration 009). The pre-bootstrap NULL-role
  // tolerance test below runs on an isolated 008 database.
  await runMigrations(pool, migrations);
  sharedPersonalWorkspaceId = uuidv7();
  const now = new Date();
  await new MariaDbUnitOfWork(pool).run(async (repositories) => {
    await repositories.users.upsertIdentity(owner);
    await repositories.workspaces.insert(
      createPersonalWorkspaceInsert({ id: sharedPersonalWorkspaceId, name: "My Space", ownerUserId: owner.id, now }),
    );
    await repositories.workspaceMemberships.insert(
      createSystemPersonalMembership({ workspaceId: sharedPersonalWorkspaceId, userId: owner.id, now }),
    );
  });
});

afterAll(async () => {
  await pool.end();
  await disposeIsolatedDatabase(handle);
});

describe("Phase 3 workspace capability evaluation (Task 6)", () => {
  it("unions direct VIEWER capabilities with matched group EDITOR capabilities", async () => {
    const fixture = await setupFixture();
    const uow = new MariaDbUnitOfWork(pool);
    const capabilities = await uow.run(async (repositories) => {
      const policy = new WorkspaceMembershipPolicy(repositories.workspaceMemberships, repositories.groupMappings);
      return policy.evaluateCapabilities(callerFor(viewer, [fixture.editorGroupId]), fixture.teamWorkspaceId);
    });
    expect(capabilities.has("workspace.discover")).toBe(true);
    expect(capabilities.has("document.read")).toBe(true);
    expect(capabilities.has("document.write")).toBe(true);
    expect(capabilities.has("source.manage")).toBe(true);
    expect(capabilities.has("workspace.archive")).toBe(false);
  });

  it("grants baseline visibility to pre-bootstrap direct rows with NULL roles (isolated 008 database)", async () => {
    const nullHandle = await provisionIsolatedDatabase("test");
    const previous = process.env.KM_TEST_DB_NAME;
    process.env.KM_TEST_DB_NAME = nullHandle.databaseName;
    let nullPool: Pool | undefined;
    try {
      nullPool = createDatabasePool(databaseConfig("test"));
      await runMigrations(nullPool, migrations, { to: 8 });
      const userId = uuidv7();
      const teamId = uuidv7();
      await nullPool.query("INSERT INTO users (id, emp_id, name, org_code) VALUES (?, ?, 'Null Tolerance User', 'ORG-A')", [userId, `P3-AUTH-NULL-${userId.slice(0, 8)}`]);
      await nullPool.query("INSERT INTO workspaces (id, name, workspace_type) VALUES (?, 'Null Tolerance Team', 'TEAM')", [teamId]);
      await nullPool.query("INSERT INTO workspace_memberships (workspace_id, user_id) VALUES (?, ?)", [teamId, userId]);
      const nullCaller: CallerContext = { identity: { id: userId, emp_id: "null", name: "Null Tolerance User", org_code: "ORG-A" }, validatedExternalGroupIds: [], platformCapabilities: [] };
      const uow = new MariaDbUnitOfWork(nullPool);
      await uow.run(async (repositories) => {
        const policy = new WorkspaceMembershipPolicy(repositories.workspaceMemberships, repositories.groupMappings);
        await expect(policy.requireMembership(nullCaller, teamId)).resolves.toBeUndefined();
        const capabilities = await policy.evaluateCapabilities(nullCaller, teamId);
        expect(capabilities.has("workspace.discover")).toBe(true);
        expect(capabilities.has("document.read")).toBe(true);
        expect(capabilities.has("document.write")).toBe(false);
      });
    } finally {
      if (previous === undefined) delete process.env.KM_TEST_DB_NAME;
      else process.env.KM_TEST_DB_NAME = previous;
      if (nullPool) await nullPool.end();
      await disposeIsolatedDatabase(nullHandle);
    }
  });

  it("grants group-only access without any direct membership", async () => {
    const fixture = await setupFixture();
    const uow = new MariaDbUnitOfWork(pool);
    await uow.run(async (repositories) => {
      const policy = new WorkspaceMembershipPolicy(repositories.workspaceMemberships, repositories.groupMappings);
      await expect(
        policy.requireMembership(callerFor(groupOnly, [fixture.viewerGroupId]), fixture.groupWorkspaceId),
      ).resolves.toBeUndefined();
      const capabilities = await policy.evaluateCapabilities(callerFor(groupOnly, [fixture.viewerGroupId]), fixture.groupWorkspaceId);
      expect(capabilities.has("document.read")).toBe(true);
      expect(capabilities.has("document.write")).toBe(false);
    });
  });

  it("makes group OWNER grants impossible and ignores fabricated OWNER rows", async () => {
    const fixture = await setupFixture();
    const now = new Date();
    const hostile = JSON.parse(JSON.stringify({
      id: uuidv7(), workspaceId: fixture.teamWorkspaceId, externalGroupId: `sso-group-owner-${uuidv7()}`, role: "OWNER",
      createdBy: owner.id, createdAt: now.toISOString(), updatedAt: now.toISOString(),
    })) as import("@/modules/workspaces/domain/workspace-group-mapping").WorkspaceGroupMapping;
    await expect(
      new MariaDbUnitOfWork(pool).run((repositories) => repositories.groupMappings.insert(hostile)),
    ).rejects.toBeInstanceOf(IntegrityViolationError);
    await expect(
      pool.query(
        "INSERT INTO workspace_group_mappings (id, workspace_id, external_group_id, role, created_by, created_at, updated_at) VALUES (?, ?, ?, 'OWNER', ?, NOW(), NOW())",
        [uuidv7(), fixture.teamWorkspaceId, Buffer.from(`sso-group-owner-${uuidv7()}`, "utf8"), owner.id],
      ),
    ).rejects.toBeTruthy();
    const fabricated = evaluateEffectiveCapabilities({
      directRole: undefined,
      validatedExternalGroupIds: ["sso-group-fabricated"],
      groupMappings: [{ externalGroupId: "sso-group-fabricated", role: "OWNER" }],
    });
    expect(fabricated.size).toBe(0);
  });

  it("matches external groups by exact bytes only", async () => {
    const fixture = await setupFixture();
    const uow = new MariaDbUnitOfWork(pool);
    await uow.run(async (repositories) => {
      const policy = new WorkspaceMembershipPolicy(repositories.workspaceMemberships, repositories.groupMappings);
      await expect(
        policy.requireMembership(callerFor(groupOnly, [` ${fixture.viewerGroupId} `]), fixture.groupWorkspaceId),
      ).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);
      await expect(
        policy.requireMembership(callerFor(groupOnly, [fixture.viewerGroupId]), fixture.groupWorkspaceId),
      ).resolves.toBeUndefined();
    });
  });

  it("denies same-org callers without direct or group grants", async () => {
    const fixture = await setupFixture();
    const uow = new MariaDbUnitOfWork(pool);
    await uow.run(async (repositories) => {
      const policy = new WorkspaceMembershipPolicy(repositories.workspaceMemberships, repositories.groupMappings);
      await expect(
        policy.requireMembership(callerFor(stranger), fixture.teamWorkspaceId),
      ).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);
      const capabilities = await policy.evaluateCapabilities(callerFor(stranger), fixture.teamWorkspaceId);
      expect(capabilities.size).toBe(0);
    });
  });

  it("allows cross-org callers with a valid grant", async () => {
    const fixture = await setupFixture();
    const uow = new MariaDbUnitOfWork(pool);
    await uow.run(async (repositories) => {
      const policy = new WorkspaceMembershipPolicy(repositories.workspaceMemberships, repositories.groupMappings);
      await expect(
        policy.requireMembership(callerFor(crossOrgEditor), fixture.teamWorkspaceId),
      ).resolves.toBeUndefined();
    });
  });

  it("applies discover 404 vs read 403 visibility semantics", async () => {
    const fixture = await setupFixture();
    const uow = new MariaDbUnitOfWork(pool);
    await uow.run(async (repositories) => {
      const policy = new WorkspaceMembershipPolicy(repositories.workspaceMemberships, repositories.groupMappings);
      await expect(policy.requireWorkspaceRead(callerFor(stranger), fixture.teamWorkspaceId)).rejects.toBeInstanceOf(
        WorkspaceNotFoundError,
      );
      await expect(policy.requireWorkspaceRead(callerFor(stranger), uuidv7())).rejects.toBeInstanceOf(WorkspaceNotFoundError);
      await expect(
        policy.requireWorkspaceRead(callerFor(groupOnly, [fixture.viewerGroupId]), fixture.groupWorkspaceId),
      ).resolves.toBeUndefined();
    });
    expect(() => requireWorkspaceRead(new Set<WorkspaceCapability>())).toThrow(WorkspaceNotFoundError);
    expect(() => requireWorkspaceRead(new Set<WorkspaceCapability>(["workspace.discover", "source.discover", "document.discover"]))).toThrow(
      WorkspaceAccessDeniedError,
    );
  });

  it("lists personal, direct, and group-granted workspaces", async () => {
    const fixture = await setupFixture();
    const uow = new MariaDbUnitOfWork(pool);
    const service = new WorkspaceQueryService(uow);
    const ownerIds = (await service.listWorkspaces(callerFor(owner))).map((workspace) => workspace.id);
    expect(ownerIds).toEqual(expect.arrayContaining([fixture.teamWorkspaceId, fixture.personalWorkspaceId]));
    const groupIds = (await service.listWorkspaces(callerFor(groupOnly, [fixture.viewerGroupId]))).map(
      (workspace) => workspace.id,
    );
    expect(groupIds).toContain(fixture.groupWorkspaceId);
    expect(groupIds).not.toContain(fixture.teamWorkspaceId);
    expect(await service.listWorkspaces(callerFor(stranger))).toEqual([]);
  });

  it("reports other-user group-effective access as unknown, never fabricated", () => {
    expect(describeOtherUserAccess("OWNER")).toEqual({ directRole: "OWNER", groupEffectiveAccess: OTHER_USER_GROUP_ACCESS_UNKNOWN });
    expect(describeOtherUserAccess(null)).toEqual({ directRole: null, groupEffectiveAccess: OTHER_USER_GROUP_ACCESS_UNKNOWN });
    expect(OTHER_USER_GROUP_ACCESS_UNKNOWN).toBe("UNKNOWN_NOT_EVALUATED");
  });
});
