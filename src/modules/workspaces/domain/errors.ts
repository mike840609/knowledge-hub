import { DomainError } from "@/shared/domain/errors";

/** The caller is not a member of the resource's Workspace. */
export class WorkspaceAccessDeniedError extends DomainError {
  constructor(message = "You do not have access to this Workspace.", code = "WORKSPACE_ACCESS_DENIED") {
    super(code, message);
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
  constructor(message: string, code = "WORKSPACE_LIFECYCLE_VIOLATION") {
    super(code, message);
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

export class InsufficientWorkspaceCapabilityError extends WorkspaceAccessDeniedError {
  constructor(message = "You do not have permission to perform this workspace operation.") { super(message, "INSUFFICIENT_WORKSPACE_CAPABILITY"); }
}

export class WorkspaceArchivedError extends WorkspaceLifecycleError {
  constructor(message = "This workspace is archived and read-only.") { super(message, "WORKSPACE_ARCHIVED"); }
}

export class LastDirectOwnerError extends WorkspaceAccessDeniedError {
  constructor(message = "Every Team workspace must retain at least one direct owner.") { super(message, "LAST_DIRECT_OWNER"); }
}

export class MemberNotFoundError extends WorkspaceLifecycleError {
  constructor(message = "The requested Hub user or direct membership was not found.") { super(message, "MEMBER_NOT_FOUND"); }
}

export class MemberAlreadyExistsError extends WorkspaceLifecycleError {
  constructor(message = "This user already has direct membership.") { super(message, "MEMBER_ALREADY_EXISTS"); }
}

export class GroupMappingAlreadyExistsError extends WorkspaceLifecycleError {
  constructor(message = "This external group is already mapped.") { super(message, "GROUP_MAPPING_ALREADY_EXISTS"); }
}

export class InvalidRoleAssignmentError extends WorkspaceLifecycleError {
  constructor(message = "The requested role is not assignable.") { super(message, "INVALID_ROLE_ASSIGNMENT"); }
}

export class InvalidWorkspaceNameError extends WorkspaceLifecycleError {
  constructor(message = "Use a non-empty name of at most 200 characters.") { super(message, "INVALID_WORKSPACE_NAME"); }
}
