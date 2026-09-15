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

/** Team creation without the platform-level workspace.create_team capability. */
export class TeamCreationDeniedError extends DomainError {
  constructor(message = "Team Workspace creation requires the platform workspace.create_team capability.") {
    super("TEAM_CREATION_DENIED", message);
    this.name = "TeamCreationDeniedError";
  }
}

/** A Team lifecycle transition or mutation violates the ACTIVE<->ARCHIVED boundary (spec §14.1). */
export class WorkspaceLifecycleError extends DomainError {
  constructor(message: string) {
    super("WORKSPACE_LIFECYCLE_VIOLATION", message);
    this.name = "WorkspaceLifecycleError";
  }
}
export class PersonalProvisioningUnavailableError extends DomainError {
  constructor(
    message = "Personal workspace provisioning requires migration 008 (workspaces.workspace_type / personal_owner_user_id with uq_workspaces_personal_owner).",
  ) {
    super("PERSONAL_PROVISIONING_UNAVAILABLE", message);
    this.name = "PersonalProvisioningUnavailableError";
  }
}
