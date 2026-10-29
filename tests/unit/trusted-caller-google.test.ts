import { describe, expect, it, vi } from "vitest";
import { establishTrustedCaller, type TrustedCallerDependencies, type TrustedCallerRepositories } from "@/server/trusted-caller";
import type { UserIdentity } from "@/modules/identity/domain/user-identity";
import type { HubIdentityResolver } from "@/modules/identity/application/hub-identity-resolver";
import type { PersonalWorkspaceService } from "@/modules/workspaces/application/personal-workspace-service";

const identity: UserIdentity = { id: "u1", emp_id: "DEMO-ABC1234567", name: "Wang", org_code: "DEMO" };

function claims(provider: string, subject: string) {
  return {
    externalIdentity: { provider, subject, emp_id: identity.emp_id, account: null, name_en: null, name: identity.name, org_code: identity.org_code },
    validatedExternalGroupIds: [],
    platformCapabilities: [],
    refreshedAt: new Date(),
  };
}

function dependencies(providerKind: string, usesDirectIdentity = providerKind !== "company-sso") {
  const getCurrentIdentity = vi.fn(async () => identity);
  const resolve = vi.fn(async () => identity);
  const upsertIdentity = vi.fn(async () => {});
  const ensurePersonalWorkspace = vi.fn(async () => ({ workspace: { id: "ws-1" } }));
  const users = { upsertIdentity } as unknown as TrustedCallerRepositories["users"];
  return {
    provider: {
      getCurrentClaims: vi.fn(async () => claims(providerKind, "subject-1")),
      getCurrentIdentity,
    },
    resolver: { resolve } as unknown as HubIdentityResolver,
    personalWorkspaces: { ensurePersonalWorkspace } as unknown as PersonalWorkspaceService,
    unitOfWork: {
      run: async <T>(work: (repositories: TrustedCallerRepositories) => Promise<T>) => work({ users }),
    },
    usesDirectIdentity,
    getCurrentIdentity,
    resolve,
    upsertIdentity,
    ensurePersonalWorkspace,
  } satisfies TrustedCallerDependencies & {
    getCurrentIdentity: typeof getCurrentIdentity;
    resolve: typeof resolve;
    upsertIdentity: typeof upsertIdentity;
    ensurePersonalWorkspace: typeof ensurePersonalWorkspace;
  };
}

describe("establishTrustedCaller provider routing", () => {
  it("uses direct identity for Google and never the external resolver", async () => {
    const deps = dependencies("google");
    const trusted = await establishTrustedCaller(deps);
    expect(trusted.identity).toEqual(identity);
    expect(deps.getCurrentIdentity).toHaveBeenCalledOnce();
    expect(deps.resolve).not.toHaveBeenCalled();
    expect(deps.upsertIdentity).toHaveBeenCalledWith(identity);
    expect(deps.ensurePersonalWorkspace).toHaveBeenCalledWith(identity.id);
  });

  it("keeps company SSO on the external resolver", async () => {
    const deps = dependencies("company-sso");
    await establishTrustedCaller(deps);
    expect(deps.resolve).toHaveBeenCalledOnce();
    expect(deps.getCurrentIdentity).not.toHaveBeenCalled();
  });

  it("keeps company SSO on the resolver even when its configured name is google", async () => {
    const deps = dependencies("google", false);
    await establishTrustedCaller(deps);
    expect(deps.resolve).toHaveBeenCalledOnce();
    expect(deps.getCurrentIdentity).not.toHaveBeenCalled();
  });
});
