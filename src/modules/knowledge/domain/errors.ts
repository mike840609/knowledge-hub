import { DomainError } from "@/shared/domain/errors";

export { DomainError };

/**
 * Phase 1 error foundations (plan §5).
 *
 * `ValidationError`, `NotFoundError`, and `IntegrityError` remain compatible
 * base classes: existing `instanceof` consumers keep working while precise
 * subclasses carry the declared semantic codes. Codes for operations not yet
 * present are defined here and wired by the task introducing each operation.
 */
export class ValidationError extends DomainError {
  constructor(message: string, code = "VALIDATION_ERROR") {
    super(code, message);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends DomainError {
  constructor(message: string, code = "NOT_FOUND") {
    super(code, message);
    this.name = "NotFoundError";
  }
}

export class IntegrityError extends DomainError {
  constructor(message: string, code = "INTEGRITY_ERROR") {
    super(code, message);
    this.name = "IntegrityError";
  }
}

/**
 * Knowledge candidate-validation failures. Extends `ValidationError` (itself
 * under the shared `DomainError` hierarchy) so existing validation consumers
 * keep matching while codes distinguish title/metadata causes.
 */
export class KnowledgeError extends ValidationError {
  constructor(code: string, message: string) {
    super(message, code);
    this.name = "KnowledgeError";
  }
}

export class SourceNotFoundError extends NotFoundError {
  constructor(message = "The requested Knowledge source was not found.") {
    super(message, "SOURCE_NOT_FOUND");
    this.name = "SourceNotFoundError";
  }
}

export class DocumentNotFoundError extends NotFoundError {
  constructor(message = "Knowledge document was not found.") {
    super(message, "DOCUMENT_NOT_FOUND");
    this.name = "DocumentNotFoundError";
  }
}

export class RevisionNotFoundError extends NotFoundError {
  constructor(message = "Knowledge revision was not found.") {
    super(message, "REVISION_NOT_FOUND");
    this.name = "RevisionNotFoundError";
  }
}

export class TreeNodeNotFoundError extends NotFoundError {
  constructor(message = "Tree node was not found.") {
    super(message, "TREE_NODE_NOT_FOUND");
    this.name = "TreeNodeNotFoundError";
  }
}

export class SourceArchivedError extends KnowledgeError {
  constructor(message = "Archived sources cannot receive Hub mutations.") {
    super("SOURCE_ARCHIVED", message);
    this.name = "SourceArchivedError";
  }
}

export class DocumentArchivedError extends KnowledgeError {
  constructor(message = "The Knowledge document is archived.") {
    super("DOCUMENT_ARCHIVED", message);
    this.name = "DocumentArchivedError";
  }
}

export class HubManagedOperationRequiredError extends KnowledgeError {
  constructor(message = "This operation requires a HUB_MANAGED source.") {
    super("HUB_MANAGED_OPERATION_REQUIRED", message);
    this.name = "HubManagedOperationRequiredError";
  }
}

export class InvalidParentError extends KnowledgeError {
  constructor(message = "Documents must be placed under an active folder in the same source.") {
    super("INVALID_PARENT", message);
    this.name = "InvalidParentError";
  }
}

export class CrossSourceMoveError extends KnowledgeError {
  constructor(message = "A tree node cannot move across sources.") {
    super("CROSS_SOURCE_MOVE", message);
    this.name = "CrossSourceMoveError";
  }
}

export class TreeCycleError extends KnowledgeError {
  constructor(message = "A tree node cannot be moved inside itself or its descendants.") {
    super("TREE_CYCLE", message);
    this.name = "TreeCycleError";
  }
}

export class FolderNotEmptyError extends KnowledgeError {
  constructor(message = "A folder with active children cannot be archived.") {
    super("FOLDER_NOT_EMPTY", message);
    this.name = "FolderNotEmptyError";
  }
}

export class RevisionConflictError extends KnowledgeError {
  constructor(message = "The document changed while this revision was being prepared.") {
    super("REVISION_CONFLICT", message);
    this.name = "RevisionConflictError";
  }
}

export class SourceEntryConflictError extends KnowledgeError {
  constructor(message = "The SourceEntry mapping conflicts with an existing mapping.") {
    super("SOURCE_ENTRY_CONFLICT", message);
    this.name = "SourceEntryConflictError";
  }
}

export class InvalidSourceMappingError extends KnowledgeError {
  constructor(message = "The SourceEntry mapping is invalid.") {
    super("INVALID_SOURCE_MAPPING", message);
    this.name = "InvalidSourceMappingError";
  }
}

export class InvalidTitleError extends KnowledgeError {
  constructor(message = "Document title must be a non-empty string.") {
    super("INVALID_TITLE", message);
    this.name = "InvalidTitleError";
  }
}

export class InvalidMetadataError extends KnowledgeError {
  constructor(message = "Knowledge metadata must be a JSON object.") {
    super("INVALID_METADATA", message);
    this.name = "InvalidMetadataError";
  }
}

export class IntegrityViolationError extends IntegrityError {
  constructor(message = "The requested data violates a Knowledge Hub integrity constraint.") {
    super(message, "INTEGRITY_VIOLATION");
    this.name = "IntegrityViolationError";
  }
}

export class SourceReadOnlyError extends DomainError {
  constructor(message = "This source is managed by its source and cannot be changed from Hub.") {
    super("SOURCE_MANAGED_READ_ONLY", message);
    this.name = "SourceReadOnlyError";
  }
}

export class VersionConflictError extends DomainError {
  constructor(message = "The source changed while this operation was being prepared.") {
    super("VERSION_CONFLICT", message);
    this.name = "VersionConflictError";
  }
}

export class IdentityError extends DomainError {
  constructor(message: string) {
    super("IDENTITY_ERROR", message);
    this.name = "IdentityError";
  }
}
