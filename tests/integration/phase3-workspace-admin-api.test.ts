import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { runMigrations, type IsolatedDatabaseHandle } from "../../scripts/db/migrate";
import { disposeIsolatedDatabase, provisionIsolatedDatabase } from "../../scripts/db/test-database";
import type { CallerContext } from "@/modules/identity/domain/caller-context";
import type { WorkspaceRole } from "@/modules/workspaces/domain/workspace-membership";
import { TeamWorkspaceService } from "@/modules/workspaces/application/team-workspace-service";
import { TeamGovernanceService } from "@/modules/workspaces/application/team-governance-service";
import { PersonalWorkspaceService } from "@/modules/workspaces/application/personal-workspace-service";
import { WorkspaceAdminService } from "@/server/workspace-admin";
import { uuidv7 } from "@/shared/ids/uuidv7";

const injected = vi.hoisted(() => ({ services: null as unknown }));
vi.mock("@/server/composition", () => ({ applicationServices: () => injected.services }));
import { POST as create } from "@/app/api/workspaces/route";
import { GET as state, PATCH as rename } from "@/app/api/workspaces/[workspaceId]/route";
import { POST as archive } from "@/app/api/workspaces/[workspaceId]/archive/route";
import { POST as add } from "@/app/api/workspaces/[workspaceId]/members/route";
import { DELETE as remove } from "@/app/api/workspaces/[workspaceId]/members/[userId]/route";
let handle: IsolatedDatabaseHandle;
let pool: Pool;
let admin: WorkspaceAdminService;
let teams: TeamWorkspaceService;
let governance: TeamGovernanceService;
let owner: CallerContext;
let current: CallerContext;
let workspaceId: string;
let uow: MariaDbUnitOfWork;
async function user(name: string, groups: string[] = []): Promise<CallerContext> {
  const identity = { id: uuidv7(), emp_id: uuidv7(), name, org_code: "TEST" };
  await uow.run(r => r.users.insert(identity));
  return { identity, validatedExternalGroupIds: groups, platformCapabilities: [] };
}
const context = (userId?: string) => ({ params: Promise.resolve({ workspaceId, userId }) });
const request = (body: unknown) => new Request("http://localhost/api/workspaces", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
beforeEach(async () => {
  handle = await provisionIsolatedDatabase("test");
  const previous = process.env.KM_TEST_DB_NAME;
  process.env.KM_TEST_DB_NAME = handle.databaseName;
  try { pool = createDatabasePool(databaseConfig("test")); } finally { if (previous === undefined) delete process.env.KM_TEST_DB_NAME; else process.env.KM_TEST_DB_NAME = previous; }
  await runMigrations(pool);
  uow = new MariaDbUnitOfWork(pool);
  admin = new WorkspaceAdminService(uow); teams = new TeamWorkspaceService(uow); governance = new TeamGovernanceService(uow);
  owner = await user("Owner"); owner.platformCapabilities = ["workspace.create_team"];
  await new PersonalWorkspaceService(uow).ensurePersonalWorkspace(owner.identity.id);
  workspaceId = (await teams.createTeamWorkspace(owner, { name: "Alpha" })).id;
  current = owner;
  injected.services = { workspaceAdmin: admin, teams, governance, establishTrustedCaller: async () => ({ caller: current }) };
});
afterEach(async () => { await pool?.end(); if (handle) await disposeIsolatedDatabase(handle); });

describe("Phase 3 workspace product contracts and real route adapters", () => {
  it("orders caller Personal, active same-name teams by id, then archived teams", async () => {
    const second = await teams.createTeamWorkspace(owner, { name: "Alpha" });
    const legacy = await teams.createTeamWorkspace(owner, { name: "Legacy" }); await teams.archiveTeamWorkspace(owner, legacy.id);
    const nav = await admin.navigation(owner);
    expect(nav.canCreateTeam).toBe(true);
    expect(nav.items.map(i => [i.type, i.lifecycleState])).toEqual([["PERSONAL", "ACTIVE"], ["TEAM", "ACTIVE"], ["TEAM", "ACTIVE"], ["TEAM", "ARCHIVED"]]);
    expect(nav.items.slice(1, 3).map(i => i.id)).toEqual([workspaceId, second.id].sort());
    const personal = await admin.workspaceState(owner, nav.items[0]!.id);
    expect(personal.actions).toMatchObject({ canImport: true, canOpenSettings: false, canArchive: false, canManageOwners: false });
  });
  it.each(["VIEWER", "EDITOR", "ADMIN", "OWNER"] as WorkspaceRole[])("enforces %s active/archived UI capability matrix", async role => {
    const caller = await user(role); await governance.addDirectMember(owner, workspaceId, { userId: caller.identity.id, role });
    const active = await admin.workspaceState(caller, workspaceId);
    expect(active.effectiveCapabilities).toContain("document.read");
    expect(active.actions).toMatchObject({ canImport: role !== "VIEWER", canOpenSettings: role === "OWNER" || role === "ADMIN", canArchive: role === "OWNER", canReadAudit: role === "OWNER" || role === "ADMIN" });
    await teams.archiveTeamWorkspace(owner, workspaceId);
    expect((await admin.workspaceState(caller, workspaceId)).actions).toMatchObject({ canImport: false, canRename: false, canManageBasicMembers: false, canManageBasicGroups: false, canRestore: role === "OWNER", canOpenSettings: role === "OWNER" || role === "ADMIN" });
  });
  it("derives creation options without rows and preserves unknown other-user group truth", async () => {
    const caller = await user("Group Admin", ["admins"]);
    await governance.addGroupMapping(owner, workspaceId, { externalGroupId: "admins", role: "ADMIN" });
    await governance.addDirectMember(owner, workspaceId, { userId: caller.identity.id, role: "VIEWER" });
    expect((await admin.teamView(caller, workspaceId)).grantOptions).toEqual({ newMemberAssignableRoles: ["EDITOR", "VIEWER"], newGroupAssignableRoles: ["EDITOR", "VIEWER"] });
    const members = await admin.listMembers(caller, workspaceId);
    expect(members.find(row => row.user.id === owner.identity.id)).toMatchObject({ access: { groupAccess: "UNKNOWN_NOT_EVALUATED" }, assignableRoles: [], canRemoveDirectAccess: false });
    expect(members.find(row => row.user.id === caller.identity.id)?.access).toMatchObject({ groupAccess: "EVALUATED", matchedGroups: [{ externalGroupId: "admins", role: "ADMIN" }] });
    expect((await admin.teamView(owner, workspaceId)).grantOptions.newMemberAssignableRoles).toEqual(["OWNER", "ADMIN", "EDITOR", "VIEWER"]);
    expect((await admin.listMembers(owner, workspaceId)).find(row => row.user.id === owner.identity.id)).toMatchObject({ assignableRoles: ["OWNER"], canRemoveDirectAccess: false });
    const empty = await teams.createTeamWorkspace(owner, { name: "Empty" });
    expect(await admin.listGroups(owner, empty.id)).toEqual([]);
    expect((await admin.teamView(owner, empty.id)).grantOptions.newGroupAssignableRoles).toEqual(["ADMIN", "EDITOR", "VIEWER"]);
    const lookup = await admin.searchUsers(owner, "Group Admin", 1000);
    expect(lookup).toEqual([{ id: caller.identity.id, name: "Group Admin", empId: caller.identity.emp_id }]);
  });
  it.each([false, true])("revocation retains exactly current group access: %s", async remaining => {
    const caller = await user("Affected", remaining ? ["readers"] : []);
    await governance.addDirectMember(owner, workspaceId, { userId: caller.identity.id, role: "EDITOR" });
    await governance.addGroupMapping(owner, workspaceId, { externalGroupId: "readers", role: "VIEWER" });
    expect((await admin.workspaceState(caller, workspaceId)).actions.canImport).toBe(true);
    await governance.removeDirectMember(owner, workspaceId, caller.identity.id); current = caller;
    const response = await state(request({}), context()); expect(response.status).toBe(remaining ? 200 : 404);
    if (remaining) expect((await response.json()).actions).toMatchObject({ canImport: false, canOpenSettings: false });
    else expect(await response.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
  });
  it.each([
    [null, null, false, false, false], ["VIEWER", null, true, false, false],
    ["EDITOR", null, true, true, false], [null, "VIEWER", true, false, false],
    ["VIEWER", "EDITOR", true, true, false], ["EDITOR", "VIEWER", true, true, false],
    ["ADMIN", "EDITOR", true, true, true], ["VIEWER", "ADMIN", true, true, true],
    ["OWNER", "ADMIN", true, true, true],
  ] as const)("unions direct %s and group %s without precedence", async (direct, group, discover, write, settings) => {
    const caller = await user("Union", group ? ["union"] : []);
    if (direct) await governance.addDirectMember(owner, workspaceId, { userId: caller.identity.id, role: direct });
    if (group) await governance.addGroupMapping(owner, workspaceId, { externalGroupId: "union", role: group });
    if (!discover) { await expect(admin.workspaceState(caller, workspaceId)).rejects.toMatchObject({ code: "WORKSPACE_NOT_FOUND" }); return; }
    expect((await admin.workspaceState(caller, workspaceId)).actions).toMatchObject({ canImport: write, canOpenSettings: settings });
  });
  it("paginates audit with stable cursor and no duplicates", async () => {
    for (let index = 0; index < 51; index++) await teams.renameTeamWorkspace(owner, workspaceId, `Page ${index}`);
    const first = await admin.listAudit(owner, workspaceId);
    expect(first.items).toHaveLength(50);
    const second = await admin.listAudit(owner, workspaceId, first.nextCursor!);
    expect(second.items).toHaveLength(2); expect(second.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map(item => item.id)).size).toBe(52);
  });
  it("maps denied creation and invalid names without partial writes", async () => {
    current = await user("No create");
    const denied = await create(request({ name: "Denied" })); expect(denied.status).toBe(403); expect(await denied.json()).toMatchObject({ error: { code: "TEAM_CREATION_DENIED" } });
    current = owner;
    const counts = async () => Promise.all(["workspaces", "workspace_memberships", "workspace_audit_events"].map(async table => Number((await pool.query(`SELECT COUNT(*) AS n FROM ${table}`))[0].n)));
    const before = await counts();
    for (const name of ["   ", "x".repeat(201)]) {
      const response = await create(request({ name })); expect(response.status).toBe(400); expect(await response.json()).toMatchObject({ error: { code: "INVALID_WORKSPACE_NAME", field: "name" } });
      const update = await rename(request({ name }), context()); expect(update.status).toBe(400);
    }
    expect(await counts()).toEqual(before);
  });
  it("direct APIs enforce ceilings, last owner and archived write denial", async () => {
    const basic = await user("Admin"); await governance.addDirectMember(owner, workspaceId, { userId: basic.identity.id, role: "ADMIN" });
    current = basic;
    const denied = await archive(request({}), context()); expect(denied.status).toBe(403); expect(await denied.json()).toMatchObject({ error: { code: "INSUFFICIENT_WORKSPACE_CAPABILITY" } });
    current = owner;
    const last = await remove(request({}), context(owner.identity.id)); expect(last.status).toBe(409); expect(await last.json()).toMatchObject({ error: { code: "LAST_DIRECT_OWNER" } });
    await teams.archiveTeamWorkspace(owner, workspaceId);
    const result = await add(request({ userId: basic.identity.id, role: "VIEWER" }), context()); expect(result.status).toBe(409); expect(await result.json()).toMatchObject({ error: { code: "WORKSPACE_ARCHIVED" } });
    const renameResult = await rename(request({ name: "Closed" }), context()); expect(renameResult.status).toBe(409);
    const outsider = await user("Outsider"); current = outsider;
    const hidden = await archive(request({}), context()); expect(hidden.status).toBe(404); expect(await hidden.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
  });
  it("rejects employee-id input and exposes newest-first audit only to admins", async () => {
    const invalid = await add(request({ emp_id: "x", role: "VIEWER" }), context()); expect(invalid.status).toBe(400);
    await teams.renameTeamWorkspace(owner, workspaceId, "Renamed");
    const audit = await admin.listAudit(owner, workspaceId);
    expect(audit.items[0]).toMatchObject({ eventType: "TEAM_WORKSPACE_RENAMED", actorName: "Owner", before: { previousName: "Alpha" }, after: { name: "Renamed" } });
    expect(audit.nextCursor).toBeNull();
  });
});
