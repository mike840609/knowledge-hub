import { DomainError } from "@/shared/domain/errors";

/**
 * Shipped import diagnostic codes (#9 item 21). `importError` only accepts
 * these codes so a mistyped code fails typecheck instead of surfacing as a
 * silent 400/409 mismatch at runtime. `IMPORT_APPLY_FAILED` is the fallback
 * failure-audit code (never thrown directly); every other member is thrown
 * from at least one product-code call site.
 */
export type ImportErrorCode =
  | "CANONICAL_PATH_CONFLICT"
  | "CANONICAL_STATE_INVALID"
  | "FRONTMATTER_NOT_OBJECT"
  | "IDENTITY_ADOPTION_AMBIGUOUS"
  | "IDENTITY_CONFLICT"
  | "IDENTITY_STATE_CHANGED"
  | "IMPORT_APPLY_FAILED"
  | "IMPORT_APPLY_RETRYABLE"
  | "IMPORT_BUILDING_QUOTA_EXCEEDED"
  | "IMPORT_LIMIT_EXCEEDED"
  | "IMPORT_PLAN_BINDING_MISMATCH"
  | "IMPORT_PLAN_ENTRY_MISSING"
  | "IMPORT_PLAN_NODE_MISSING"
  | "IMPORT_PLAN_PARENT_MISMATCH"
  | "IMPORT_PLAN_PARENT_MISSING"
  | "IMPORT_PLAN_VERSION_UNSUPPORTED"
  | "IMPORT_READY_QUOTA_EXCEEDED"
  | "IMPORT_SNAPSHOT_ACCESS_DENIED"
  | "IMPORT_SNAPSHOT_BLOCKED"
  | "IMPORT_SNAPSHOT_EXPIRED"
  | "IMPORT_SNAPSHOT_INTEGRITY_MISMATCH"
  | "IMPORT_SNAPSHOT_INVALID"
  | "IMPORT_SNAPSHOT_NOT_BUILDING"
  | "IMPORT_SNAPSHOT_NOT_FOUND"
  | "IMPORT_SNAPSHOT_NOT_READY"
  | "IMPORT_SNAPSHOT_STALE"
  | "IMPORT_SNAPSHOT_STATE_CONFLICT"
  | "IMPORT_SOURCE_NOT_FOUND"
  | "IMPORT_VERSION_ADVANCE_FAILED"
  | "INVALID_ASSET_MANIFEST"
  | "INVALID_FRONTMATTER"
  | "INVALID_IMPORT_MANIFEST"
  | "INVALID_KNOWLEDGE_ID"
  | "INVALID_MARKDOWN_ENCODING"
  | "INVALID_SOURCE_PATH"
  | "INVALID_TITLE"
  | "INVALID_UPLOAD_BATCH"
  | "SOURCE_IMPORT_NOT_ALLOWED"
  | "SOURCE_VERSION_CONFLICT"
  | "TEST_IMPORT_FAILURE"
  | "UPLOAD_ENTRY_CONFLICT"
  | "UPLOAD_ENTRY_NOT_FOUND"
  | "UPLOAD_INCOMPLETE"
  | "UPLOAD_SIZE_MISMATCH";

export class SourceImportError extends DomainError {
  declare readonly code: ImportErrorCode;
  readonly details?: Record<string, unknown>;
  constructor(code: ImportErrorCode, message: string, details?: Record<string, unknown>) {
    super(code, message);
    this.name = "SourceImportError";
    this.details = details;
  }
}

export function importError(code: ImportErrorCode, message: string, details?: Record<string, unknown>): SourceImportError {
  return new SourceImportError(code, message, details);
}
