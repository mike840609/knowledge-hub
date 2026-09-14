import { IdentityError, IntegrityError } from "@/modules/knowledge/domain/errors";
import { uuidv7 } from "@/shared/ids/uuidv7";
import type { Workspace } from "../domain/workspace";
import { createPersonalWorkspaceInsert } from "../domain/workspace";
import { createSystemPersonalMembership } from "../domain/workspace-membership";
import { PersonalProvisioningUnavailableError, PersonalWorkspaceFrozenError } from "../domain/errors";
import type { WorkspaceUnitOfWork } from "../ports/unit-of-work";

export const PERSONAL_WORKSPACE_NAME = "My Space";

export const PERSONAL_WORKSPACE_PROVISIONED_EVENT = "PERSONAL_WORKSPACE_PROVISIONED";

export type PersonalMutationOperation =
  | "rename"
  | "add-member"
  | "add-group-mapping"
  | "transfer-ownership"
  | "archive"
  | "delete";

export type EnsurePersonalWorkspaceResult = {
  workspace: Workspace;
  created: boolean;
};

export function assertPersonalMutationAllowed(workspace: Workspace, operation: PersonalMutationOperation): void {
  if (workspace.workspaceType === "PERSONAL" || workspace.personalOwnerUserId != null) {
    throw new PersonalWorkspaceFrozenError(operation);
  }
}

export class PersonalWorkspaceService {
  constructor(private readonly unitOfWork: WorkspaceUnitOfWork) {}

  async ensurePersonalWorkspace(hubUserId: string): Promise<EnsurePersonalWorkspaceResult> {
    if (typeof hubUserId !== "string" || hubUserId.length === 0) {
      throw new IdentityError("Personal workspace provisioning requires a Hub user id.");
    }
    const existing = await this.unitOfWork.run((repositories) => repositories.workspaces.findPersonalByOwnerUserId(hubUserId));
    if (existing) {
      assertProvisionedShape(existing);
      return { workspace: existing, created: false };
    }
    const now = new Date();
    const workspaceId = uuidv7();
    try {
      await this.unitOfWork.run(async (repositories) => {
        await repositories.workspaces.insert(
          createPersonalWorkspaceInsert({ id: workspaceId, name: PERSONAL_WORKSPACE_NAME, ownerUserId: hubUserId, now }),
        );
        await repositories.workspaceMemberships.insert(createSystemPersonalMembership({ workspaceId, userId: hubUserId, now }));
        await repositories.auditEvents.append({
          id: uuidv7(),
          workspaceId,
          actorUserId: hubUserId,
          actorKind: "SYSTEM",
          eventType: PERSONAL_WORKSPACE_PROVISIONED_EVENT,
          targetType: "USER",
          targetId: hubUserId,
          payload: { workspaceType: "PERSONAL" },
          correlationId: null,
          createdAt: now,
        });
      });
    } catch (error) {
      if (error instanceof PersonalProvisioningUnavailableError) throw error;
      if (error instanceof IntegrityError) {
        const winner = await this.unitOfWork.run((repositories) => repositories.workspaces.findPersonalByOwnerUserId(hubUserId));
        if (winner) {
          assertProvisionedShape(winner);
          return { workspace: winner, created: false };
        }
      }
      throw error;
    }
    const created = await this.unitOfWork.run((repositories) => repositories.workspaces.findPersonalByOwnerUserId(hubUserId));
    if (!created) {
      throw new IntegrityError("Personal workspace provisioning committed but the workspace cannot be re-read.");
    }
    assertProvisionedShape(created);
    return { workspace: created, created: true };
  }
}

function assertProvisionedShape(workspace: Workspace): void {
  if (workspace.workspaceType !== "PERSONAL" || workspace.name !== PERSONAL_WORKSPACE_NAME || workspace.personalOwnerUserId == null) {
    throw new IntegrityError("Personal workspace lookup returned a row that is not a provisioned My Space.");
  }
}
