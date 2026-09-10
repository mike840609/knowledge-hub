import { DomainError } from "@/shared/domain/errors";

/** The caller is not a member of the resource's Workspace. */
export class WorkspaceAccessDeniedError extends DomainError {
  constructor(message = "You do not have access to this Workspace.") {
    super("WORKSPACE_ACCESS_DENIED", message);
    this.name = "WorkspaceAccessDeniedError";
  }
}
