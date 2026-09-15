import { describe, expect, it } from "vitest";
import {
  HubIdentityResolver,
  type HubIdentityRepositories,
  type HubIdentityUnitOfWork,
} from "@/modules/identity/application/hub-identity-resolver";
import {
  IdentityLinkConflictError,
  IdentityLinkRequiredError,
} from "@/modules/identity/domain/identity-errors";
import type { ExternalCompanyIdentity } from "@/modules/identity/domain/external-company-identity";
import type { UserIdentity } from "@/modules/identity/domain/user-identity";

/**
 * Deterministic regression tests for mid-race transient fail-closed verdicts:
 * the winner commits the user row but not yet the link row (REQUIRED), or
 * commits the link between the loser's first and third read (CONFLICT on a
 * real row but a stale verdict — proven by a captured F2 failure). The
 * resolver must retry both (a retry can only succeed on a COMMITTED subject
 * link row), while genuine unlinked/conflicting identities re-derive the same
 * verdict and surface after exhaustion.
 */
class ScriptedUnitOfWork implements HubIdentityUnitOfWork {
  calls = 0;

  constructor(private readonly script: ReadonlyArray<Error | UserIdentity>) {}

  async run<T>(work: (repositories: HubIdentityRepositories) => Promise<T>): Promise<T> {
    void work;
    const step = this.script[this.calls];
    this.calls += 1;
    if (step instanceof Error) throw step;
    return step as unknown as T;
  }
}

const claims: ExternalCompanyIdentity = {
  provider: "company-sso",
  subject: "subject-retry",
  emp_id: "EMP-RETRY-1",
  name: "Retry User",
  org_code: "RD",
};

const converged: UserIdentity = {
  id: "0199f000-0000-7000-8000-0000000000a1",
  emp_id: "EMP-RETRY-1",
  name: "Retry User",
  org_code: "RD",
};

describe("HubIdentityResolver transient REQUIRED retry", () => {
  it("retries transient IdentityLinkRequiredError and converges", async () => {
    const unitOfWork = new ScriptedUnitOfWork([
      new IdentityLinkRequiredError(),
      new IdentityLinkRequiredError(),
      converged,
    ]);
    const resolved = await new HubIdentityResolver(unitOfWork).resolve(claims);
    expect(resolved).toEqual(converged);
    expect(unitOfWork.calls).toBe(3);
  });

  it("retries transient IdentityLinkConflictError and converges", async () => {
    const unitOfWork = new ScriptedUnitOfWork([new IdentityLinkConflictError(), converged]);
    const resolved = await new HubIdentityResolver(unitOfWork).resolve(claims);
    expect(resolved).toEqual(converged);
    expect(unitOfWork.calls).toBe(2);
  });

  it("rethrows genuine IdentityLinkConflictError after exhausting 5 attempts", async () => {
    const unitOfWork = new ScriptedUnitOfWork([
      new IdentityLinkConflictError(),
      new IdentityLinkConflictError(),
      new IdentityLinkConflictError(),
      new IdentityLinkConflictError(),
      new IdentityLinkConflictError(),
    ]);
    await expect(new HubIdentityResolver(unitOfWork).resolve(claims)).rejects.toBeInstanceOf(
      IdentityLinkConflictError,
    );
    expect(unitOfWork.calls).toBe(5);
  });

  it("rethrows genuine IdentityLinkRequiredError after exhausting 5 attempts", async () => {
    const unitOfWork = new ScriptedUnitOfWork([
      new IdentityLinkRequiredError(),
      new IdentityLinkRequiredError(),
      new IdentityLinkRequiredError(),
      new IdentityLinkRequiredError(),
      new IdentityLinkRequiredError(),
    ]);
    await expect(new HubIdentityResolver(unitOfWork).resolve(claims)).rejects.toBeInstanceOf(
      IdentityLinkRequiredError,
    );
    expect(unitOfWork.calls).toBe(5);
  });
});
