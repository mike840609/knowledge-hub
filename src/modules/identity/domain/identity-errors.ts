import { DomainError } from "@/shared/domain/errors";

/**
 * Phase 3 runtime identity resolution failures (spec §7.2). The resolver
 * never claims an existing Hub account by `emp_id`: a missing link plus an
 * existing `emp_id` fails closed so an operator can bootstrap the link
 * explicitly (Task 4), and a subject that collides with an already-linked
 * account is a distinct conflict.
 */
export class IdentityLinkRequiredError extends DomainError {
  constructor(message = "This company identity is not linked to a Hub user yet; an explicit identity-link bootstrap is required.") {
    super("IDENTITY_LINK_REQUIRED", message);
    this.name = "IdentityLinkRequiredError";
  }
}

export class IdentityLinkConflictError extends DomainError {
  constructor(message = "This company identity conflicts with an already-linked Hub user; an explicit account-link migration is required.") {
    super("IDENTITY_LINK_CONFLICT", message);
    this.name = "IdentityLinkConflictError";
  }
}
