export class DomainError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DomainError";
    this.code = code;
  }
}

/**
 * A lock wait timed out or a deadlock rolled the transaction back: nothing was
 * written, and the same request can succeed once the other writer finishes —
 * typically a large folder import holding the workspace. Any write can meet
 * this, so it carries no feature's name; Apply translates it to its own
 * IMPORT_APPLY_RETRYABLE contract (import design §17.3).
 */
export class WorkspaceBusyError extends DomainError {
  constructor() {
    super("WORKSPACE_BUSY", "This workspace is busy with another change, such as a folder import. Nothing was saved; try again in a moment.");
    this.name = "WorkspaceBusyError";
  }
}
