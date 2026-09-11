import { DomainError } from "@/shared/domain/errors";

/** The caller is not a member of the resource's Workspace. */
export class WorkspaceAccessDeniedError extends DomainError {
  constructor(message = "You do not have access to this Workspace.") {
    super("WORKSPACE_ACCESS_DENIED", message);
    this.name = "WorkspaceAccessDeniedError";
  }
}

/** The requested Workspace does not exist or is hidden from the caller. */
export class WorkspaceNotFoundError extends DomainError {
  constructor(message = "The requested Workspace was not found.") {
    super("WORKSPACE_NOT_FOUND", message);
    this.name = "WorkspaceNotFoundError";
  }
}
