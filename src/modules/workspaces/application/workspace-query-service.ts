import type { CallerContext } from "@/modules/identity/domain/caller-context";
import type { WorkspaceAccessPolicy } from "../ports/workspace-access-policy";
import type { WorkspaceGroupMappingRepository } from "../ports/workspace-group-mapping-repository";
import type { WorkspaceMembershipRepository } from "../ports/workspace-membership-repository";
import type { WorkspaceUnitOfWork } from "../ports/unit-of-work";
import type { Workspace } from "../domain/workspace";
import type { WorkspaceCapability } from "../domain/workspace-capability";
import { WorkspaceAccessDeniedError, WorkspaceNotFoundError } from "../domain/errors";
import { evaluateWorkspaceCapabilities, requireWorkspaceRead } from "./workspace-authorization";

export type WorkspaceView = {
  id: string;
  name: string;
  type: "PERSONAL" | "TEAM";
  lifecycleState: "ACTIVE" | "ARCHIVED";
};

export class WorkspaceQueryService {
  constructor(private readonly unitOfWork: WorkspaceUnitOfWork) {}

  async listWorkspaces(caller: CallerContext): Promise<WorkspaceView[]> {
    return this.unitOfWork.run(async (repositories) => {
      await repositories.users.upsertIdentity(caller.identity);
      const accessible = new Map<string, Workspace>();
      for (const workspace of await repositories.workspaces.listForUser(caller.identity.id)) {
        if (workspace.workspaceType === "PERSONAL") {
          const membership = await repositories.workspaceMemberships.find(workspace.id, caller.identity.id);
          if (workspace.personalOwnerUserId !== caller.identity.id || membership?.membershipSource !== "SYSTEM_PERSONAL") continue;
        }
        accessible.set(workspace.id, workspace);
      }
      if (caller.validatedExternalGroupIds.length > 0) {
        const mappings = await repositories.groupMappings.listByExternalGroupIds(caller.validatedExternalGroupIds);
        for (const mapping of mappings) {
          if (accessible.has(mapping.workspaceId)) continue;
          if (mapping.role !== "ADMIN" && mapping.role !== "EDITOR" && mapping.role !== "VIEWER") continue;
          const workspace = await repositories.workspaces.findById(mapping.workspaceId);
          if (workspace && workspace.workspaceType !== "PERSONAL") accessible.set(workspace.id, workspace);
        }
      }
      return [...accessible.values()]
        .sort((left, right) => navigationRank(left) - navigationRank(right) || left.name.localeCompare(right.name) || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
        .map((workspace) => ({ id: workspace.id, name: workspace.name, type: workspace.workspaceType ?? "TEAM", lifecycleState: workspace.lifecycleState ?? "ACTIVE" }));
    });
  }
}

export class WorkspaceMembershipPolicy implements WorkspaceAccessPolicy {
  constructor(
    private readonly memberships: WorkspaceMembershipRepository,
    private readonly groupMappings?: WorkspaceGroupMappingRepository,
  ) {}

  async evaluateCapabilities(caller: CallerContext, workspaceId: string): Promise<Set<WorkspaceCapability>> {
    return evaluateWorkspaceCapabilities(
      { workspaceMemberships: this.memberships, groupMappings: this.groupMappings }, caller, workspaceId,
    );
  }

  async requireMembership(caller: CallerContext, workspaceId: string): Promise<void> {
    const capabilities = await this.evaluateCapabilities(caller, workspaceId);
    if (!capabilities.has("workspace.discover")) throw new WorkspaceAccessDeniedError();
  }

  async requireWorkspaceRead(caller: CallerContext, workspaceId: string): Promise<void> {
    const capabilities = await this.evaluateCapabilities(caller, workspaceId);
    if (!capabilities.has("workspace.discover")) throw new WorkspaceNotFoundError();
    requireWorkspaceRead(capabilities);
  }
}

function navigationRank(workspace: Workspace): number {
  return workspace.workspaceType === "PERSONAL" ? 0 : workspace.lifecycleState === "ARCHIVED" ? 2 : 1;
}
