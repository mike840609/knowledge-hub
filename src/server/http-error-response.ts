import { DomainError } from "@/shared/domain/errors";

export type ImportHttpErrorBody = { error: { code: string; message: string } };
export type ImportHttpError = { status: number; body: ImportHttpErrorBody };

/**
 * Import HTTP error mapping. Missing or otherwise undiscoverable resources use
 * non-enumerating 404 semantics. A discoverable import snapshot denial is
 * explicit 403 because the caller has already been proven to know the snapshot
 * exists. Version/stale/retryable conflicts are 409. Every other domain error
 * is a 400 that preserves its machine-readable code. Anything else is a 500
 * INTERNAL_ERROR with no internal detail.
 */
const HIDDEN_NOT_FOUND = new Set([
  "IMPORT_SNAPSHOT_NOT_FOUND",
  "IMPORT_SOURCE_NOT_FOUND",
  "WORKSPACE_ACCESS_DENIED",
  "WORKSPACE_NOT_FOUND",
]);

const ACCESS_DENIED = new Set([
  "IMPORT_SNAPSHOT_ACCESS_DENIED",
]);

const CONFLICT = new Set([
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
      return { status: 409, body: { error: { code: error.code, message: error.message } } };
    }
    return { status: 400, body: { error: { code: error.code, message: error.message } } };
  }
  return { status: 500, body: { error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." } } };
}
