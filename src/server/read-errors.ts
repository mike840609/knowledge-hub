import { DomainError } from "@/shared/domain/errors";
import { NotFoundError } from "@/modules/knowledge/domain/errors";
import { WorkspaceAccessDeniedError, WorkspaceNotFoundError } from "@/modules/workspaces/domain/errors";

/**
 * A read failure that means "the reader cannot see this", not "the read broke".
 * The application services use both typed errors and plain DomainError codes for
 * the same conditions, so a page that catches only the classes turns a known
 * hidden resource into a retryable 500.
 */
const HIDDEN_CODES = new Set([
  "NOT_FOUND",
  "DOCUMENT_NOT_FOUND",
  "SOURCE_NOT_FOUND",
  "REVISION_NOT_FOUND",
  "TREE_NODE_NOT_FOUND",
  "WORKSPACE_NOT_FOUND",
  "WORKSPACE_ACCESS_DENIED",
  "INVALID_REQUEST",
]);

export function isHiddenReadFailure(error: unknown): boolean {
  if (error instanceof NotFoundError || error instanceof WorkspaceAccessDeniedError || error instanceof WorkspaceNotFoundError) return true;
  return error instanceof DomainError && HIDDEN_CODES.has(error.code);
}
