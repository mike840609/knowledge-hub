import type { CallerContext } from "@/modules/identity/domain/caller-context";
import { uuidv7 } from "@/shared/ids/uuidv7";
import type { Workspace } from "../domain/workspace";
import { createTeamWorkspaceInsert } from "../domain/workspace";
import type { WorkspaceGroupRole } from "../domain/workspace-group-mapping";
import { createDirectMembership } from "../domain/workspace-membership";
import type { WorkspaceMembership } from "../domain/workspace-membership";
import {
  TeamCreationDeniedError,
  WorkspaceAccessDeniedError,
  WorkspaceLifecycleError,
  WorkspaceNotFoundError,
} from "../domain/errors";
import { assertPersonalMutationAllowed } from "./personal-workspace-service";
import type { WorkspaceUnitOfWork } from "../ports/unit-of-work";

export const TEAM_WORKSPACE_CREATED_EVENT = "TEAM_WORKSPACE_CREATED";
export const TEAM_WORKSPACE_RENAMED_EVENT = "TEAM_WORKSPACE_RENAMED";
export const TEAM_WORKSPACE_ARCHIVED_EVENT = "TEAM_WORKSPACE_ARCHIVED";
export const TEAM_WORKSPACE_RESTORED_EVENT = "TEAM_WORKSPACE_RESTORED";
export const TEAM_GOVERNANCE_RECOVERED_EVENT = "GOVERNANCE_RECOVERED";

export type TeamGroupMappingInput = {
  externalGroupId: string;
  role: string;
};

export type CreateTeamWorkspaceInput = {
  name: string;
  groupMappings?: readonly TeamGroupMappingInput[];
};

export type TeamMutationOperation =
  | "rename"
  | "content-write"
  | "source-import"
  | "add-member"
  | "add-group-mapping";

export function assertTeamMutationAllowed(workspace: Workspace, operation: TeamMutationOperation): void {
  assertPersonalMutationAllowed(workspace, operation);
  if (workspace.lifecycleState === "ARCHIVED") {
    throw new WorkspaceLifecycleError(
      `Archived workspace blocks ${operation}: restore the Team workspace before mutating it.`,
    );
  }
}

function requireTeamCreateCapability(caller: CallerContext): void {
  if (!caller.platformCapabilities.includes("workspace.create_team")) {
    throw new TeamCreationDeniedError();
  }
}

function requireValidTeamName(name: string, operation: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > 200) {
    throw new WorkspaceLifecycleError(`Team workspace ${operation} requires a non-empty name of at most 200 characters.`);
  }
  return trimmed;
}

export class TeamWorkspaceService {
  constructor(private readonly unitOfWork: WorkspaceUnitOfWork) {}

  async createTeamWorkspace(caller: CallerContext, input: CreateTeamWorkspaceInput): Promise<Workspace> {
    requireTeamCreateCapability(caller);
    const name = requireValidTeamName(input.name, "creation");
    const mappings: { externalGroupId: string; role: WorkspaceGroupRole }[] = [];
    for (const mapping of input.groupMappings ?? []) {
      if (mapping.role !== "ADMIN" && mapping.role !== "EDITOR" && mapping.role !== "VIEWER") {
        throw new WorkspaceLifecycleError("SSO group mappings can never grant OWNER on a Team workspace.");
      }
      if (mapping.externalGroupId.length === 0) {
        throw new WorkspaceLifecycleError("SSO group mappings require a non-empty external group id.");
      }
      mappings.push({ externalGroupId: mapping.externalGroupId, role: mapping.role });
    }
    const now = new Date();
    const workspaceId = uuidv7();
    await this.unitOfWork.run(async (repositories) => {
      await repositories.users.upsertIdentity(caller.identity);
      await repositories.workspaces.insert(
        createTeamWorkspaceInsert({ id: workspaceId, name, createdBy: caller.identity.id, now }),
      );
      await repositories.workspaceMemberships.insert(
        createDirectMembership({ workspaceId, userId: caller.identity.id, role: "OWNER", now }),
      );
      for (const mapping of mappings) {
        await repositories.groupMappings.insert({
          id: uuidv7(),
          workspaceId,
          externalGroupId: mapping.externalGroupId,
          role: mapping.role,
          createdBy: caller.identity.id,
          createdAt: now,
          updatedAt: now,
        });
      }
      await repositories.auditEvents.append({
        id: uuidv7(),
        workspaceId,
        actorUserId: caller.identity.id,
        actorKind: "USER",
        eventType: TEAM_WORKSPACE_CREATED_EVENT,
        targetType: "WORKSPACE",
        targetId: workspaceId,
        payload: { name, groupMappingCount: mappings.length },
        correlationId: null,
        createdAt: now,
      });
    });
    const created = await this.unitOfWork.run((repositories) => repositories.workspaces.findById(workspaceId));
    if (!created) {
      throw new WorkspaceNotFoundError("Team workspace creation committed but the workspace cannot be re-read.");
    }
    return created;
  }

  async renameTeamWorkspace(caller: CallerContext, workspaceId: string, name: string): Promise<Workspace> {
    const trimmed = requireValidTeamName(name, "rename");
    const now = new Date();
    await this.unitOfWork.run(async (repositories) => {
      const locked = await repositories.workspaces.lockById(workspaceId);
      if (!locked) throw new WorkspaceNotFoundError();
      assertTeamMutationAllowed(locked, "rename");
      requireDirectOwner(await repositories.workspaceMemberships.find(workspaceId, caller.identity.id), "rename");
      await repositories.workspaces.renameWorkspace(workspaceId, trimmed, now);
      await repositories.auditEvents.append({
        id: uuidv7(),
        workspaceId,
        actorUserId: caller.identity.id,
        actorKind: "USER",
        eventType: TEAM_WORKSPACE_RENAMED_EVENT,
        targetType: "WORKSPACE",
        targetId: workspaceId,
        payload: { name: trimmed, previousName: locked.name },
        correlationId: null,
        createdAt: now,
      });
    });
    return this.reRead(workspaceId);
  }

  async archiveTeamWorkspace(caller: CallerContext, workspaceId: string): Promise<Workspace> {
    return this.transitionLifecycle(caller, workspaceId, "ARCHIVED", TEAM_WORKSPACE_ARCHIVED_EVENT, "archive");
  }

  async restoreTeamWorkspace(caller: CallerContext, workspaceId: string): Promise<Workspace> {
    return this.transitionLifecycle(caller, workspaceId, "ACTIVE", TEAM_WORKSPACE_RESTORED_EVENT, "restore");
  }

  private async transitionLifecycle(
    caller: CallerContext,
    workspaceId: string,
    target: "ACTIVE" | "ARCHIVED",
    eventType: string,
    operation: "archive" | "restore",
  ): Promise<Workspace> {
    const now = new Date();
    await this.unitOfWork.run(async (repositories) => {
      const locked = await repositories.workspaces.lockById(workspaceId);
      if (!locked) throw new WorkspaceNotFoundError();
      assertPersonalMutationAllowed(locked, operation);
      requireDirectOwner(await repositories.workspaceMemberships.find(workspaceId, caller.identity.id), operation);
      if (target === "ARCHIVED" && locked.lifecycleState !== "ACTIVE") {
        throw new WorkspaceLifecycleError("Only an ACTIVE Team workspace can be archived.");
      }
      if (target === "ACTIVE" && locked.lifecycleState !== "ARCHIVED") {
        throw new WorkspaceLifecycleError("Only an ARCHIVED Team workspace can be restored.");
      }
      await repositories.workspaces.setWorkspaceLifecycle(
        workspaceId,
        target,
        target === "ARCHIVED" ? caller.identity.id : null,
        target === "ARCHIVED" ? now : null,
        now,
      );
      await repositories.auditEvents.append({
        id: uuidv7(),
        workspaceId,
        actorUserId: caller.identity.id,
        actorKind: "USER",
        eventType,
        targetType: "WORKSPACE",
        targetId: workspaceId,
        payload: { lifecycleState: target },
        correlationId: null,
        createdAt: now,
      });
    });
    return this.reRead(workspaceId);
  }

  private async reRead(workspaceId: string): Promise<Workspace> {
    const workspace = await this.unitOfWork.run((repositories) => repositories.workspaces.findById(workspaceId));
    if (!workspace) throw new WorkspaceNotFoundError();
    return workspace;
  }
}

function requireDirectOwner(membership: WorkspaceMembership | null, operation: string): void {
  if (membership?.role !== "OWNER") {
    throw new WorkspaceAccessDeniedError(`Team workspace ${operation} requires a direct OWNER grant.`);
  }
}
