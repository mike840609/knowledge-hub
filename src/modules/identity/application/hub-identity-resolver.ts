import { IdentityError } from "@/modules/knowledge/domain/errors";
import { IntegrityError } from "@/modules/knowledge/domain/errors";
import { uuidv7 } from "@/shared/ids/uuidv7";
import type { ExternalCompanyIdentity } from "../domain/external-company-identity";
import type { UserIdentity } from "../domain/user-identity";
import { IdentityLinkConflictError, IdentityLinkRequiredError } from "../domain/identity-errors";
import type { ExternalIdentityLinkRepository } from "../ports/external-identity-link-repository";
import type { UserRepository } from "../ports/user-repository";

export type HubIdentityRepositories = {
  users: UserRepository;
  identityLinks: ExternalIdentityLinkRepository;
};

export interface HubIdentityUnitOfWork {
  run<T>(work: (repositories: HubIdentityRepositories) => Promise<T>): Promise<T>;
}

/**
 * Durable runtime identity resolution (spec §7.2). Canonical account truth
 * is `(provider, subject) -> hub_user_id`; `emp_id` is a trusted enterprise
 * attribute and never the link key. The update path syncs only name /
 * org_code; emp_id drift never relinks, and creation inserts the UUIDv7
 * user plus link atomically in one transaction.
 */
export class HubIdentityResolver {
  constructor(private readonly unitOfWork: HubIdentityUnitOfWork) {}

  async resolve(external: ExternalCompanyIdentity): Promise<UserIdentity> {
    assertTrustedExternalIdentity(external);
    // Bounded convergence loop (max 5 attempts): concurrent first-logins race
    // on the (provider, subject) / emp_id unique constraints, and a loser can
    // collide more than once when its retry re-reads before the winner
    // commits. Deadlocks/lock-waits surface as retryable apply failures
    // (code IMPORT_APPLY_RETRYABLE), not IntegrityError, so both are
    // retried. Each attempt re-runs resolveOnce, which re-reads the winner
    // link first, so convergence is monotonic. Fail-closed errors
    // (IdentityLinkRequired/Conflict) and non-retryable errors rethrow
    // immediately without consuming attempts.
    let lastError: unknown;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      try {
        return await this.unitOfWork.run((repositories) => this.resolveOnce(repositories, external, new Date()));
      } catch (error) {
        if (error instanceof IdentityLinkRequiredError || error instanceof IdentityLinkConflictError) throw error;
        if (error instanceof IntegrityError || isRetryableApplyFailure(error)) {
          lastError = error;
          continue;
        }
        throw error;
      }
    }
    throw lastError;
  }

  private async resolveOnce(
    repositories: HubIdentityRepositories,
    external: ExternalCompanyIdentity,
    now: Date,
  ): Promise<UserIdentity> {
    const link = await repositories.identityLinks.findByProviderSubject(external.provider, external.subject);
    if (link) {
      const user = await repositories.users.findById(link.hubUserId);
      if (!user) throw new IntegrityError("Identity link points to a missing Hub user.");
      if (user.name !== external.name || user.org_code !== external.org_code) {
        await repositories.users.updateProfile(user.id, { name: external.name, org_code: external.org_code });
      }
      await repositories.identityLinks.touchLastSeen(link.id, now);
      return { id: user.id, emp_id: user.emp_id, name: external.name, org_code: external.org_code };
    }

    const existingByEmp = await repositories.users.findByEmpId(external.emp_id);
    if (existingByEmp) {
      const owned = await repositories.identityLinks.findByProviderHubUser(external.provider, existingByEmp.id);
      if (owned) throw new IdentityLinkConflictError();
      throw new IdentityLinkRequiredError();
    }

    const user: UserIdentity = { id: uuidv7(), emp_id: external.emp_id, name: external.name, org_code: external.org_code };
    await repositories.users.insert(user);
    await repositories.identityLinks.insert({
      id: uuidv7(),
      provider: external.provider,
      subject: external.subject,
      hubUserId: user.id,
      createdAt: now,
      lastSeenAt: now,
    });
    return user;
  }
}

function isRetryableApplyFailure(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "IMPORT_APPLY_RETRYABLE"
  );
}

function assertTrustedExternalIdentity(external: ExternalCompanyIdentity): void {
  const fields: Array<keyof ExternalCompanyIdentity> = ["provider", "subject", "emp_id", "name", "org_code"];
  for (const field of fields) {
    if (typeof external[field] !== "string" || external[field].length === 0) {
      throw new IdentityError(`Trusted company identity field ${field} must be a non-empty string.`);
    }
  }
}
