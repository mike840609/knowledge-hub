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

/** A Personal workspace rejects the attempted mutation: it is system-managed and frozen. */
export class PersonalWorkspaceFrozenError extends DomainError {
  constructor(operation: string) {
    super(
      "PERSONAL_WORKSPACE_FROZEN",
      `Personal workspace is frozen for ${operation}: My Space cannot be renamed, gain members or group mappings, transferred, archived, or deleted.`,
    );
    this.name = "PersonalWorkspaceFrozenError";
  }
}

/** Personal provisioning or backfill ran before the migration 008 governance columns exist. */
export class PersonalProvisioningUnavailableError extends DomainError {
  constructor(
    message = "Personal workspace provisioning requires migration 008 (workspaces.workspace_type / personal_owner_user_id with uq_workspaces_personal_owner).",
  ) {
    super("PERSONAL_PROVISIONING_UNAVAILABLE", message);
    this.name = "PersonalProvisioningUnavailableError";
  }
}
