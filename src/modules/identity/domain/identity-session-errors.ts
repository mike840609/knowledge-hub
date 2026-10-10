import { DomainError } from "@/shared/domain/errors";
/** No signed-in session. Every company-SSO route can meet this, so the message names no feature. */
export class AuthRequiredError extends DomainError {
  constructor() { super("AUTH_REQUIRED", "Sign in to continue."); }
}
/**
 * The identity provider could not answer. `cause` keeps why for whoever reads the server's errors;
 * the response carries only the code and this message.
 */
export class AuthUnavailableError extends DomainError {
  constructor(options?: { cause?: unknown }) {
    super("AUTH_UNAVAILABLE", "Sign-in is unavailable right now.");
    this.cause = options?.cause;
  }
}
