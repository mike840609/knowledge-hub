import { DomainError } from "@/shared/domain/errors";
export class AuthRequiredError extends DomainError {
  constructor() { super("AUTH_REQUIRED", "Sign in to add document comments."); }
}
export class AuthUnavailableError extends DomainError {
  constructor() { super("AUTH_UNAVAILABLE", "Document discussion authentication is unavailable."); }
}
