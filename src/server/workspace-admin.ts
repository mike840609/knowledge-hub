import type { CallerContext } from "@/modules/identity/domain/caller-context";
import type { Workspace } from "@/modules/workspaces/domain/workspace";
import type { WorkspaceRole } from "@/modules/workspaces/domain/workspace-membership";
import type { WorkspaceCapability } from "@/modules/workspaces/domain/workspace-capability";
import type { WorkspaceRepositories, WorkspaceUnitOfWork } from "@/modules/workspaces/ports/unit-of-work";
import { WorkspaceQueryService } from "@/modules/workspaces/application/workspace-query-service";
import { evaluateWorkspaceCapabilities } from "@/modules/workspaces/application/workspace-authorization";
import { InsufficientWorkspaceCapabilityError, WorkspaceNotFoundError } from "@/modules/workspaces/domain/errors";

export type WorkspaceActions = {
  canImport: boolean; canInspectSources: boolean; canOpenSettings: boolean; canRename: boolean;
  canArchive: boolean; canRestore: boolean; canManageBasicMembers: boolean; canManageAdminMembers: boolean;
  canManageOwners: boolean; canManageBasicGroups: boolean; canManageAdminGroups: boolean; canReadAudit: boolean;
  /** Phase 4: keyword search needs read, not manage; archived Teams stay searchable. */
  canSearch: boolean;
};
export type WorkspaceNavigationItem = { id: string; name: string; type: "PERSONAL" | "TEAM"; lifecycleState: "ACTIVE" | "ARCHIVED" };
export type WorkspaceNavigationModel = { canCreateTeam: boolean; items: readonly WorkspaceNavigationItem[] };
export type UserAccessInspection = {
  userId: string; directRole: WorkspaceRole | null; groupAccess: "EVALUATED" | "UNKNOWN_NOT_EVALUATED";
  matchedGroups?: readonly { externalGroupId: string; role: WorkspaceRole }[];
  effectiveCapabilities?: readonly WorkspaceCapability[];
};
export type WorkspaceGrantOptions = {
  newMemberAssignableRoles: readonly WorkspaceRole[];
  newGroupAssignableRoles: readonly ("ADMIN" | "EDITOR" | "VIEWER")[];
};
export type TeamWorkspaceView = {
  id: string; name: string; lifecycleState: "ACTIVE" | "ARCHIVED";
  caller: { directRole: WorkspaceRole | null; effectiveCapabilities: readonly WorkspaceCapability[] };
  actions: WorkspaceActions; grantOptions: WorkspaceGrantOptions;
};
export type WorkspaceAccessView = { workspace: WorkspaceNavigationItem; effectiveCapabilities: readonly WorkspaceCapability[]; actions: WorkspaceActions };
export type HubUserLookup = { id: string; name: string; empId: string };
export type MemberAdminView = { user: HubUserLookup; access: UserAccessInspection; assignableRoles: readonly WorkspaceRole[]; canRemoveDirectAccess: boolean };
export type GroupAdminView = { externalGroupId: string; role: "ADMIN" | "EDITOR" | "VIEWER"; assignableRoles: readonly ("ADMIN" | "EDITOR" | "VIEWER")[]; canRemove: boolean };
export type AuditItem = { id: string; actorName: string | null; eventType: string; targetType: string; targetId: string | null; summary: string; createdAt: string; before?: Readonly<Record<string, unknown>>; after?: Readonly<Record<string, unknown>> };
export type AuditPage = { items: readonly AuditItem[]; nextCursor: string | null };

export function deriveWorkspaceActions(workspace: Workspace, capabilities: ReadonlySet<WorkspaceCapability>): WorkspaceActions {
  const active = workspace.lifecycleState !== "ARCHIVED";
  const team = workspace.workspaceType === "TEAM";
  const has = (capability: WorkspaceCapability) => capabilities.has(capability);
  return {
    canInspectSources: has("source.manage"), canImport: active && has("source.manage"),
    canSearch: has("document.read"),
    canOpenSettings: team && has("membership.manage_basic"),
    canRename: team && active && has("workspace.rename"), canArchive: team && active && has("workspace.archive"),
    canRestore: team && !active && has("workspace.restore"),
    canManageBasicMembers: team && active && has("membership.manage_basic"),
    canManageAdminMembers: team && active && has("membership.manage_admin"), canManageOwners: team && active && has("membership.manage_owner"),
    canManageBasicGroups: team && active && has("membership.manage_basic"), canManageAdminGroups: team && active && has("membership.manage_admin"),
    canReadAudit: team && has("audit.read"),
  };
}
function navigationItem(workspace: Workspace): WorkspaceNavigationItem {
  return { id: workspace.id, name: workspace.name, type: workspace.workspaceType ?? "TEAM", lifecycleState: workspace.lifecycleState ?? "ACTIVE" };
}
function grantOptions(actions: WorkspaceActions): WorkspaceGrantOptions {
  return { newMemberAssignableRoles: actions.canManageOwners ? ["OWNER", "ADMIN", "EDITOR", "VIEWER"] : actions.canManageBasicMembers ? ["EDITOR", "VIEWER"] : [], newGroupAssignableRoles: actions.canManageAdminGroups ? ["ADMIN", "EDITOR", "VIEWER"] : actions.canManageBasicGroups ? ["EDITOR", "VIEWER"] : [] };
}
async function readState(repositories: WorkspaceRepositories, caller: CallerContext, workspaceId: string, admin = false) {
  const capabilities = await evaluateWorkspaceCapabilities(repositories, caller, workspaceId);
  if (!capabilities.has("workspace.discover")) throw new WorkspaceNotFoundError();
  const workspace = await repositories.workspaces.findById(workspaceId);
  if (!workspace) throw new WorkspaceNotFoundError();
  const actions = deriveWorkspaceActions(workspace, capabilities);
  if (admin && !actions.canOpenSettings) throw new InsufficientWorkspaceCapabilityError();
  return { workspace, capabilities, actions };
}
export class WorkspaceAdminService {
  constructor(private readonly unitOfWork: WorkspaceUnitOfWork) {}
  async navigation(caller: CallerContext): Promise<WorkspaceNavigationModel> {
    return { canCreateTeam: caller.platformCapabilities.includes("workspace.create_team"), items: await new WorkspaceQueryService(this.unitOfWork).listWorkspaces(caller) };
  }
  async workspaceState(caller: CallerContext, workspaceId: string): Promise<WorkspaceAccessView> {
    return this.unitOfWork.run(async repositories => {
      const { workspace, capabilities, actions } = await readState(repositories, caller, workspaceId);
      return { workspace: navigationItem(workspace), effectiveCapabilities: [...capabilities], actions };
    });
  }
  async teamView(caller: CallerContext, workspaceId: string): Promise<TeamWorkspaceView> {
    return this.unitOfWork.run(async repositories => {
      const { workspace, capabilities, actions } = await readState(repositories, caller, workspaceId, true);
      const membership = await repositories.workspaceMemberships.find(workspaceId, caller.identity.id);
      return { id: workspace.id, name: workspace.name, lifecycleState: workspace.lifecycleState ?? "ACTIVE", caller: { directRole: membership?.role ?? null, effectiveCapabilities: [...capabilities] }, actions, grantOptions: grantOptions(actions) };
    });
  }
  async searchUsers(caller: CallerContext, query: string, limit: number): Promise<HubUserLookup[]> {
    // User lookup is an authenticated existing-Hub directory, never an identity resolver.
    if (!caller.identity.id) throw new InsufficientWorkspaceCapabilityError();
    const normalized = query.trim();
    if (!normalized) return [];
    return this.unitOfWork.run(async repositories => (await repositories.users.searchExisting(normalized.slice(0, 200), limit)).map(user => ({ id: user.id, name: user.name, empId: user.emp_id })));
  }
  async listMembers(caller: CallerContext, workspaceId: string): Promise<MemberAdminView[]> {
    return this.unitOfWork.run(async repositories => {
      const { capabilities, actions } = await readState(repositories, caller, workspaceId, true);
      const options = grantOptions(actions).newMemberAssignableRoles;
      const owners = await repositories.workspaceMemberships.countDirectOwners(workspaceId);
      const mappings = await repositories.groupMappings.listByWorkspace(workspaceId);
      const result: MemberAdminView[] = [];
      for (const member of await repositories.workspaceMemberships.listByWorkspace(workspaceId)) {
        const user = await repositories.users.findById(member.userId);
        if (!user) continue;
        const self = user.id === caller.identity.id;
        const protectedRole = !actions.canManageOwners && (member.role === "OWNER" || member.role === "ADMIN");
        const lastOwner = member.role === "OWNER" && owners <= 1;
        result.push({ user: { id: user.id, name: user.name, empId: user.emp_id }, access: {
          userId: user.id, directRole: member.role ?? null, groupAccess: self ? "EVALUATED" : "UNKNOWN_NOT_EVALUATED",
          ...(self ? { matchedGroups: mappings.filter(mapping => caller.validatedExternalGroupIds.includes(mapping.externalGroupId)).map(({ externalGroupId, role }) => ({ externalGroupId, role })), effectiveCapabilities: [...capabilities] } : {}),
        }, assignableRoles: protectedRole ? [] : options.filter(role => !lastOwner || role === "OWNER"), canRemoveDirectAccess: options.length > 0 && !protectedRole && !lastOwner });
      }
      return result.sort((a, b) => a.user.name.localeCompare(b.user.name) || a.user.id.localeCompare(b.user.id));
    });
  }
  async listGroups(caller: CallerContext, workspaceId: string): Promise<GroupAdminView[]> {
    return this.unitOfWork.run(async repositories => {
      const { actions } = await readState(repositories, caller, workspaceId, true);
      const options = grantOptions(actions).newGroupAssignableRoles;
      return (await repositories.groupMappings.listByWorkspace(workspaceId)).map(mapping => {
        const roles = mapping.role === "ADMIN" && !actions.canManageAdminGroups ? [] : options;
        return { externalGroupId: mapping.externalGroupId, role: mapping.role, assignableRoles: roles, canRemove: roles.length > 0 };
      });
    });
  }
  async listAudit(caller: CallerContext, workspaceId: string, cursor?: string): Promise<AuditPage> {
    return this.unitOfWork.run(async repositories => {
      const { actions } = await readState(repositories, caller, workspaceId, true);
      if (!actions.canReadAudit) throw new InsufficientWorkspaceCapabilityError();
      const events = await repositories.auditEvents.listPage(workspaceId, cursor, 51);
      const page = events.slice(0, 50);
      const items: AuditItem[] = [];
      for (const event of page) {
        const actor = event.actorUserId ? await repositories.users.findById(event.actorUserId) : null;
        const payload = event.payload && typeof event.payload === "object" ? event.payload as Record<string, unknown> : {};
        const before = Object.fromEntries(Object.entries(payload).filter(([key]) => key.startsWith("before") || key.startsWith("previous")));
        const after = Object.fromEntries(Object.entries(payload).filter(([key]) => !key.startsWith("before") && !key.startsWith("previous")));
        items.push({ id: event.id, actorName: actor?.name ?? null, eventType: event.eventType, targetType: event.targetType ?? "WORKSPACE", targetId: event.targetId, summary: event.eventType.toLowerCase().replaceAll("_", " "), createdAt: event.createdAt.toISOString(), ...(Object.keys(before).length ? { before } : {}), ...(Object.keys(after).length ? { after } : {}) });
      }
      return { items, nextCursor: events.length > 50 ? page.at(-1)!.id : null };
    });
  }
}
