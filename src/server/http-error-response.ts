import { DomainError } from "@/shared/domain/errors";
import type { SourceImportError } from "@/modules/sources/domain/import-errors";

export type ImportHttpErrorBody = { error: { code: string; message: string; details?: Record<string, unknown> } };
export type ImportHttpError = { status: number; body: ImportHttpErrorBody };

/**
 * Import HTTP error mapping. Missing or otherwise undiscoverable resources use
 * non-enumerating 404 semantics. A discoverable import snapshot denial is
 * explicit 403 because the caller has already been proven to know the snapshot
 * exists. Version/stale/retryable conflicts are 409. Every other domain error
 * is a 400 that preserves its machine-readable code. Anything else is a 500
 * INTERNAL_ERROR with no internal detail.
 *
 * HIDDEN_NOT_FOUND (lines 15-20) is used by toImportErrorResponse() and covers
 * only import-domain resources. WORKSPACE_HIDDEN_NOT_FOUND (lines 23-28) extends
 * it with Knowledge-domain resources for toWorkspaceErrorResponse().
 */
const HIDDEN_NOT_FOUND = new Set([
  "IMPORT_SNAPSHOT_NOT_FOUND",
  "IMPORT_SOURCE_NOT_FOUND",
  "WORKSPACE_ACCESS_DENIED",
  "WORKSPACE_NOT_FOUND",
]);

const WORKSPACE_HIDDEN_NOT_FOUND = new Set([
  ...HIDDEN_NOT_FOUND,
  "DOCUMENT_NOT_FOUND",
  "SOURCE_NOT_FOUND",
]);

const ACCESS_DENIED = new Set([
  "IMPORT_SNAPSHOT_ACCESS_DENIED",
]);

const CONFLICT = new Set([
  "WORKSPACE_ARCHIVED",
  "SOURCE_VERSION_CONFLICT",
  "IMPORT_SNAPSHOT_STALE",
  "IMPORT_APPLY_RETRYABLE",
  "UPLOAD_ENTRY_CONFLICT",
]);

export function toImportErrorResponse(error: unknown): ImportHttpError {
  if (error instanceof DomainError) {
    if (HIDDEN_NOT_FOUND.has(error.code)) {
      return { status: 404, body: { error: { code: "NOT_FOUND", message: "The requested resource was not found." } } };
    }
    if (ACCESS_DENIED.has(error.code)) {
      return { status: 403, body: { error: { code: "ACCESS_DENIED", message: "You do not have access to the requested resource." } } };
    }
    if (CONFLICT.has(error.code)) {
      const details = (error as SourceImportError).details;
      return {
        status: 409,
        body: { error: { code: error.code, message: error.message, ...(details !== undefined ? { details } : {}) } },
      };
    }
    {
      const details = (error as SourceImportError).details;
      return {
        status: 400,
        body: { error: { code: error.code, message: error.message, ...(details !== undefined ? { details } : {}) } },
      };
    }
  }
  return { status: 500, body: { error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." } } };
}

export type ApiErrorBody = { error: { code: string; message: string; field?: string } };
export function toWorkspaceErrorResponse(error: unknown): { status: number; body: ApiErrorBody } {
  if (error instanceof DomainError) {
    if (WORKSPACE_HIDDEN_NOT_FOUND.has(error.code)) return { status: 404, body: { error: { code: "NOT_FOUND", message: "The requested resource was not found." } } };
    const status = ["INSUFFICIENT_WORKSPACE_CAPABILITY", "TEAM_CREATION_DENIED", "PERSONAL_WORKSPACE_FROZEN"].includes(error.code) ? 403
      : ["WORKSPACE_ARCHIVED", "LAST_DIRECT_OWNER", "MEMBER_ALREADY_EXISTS", "GROUP_MAPPING_ALREADY_EXISTS", "WORKSPACE_LIFECYCLE_VIOLATION",
         "REVISION_CONFLICT", "SOURCE_MANAGED_READ_ONLY", "SOURCE_ARCHIVED", "DOCUMENT_ARCHIVED"].includes(error.code) ? 409
      : ["MEMBER_NOT_FOUND", "INVALID_ROLE_ASSIGNMENT", "INVALID_WORKSPACE_NAME", "INVALID_REQUEST",
         "INVALID_TITLE", "INVALID_METADATA", "VALIDATION_ERROR"].includes(error.code) ? 400 : 500;
    if (status !== 500) return { status, body: { error: { code: error.code, message: error.message, ...(error.code === "INVALID_WORKSPACE_NAME" ? { field: "name" } : {}) } } };
  }
  return { status: 500, body: { error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." } } };
}
