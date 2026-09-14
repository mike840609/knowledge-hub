import type { CallerContext } from "@/modules/identity/domain/caller-context";
import { uuidv7 } from "@/shared/ids/uuidv7";
import { assertGovernanceAuthority } from "../domain/workspace-admin-policy";
import type { WorkspaceAuditEvent } from "../domain/workspace-audit-event";
import type { WorkspaceGroupRole } from "../domain/workspace-group-mapping";
import { createDirectMembership } from "../domain/workspace-membership";
import type { WorkspaceRole } from "../domain/workspace-membership";
import {
  PersonalWorkspaceFrozenError,
  WorkspaceAccessDeniedError,
  WorkspaceLifecycleError,
  WorkspaceNotFoundError,
} from "../domain/errors";
import { assertTeamMutationAllowed } from "./team-workspace-service";
import type { WorkspaceRepositories, WorkspaceUnitOfWork } from "../ports/unit-of-work";

export const TEAM_MEMBER_ADDED_EVENT = "MEMBER_ADDED";
export const TEAM_MEMBER_ROLE_CHANGED_EVENT = "ROLE_CHANGED";
export const TEAM_MEMBER_REMOVED_EVENT = "REMOVED";
export const TEAM_GROUP_MAPPING_ADDED_EVENT = "GROUP_MAPPING_ADDED";
export const TEAM_GROUP_MAPPING_ROLE_CHANGED_EVENT = "GROUP_MAPPING_ROLE_CHANGED";
export const TEAM_GROUP_MAPPING_REMOVED_EVENT = "GROUP_MAPPING_REMOVED";

export type DirectMemberInput = {
  userId: string;
  role: string;
};

export type GroupMappingInput = {
  externalGroupId: string;
  role: string;
};

function requireDirectGovernanceRole(role: string, operation: string): WorkspaceRole {
  if (role === "OWNER" || role === "ADMIN" || role === "EDITOR" || role === "VIEWER") return role;
  throw new WorkspaceLifecycleError(`Team workspace ${operation} requires an OWNER, ADMIN, EDITOR, or VIEWER role.`);
}

function requireGroupGovernanceRole(role: string): WorkspaceGroupRole {
  if (role === "ADMIN" || role === "EDITOR" || role === "VIEWER") return role;
  throw new WorkspaceLifecycleError("SSO group mappings can never grant OWNER on a Team workspace.");
}

function requireTargetUserId(userId: string, operation: string): string {
  if (userId.length === 0) {
    throw new WorkspaceLifecycleError(`Team workspace ${operation} requires a non-empty Hub user id.`);
  }
  return userId;
}

function requireExternalGroupId(externalGroupId: string, operation: string): string {
  if (externalGroupId.length === 0) {
    throw new WorkspaceLifecycleError(`Team workspace ${operation} requires a non-empty external group id.`);
  }
  return externalGroupId;
}

async function requireGovernanceActor(
  repositories: WorkspaceRepositories,
  workspaceId: string,
  caller: CallerContext,
  operation: string,
): Promise<WorkspaceRole> {
  const actor = await repositories.workspaceMemberships.find(workspaceId, caller.identity.id);
  const actorRole = actor?.role ?? null;
  if (actorRole !== "OWNER" && actorRole !== "ADMIN") {
    throw new WorkspaceAccessDeniedError(`Team workspace ${operation} requires a direct OWNER or ADMIN grant.`);
  }
  return actorRole;
}

function projectDirectOwners(
  current: number,
  beforeRole: WorkspaceRole | null | undefined,
  afterRole: WorkspaceRole | null | undefined,
): number {
  return current - (beforeRole === "OWNER" ? 1 : 0) + (afterRole === "OWNER" ? 1 : 0);
}

function requireDirectOwnerSurvives(projected: number, operation: string): void {
  if (projected < 1) {
    throw new WorkspaceAccessDeniedError(
      `Team workspace ${operation} would leave the workspace without a direct OWNER grant.`,
    );
  }
}

export class TeamGovernanceService {
  constructor(private readonly unitOfWork: WorkspaceUnitOfWork) {}

  async addDirectMember(caller: CallerContext, workspaceId: string, input: DirectMemberInput): Promise<void> {
    const operation = "add-member";
    const userId = requireTargetUserId(input.userId, operation);
    const afterRole = requireDirectGovernanceRole(input.role, operation);
    const now = new Date();
    await this.unitOfWork.run(async (repositories) => {
      const locked = await repositories.workspaces.lockById(workspaceId);
      if (!locked) throw new WorkspaceNotFoundError();
      const actorRole = await requireGovernanceActor(repositories, workspaceId, caller, operation);
      assertTeamMutationAllowed(locked, operation);
      const existing = await repositories.workspaceMemberships.find(workspaceId, userId);
      if (existing) {
        throw new WorkspaceLifecycleError("Team workspace add-member requires a user without a direct membership.");
      }
      const target = await repositories.users.findById(userId);
      if (!target) {
        throw new WorkspaceLifecycleError("Team workspace add-member requires an existing Hub user.");
      }
      assertGovernanceAuthority({ actorRole, target: "direct", beforeRole: undefined, afterRole, operation });
      requireDirectOwnerSurvives(
        projectDirectOwners(await repositories.workspaceMemberships.countDirectOwners(workspaceId), undefined, afterRole),
        operation,
      );
      await repositories.workspaceMemberships.insert(createDirectMembership({ workspaceId, userId, role: afterRole, now }));
      await repositories.auditEvents.append({
        id: uuidv7(),
        workspaceId,
        actorUserId: caller.identity.id,
        actorKind: "USER",
        eventType: TEAM_MEMBER_ADDED_EVENT,
        targetType: "USER",
        targetId: userId,
        payload: { role: afterRole },
        correlationId: null,
        createdAt: now,
      });
    });
  }

  async changeDirectMemberRole(caller: CallerContext, workspaceId: string, input: DirectMemberInput): Promise<void> {
    const operation = "change-member";
    const userId = requireTargetUserId(input.userId, operation);
    const afterRole = requireDirectGovernanceRole(input.role, operation);
    const now = new Date();
    await this.unitOfWork.run(async (repositories) => {
      const locked = await repositories.workspaces.lockById(workspaceId);
      if (!locked) throw new WorkspaceNotFoundError();
      const actorRole = await requireGovernanceActor(repositories, workspaceId, caller, operation);
      assertTeamMutationAllowed(locked, operation);
      const before = await repositories.workspaceMemberships.find(workspaceId, userId);
      if (!before) {
        throw new WorkspaceLifecycleError("Team workspace change-member requires an existing direct membership.");
      }
      const beforeRole = before.role ?? null;
      assertGovernanceAuthority({ actorRole, target: "direct", beforeRole, afterRole, operation });
      requireDirectOwnerSurvives(
        projectDirectOwners(await repositories.workspaceMemberships.countDirectOwners(workspaceId), beforeRole, afterRole),
        operation,
      );
      await repositories.workspaceMemberships.updateRole(workspaceId, userId, afterRole);
      await repositories.auditEvents.append({
        id: uuidv7(),
        workspaceId,
        actorUserId: caller.identity.id,
        actorKind: "USER",
        eventType: TEAM_MEMBER_ROLE_CHANGED_EVENT,
        targetType: "USER",
        targetId: userId,
        payload: { beforeRole, afterRole },
        correlationId: null,
        createdAt: now,
      });
    });
  }

  async removeDirectMember(caller: CallerContext, workspaceId: string, userId: string): Promise<void> {
    const operation = "remove-member";
    const targetUserId = requireTargetUserId(userId, operation);
    const now = new Date();
    await this.unitOfWork.run(async (repositories) => {
      const locked = await repositories.workspaces.lockById(workspaceId);
      if (!locked) throw new WorkspaceNotFoundError();
      const actorRole = await requireGovernanceActor(repositories, workspaceId, caller, operation);
      assertTeamMutationAllowed(locked, operation);
      const before = await repositories.workspaceMemberships.find(workspaceId, targetUserId);
      if (!before) {
        throw new WorkspaceLifecycleError("Team workspace remove-member requires an existing direct membership.");
      }
      const beforeRole = before.role ?? null;
      assertGovernanceAuthority({ actorRole, target: "direct", beforeRole, afterRole: undefined, operation });
      requireDirectOwnerSurvives(
        projectDirectOwners(await repositories.workspaceMemberships.countDirectOwners(workspaceId), beforeRole, undefined),
        operation,
      );
      await repositories.workspaceMemberships.remove(workspaceId, targetUserId);
      await repositories.auditEvents.append({
        id: uuidv7(),
        workspaceId,
        actorUserId: caller.identity.id,
        actorKind: "USER",
        eventType: TEAM_MEMBER_REMOVED_EVENT,
        targetType: "USER",
        targetId: targetUserId,
        payload: { beforeRole },
        correlationId: null,
        createdAt: now,
      });
    });
  }

  async addGroupMapping(caller: CallerContext, workspaceId: string, input: GroupMappingInput): Promise<void> {
    const operation = "add-group-mapping";
    const externalGroupId = requireExternalGroupId(input.externalGroupId, operation);
    const afterRole = requireGroupGovernanceRole(input.role);
    const now = new Date();
    await this.unitOfWork.run(async (repositories) => {
      const locked = await repositories.workspaces.lockById(workspaceId);
      if (!locked) throw new WorkspaceNotFoundError();
      const actorRole = await requireGovernanceActor(repositories, workspaceId, caller, operation);
      assertTeamMutationAllowed(locked, operation);
      const existing = await repositories.groupMappings.findExact(workspaceId, externalGroupId);
      if (existing) {
        throw new WorkspaceLifecycleError("Team workspace add-group-mapping requires an unmapped external group.");
      }
      assertGovernanceAuthority({ actorRole, target: "group", beforeRole: undefined, afterRole, operation });
      requireDirectOwnerSurvives(await repositories.workspaceMemberships.countDirectOwners(workspaceId), operation);
      const mappingId = uuidv7();
      await repositories.groupMappings.insert({
        id: mappingId,
        workspaceId,
        externalGroupId,
        role: afterRole,
        createdBy: caller.identity.id,
        createdAt: now,
        updatedAt: now,
      });
      await repositories.auditEvents.append({
        id: uuidv7(),
        workspaceId,
        actorUserId: caller.identity.id,
        actorKind: "USER",
        eventType: TEAM_GROUP_MAPPING_ADDED_EVENT,
        targetType: "GROUP_MAPPING",
        targetId: mappingId,
        payload: { externalGroupId, role: afterRole },
        correlationId: null,
        createdAt: now,
      });
    });
  }

  async changeGroupMappingRole(caller: CallerContext, workspaceId: string, input: GroupMappingInput): Promise<void> {
    const operation = "change-group-mapping";
    const externalGroupId = requireExternalGroupId(input.externalGroupId, operation);
    const afterRole = requireGroupGovernanceRole(input.role);
    const now = new Date();
    await this.unitOfWork.run(async (repositories) => {
      const locked = await repositories.workspaces.lockById(workspaceId);
      if (!locked) throw new WorkspaceNotFoundError();
      const actorRole = await requireGovernanceActor(repositories, workspaceId, caller, operation);
      assertTeamMutationAllowed(locked, operation);
      const before = await repositories.groupMappings.findExact(workspaceId, externalGroupId);
      if (!before) {
        throw new WorkspaceLifecycleError("Team workspace change-group-mapping requires an existing group mapping.");
      }
      assertGovernanceAuthority({ actorRole, target: "group", beforeRole: before.role, afterRole, operation });
      requireDirectOwnerSurvives(await repositories.workspaceMemberships.countDirectOwners(workspaceId), operation);
      await repositories.groupMappings.updateRole(before.id, afterRole);
      await repositories.auditEvents.append({
        id: uuidv7(),
        workspaceId,
        actorUserId: caller.identity.id,
        actorKind: "USER",
        eventType: TEAM_GROUP_MAPPING_ROLE_CHANGED_EVENT,
        targetType: "GROUP_MAPPING",
        targetId: before.id,
        payload: { externalGroupId, beforeRole: before.role, afterRole },
        correlationId: null,
        createdAt: now,
      });
    });
  }

  async removeGroupMapping(caller: CallerContext, workspaceId: string, externalGroupId: string): Promise<void> {
    const operation = "remove-group-mapping";
    const targetGroupId = requireExternalGroupId(externalGroupId, operation);
    const now = new Date();
    await this.unitOfWork.run(async (repositories) => {
      const locked = await repositories.workspaces.lockById(workspaceId);
      if (!locked) throw new WorkspaceNotFoundError();
      const actorRole = await requireGovernanceActor(repositories, workspaceId, caller, operation);
      assertTeamMutationAllowed(locked, operation);
      const before = await repositories.groupMappings.findExact(workspaceId, targetGroupId);
      if (!before) {
        throw new WorkspaceLifecycleError("Team workspace remove-group-mapping requires an existing group mapping.");
      }
      assertGovernanceAuthority({ actorRole, target: "group", beforeRole: before.role, afterRole: undefined, operation });
      requireDirectOwnerSurvives(await repositories.workspaceMemberships.countDirectOwners(workspaceId), operation);
      await repositories.groupMappings.remove(before.id);
      await repositories.auditEvents.append({
        id: uuidv7(),
        workspaceId,
        actorUserId: caller.identity.id,
        actorKind: "USER",
        eventType: TEAM_GROUP_MAPPING_REMOVED_EVENT,
        targetType: "GROUP_MAPPING",
        targetId: before.id,
        payload: { externalGroupId: targetGroupId, beforeRole: before.role },
        correlationId: null,
        createdAt: now,
      });
    });
  }

  async listGovernanceAudit(caller: CallerContext, workspaceId: string): Promise<WorkspaceAuditEvent[]> {
    return this.unitOfWork.run(async (repositories) => {
      const workspace = await repositories.workspaces.findById(workspaceId);
      if (!workspace) throw new WorkspaceNotFoundError();
      if (workspace.workspaceType === "PERSONAL" || workspace.personalOwnerUserId != null) {
        throw new PersonalWorkspaceFrozenError("audit-read");
      }
      await requireGovernanceActor(repositories, workspaceId, caller, "audit-read");
      return repositories.auditEvents.listByWorkspace(workspaceId);
    });
  }
}
