import { DomainError } from "@/shared/domain/errors";

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
