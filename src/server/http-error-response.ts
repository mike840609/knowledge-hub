import { DomainError } from "@/shared/domain/errors";

export type ImportHttpErrorBody = { error: { code: string; message: string } };
export type ImportHttpError = { status: number; body: ImportHttpErrorBody };

/**
 * Task 8 HTTP error mapping. Snapshot/source lookups and Workspace access
 * denials use non-enumerating not-found semantics: the caller cannot tell a
 * foreign snapshot from a missing one, so every hidden-access code collapses
 * to 404 NOT_FOUND. Version/stale/retryable conflicts are 409. Every other
 * domain error is a 400 that preserves its machine-readable code. Anything
 * else is a 500 INTERNAL_ERROR with no internal detail.
 */
const HIDDEN_NOT_FOUND = new Set([
  "IMPORT_SNAPSHOT_NOT_FOUND",
  "IMPORT_SOURCE_NOT_FOUND",
  "WORKSPACE_ACCESS_DENIED",
  "WORKSPACE_NOT_FOUND",
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
    if (CONFLICT.has(error.code)) {
      return { status: 409, body: { error: { code: error.code, message: error.message } } };
    }
    return { status: 400, body: { error: { code: error.code, message: error.message } } };
  }
  return { status: 500, body: { error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." } } };
}
