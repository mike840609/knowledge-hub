import { DomainError } from "@/shared/domain/errors";

export type TaskArtifactErrorCode =
  | "MALFORMED_JSON"
  | "PAYLOAD_TOO_LARGE"
  | "INVALID_ARTIFACT"
  | "UNSUPPORTED_SCHEMA_VERSION";

/**
 * A task artifact failed its contract. Messages name the field that failed,
 * never the value: an Agent's payload may carry a secret it should not have.
 */
export class TaskArtifactError extends DomainError {
  declare readonly code: TaskArtifactErrorCode;

  constructor(code: TaskArtifactErrorCode, message: string) {
    super(code, message);
    this.name = "TaskArtifactError";
  }
}

/**
 * No database connection could be obtained. Nothing was written, so the
 * request is retryable (design §7, 503). Declared here so the route maps it
 * without importing the driver.
 */
export class DatabaseUnavailableError extends DomainError {
  constructor() {
    super("DATABASE_UNAVAILABLE", "The database is unavailable. Nothing was saved; try again in a moment.");
    this.name = "DatabaseUnavailableError";
  }
}

/** The export credential is missing, unknown or revoked (401). */
export class CredentialInvalidError extends DomainError {
  constructor() {
    super("CREDENTIAL_INVALID", "The export credential is missing, unknown or revoked.");
    this.name = "CredentialInvalidError";
  }
}

/** The credential is live, but its Workspace or Source no longer allows the write (403). */
export class ScopeDeniedError extends DomainError {
  constructor() {
    super("SCOPE_DENIED", "This binding's My Space or Wiki folder no longer accepts exports.");
    this.name = "ScopeDeniedError";
  }
}

/** Both revision 409s carry the latest revision the server holds, so the CLI can continue from it. */
export class RevisionConflictError extends DomainError {
  constructor(readonly latestRevisionNo: number) {
    super("REVISION_CONFLICT", "This revision is already stored with different content.");
    this.name = "RevisionConflictError";
  }
}

export class RevisionOutOfOrderError extends DomainError {
  constructor(readonly latestRevisionNo: number) {
    super("REVISION_OUT_OF_ORDER", "Revisions must arrive in sequence: send the next number after the latest one stored.");
    this.name = "RevisionOutOfOrderError";
  }
}

export class TaskArchivedError extends DomainError {
  constructor() {
    super("TASK_ARCHIVED", "This task is archived in My Space; restore it before adding a revision.");
    this.name = "TaskArchivedError";
  }
}


/** A bounded owner-scoped search timed out; no matching data may be leaked. */
export class TaskSearchUnavailableError extends DomainError {
  constructor() {
    super("TASK_SEARCH_UNAVAILABLE", "Task search timed out. Try again or narrow the filters.");
    this.name = "TaskSearchUnavailableError";
  }
}
