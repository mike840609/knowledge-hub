import { DomainError } from "@/shared/domain/errors";
import { WorkspaceAccessDeniedError } from "@/modules/workspaces/domain/errors";

/**
 * Publication failures that later tasks turn into a 409-style answer. They are
 * named so the service layer can distinguish "that name is taken" from "that
 * original already feeds another publication in this team" without reading
 * driver messages. Access, not-found and read-only failures keep their
 * existing contracts.
 */
export type PublicationErrorCode =
  | "PUBLICATION_NAME_TAKEN"
  | "PUBLICATION_ORIGINAL_TAKEN"
  | "PUBLICATION_JOIN_LOW_OVERLAP";

export class PublicationError extends DomainError {
  declare readonly code: PublicationErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: PublicationErrorCode, message: string, details?: Record<string, unknown>) {
    super(code, message);
    this.name = "PublicationError";
    this.details = details;
  }
}

export function publicationError(
  code: PublicationErrorCode,
  message: string,
  details?: Record<string, unknown>,
): PublicationError {
  return new PublicationError(code, message, details);
}

/**
 * A proven team member who lacks `source.manage`, as opposed to someone the
 * team is hidden from. The code stays `WORKSPACE_ACCESS_DENIED` for existing
 * callers, but the HTTP edge can answer 403 for this class and keep a
 * non-member's 404: membership was already established by the service, never
 * by the route.
 */
export class PublicationAccessDeniedError extends WorkspaceAccessDeniedError {
  constructor(message = "Publishing to a team requires source.manage.") {
    super(message);
    this.name = "PublicationAccessDeniedError";
  }
}
