import type { CallerContext } from "@/modules/identity/domain/caller-context";
import type { Workspace } from "../domain/workspace";
import type { WorkspaceAccessPolicy } from "../ports/workspace-access-policy";
import type { WorkspaceMembershipRepository } from "../ports/workspace-membership-repository";
import type { WorkspaceUnitOfWork } from "../ports/unit-of-work";
import { WorkspaceAccessDeniedError } from "../domain/errors";

export class WorkspaceQueryService {
  constructor(private readonly unitOfWork: WorkspaceUnitOfWork) {}

  async listWorkspaces(caller: CallerContext): Promise<Workspace[]> {
    return this.unitOfWork.run(async (repositories) => {
      await repositories.users.upsertIdentity(caller.identity);
      return repositories.workspaces.listForUser(caller.identity.id);
    });
  }
}

export class WorkspaceMembershipPolicy implements WorkspaceAccessPolicy {
  constructor(private readonly memberships: WorkspaceMembershipRepository) {}

  async requireMembership(caller: CallerContext, workspaceId: string): Promise<void> {
    const membership = await this.memberships.find(workspaceId, caller.identity.id);
    if (!membership) throw new WorkspaceAccessDeniedError();
  }
}
