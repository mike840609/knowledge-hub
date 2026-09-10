export class DomainError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DomainError";
    this.code = code;
  }
}

export class ValidationError extends DomainError {
  constructor(message: string) {
    super("VALIDATION_ERROR", message);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends DomainError {
  constructor(message: string) {
    super("NOT_FOUND", message);
    this.name = "NotFoundError";
  }
}

export class SourceReadOnlyError extends DomainError {
  constructor(message = "This source is managed by its source and cannot be changed from Hub.") {
    super("SOURCE_READ_ONLY", message);
    this.name = "SourceReadOnlyError";
  }
}

export class VersionConflictError extends DomainError {
  constructor(message = "The source changed while this operation was being prepared.") {
    super("VERSION_CONFLICT", message);
    this.name = "VersionConflictError";
  }
}

export class IntegrityError extends DomainError {
  constructor(message: string) {
    super("INTEGRITY_ERROR", message);
    this.name = "IntegrityError";
  }
}

export class IdentityError extends DomainError {
  constructor(message: string) {
    super("IDENTITY_ERROR", message);
    this.name = "IdentityError";
  }
}

/** The caller is not a member of the resource's Workspace. */
export class WorkspaceAccessDeniedError extends DomainError {
  constructor(message = "You do not have access to this Workspace.") {
    super("WORKSPACE_ACCESS_DENIED", message);
    this.name = "WorkspaceAccessDeniedError";
  }
}
