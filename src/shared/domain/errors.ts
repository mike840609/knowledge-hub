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

/**
 * A statement larger than the database accepts at once (its max_allowed_packet): nothing was written,
 * and the same request would fail again, so it is not retried. Any write can meet this — a Hub
 * document, a draft, an import — so it carries no feature's name.
 */
export class ContentTooLargeError extends DomainError {
  // No size in the message: what fits depends on escaping, metadata and how many copies a row keeps,
  // so the packet limit would mislead the writer about how small to make it.
  constructor() {
    super("CONTENT_TOO_LARGE", "This is larger than the database accepts at once. Nothing was saved; make it smaller and try again.");
    this.name = "ContentTooLargeError";
  }
}
