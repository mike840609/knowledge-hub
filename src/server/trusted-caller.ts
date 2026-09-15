import { LOCAL_IDENTITY_PROVIDER_NAME } from "@/infrastructure/identity/local-identity-provider";
import { callerFromPrincipal, type CallerContext } from "@/modules/identity/domain/caller-context";
import type { AuthenticatedPrincipal } from "@/modules/identity/domain/authenticated-principal";
import type { IdentityProvider } from "@/modules/identity/ports/identity-provider";
import type { UserRepository } from "@/modules/identity/ports/user-repository";
import type { UserIdentity } from "@/modules/identity/domain/user-identity";
import type { HubIdentityResolver } from "@/modules/identity/application/hub-identity-resolver";
import type { PersonalWorkspaceService } from "@/modules/workspaces/application/personal-workspace-service";
import type { Workspace } from "@/modules/workspaces/domain/workspace";

export type TrustedCallerRepositories = {
  users: UserRepository;
};

export interface TrustedCallerUnitOfWork {
  run<T>(work: (repositories: TrustedCallerRepositories) => Promise<T>): Promise<T>;
}

export type TrustedCallerDependencies = {
  provider: IdentityProvider;
  resolver: HubIdentityResolver;
  personalWorkspaces: PersonalWorkspaceService;
  unitOfWork: TrustedCallerUnitOfWork;
};

export type TrustedCaller = {
  caller: CallerContext;
  principal: AuthenticatedPrincipal;
  identity: UserIdentity;
  personalWorkspace: Workspace;
};

/**
 * Shared human Web/API request bootstrap (spec §5, §7.4): server-validated
 * claims resolve to a Hub user, the Hub user is synced, My Space is ensured,
 * and only then are the principal and caller built. The persisted identity
 * is always the resolver output (or the server-configured Local identity in
 * dev); raw SSO claim fields never reach upsertIdentity, and the browser
 * supplies no identity input at all.
 */
export async function establishTrustedCaller(dependencies: TrustedCallerDependencies): Promise<TrustedCaller> {
  const claims = await dependencies.provider.getCurrentClaims();
  const identity =
    claims.externalIdentity.provider === LOCAL_IDENTITY_PROVIDER_NAME
      ? await dependencies.provider.getCurrentIdentity()
      : await dependencies.resolver.resolve(claims.externalIdentity);
  await dependencies.unitOfWork.run((repositories) => repositories.users.upsertIdentity(identity));
  const { workspace: personalWorkspace } = await dependencies.personalWorkspaces.ensurePersonalWorkspace(identity.id);
  const principal: AuthenticatedPrincipal = {
    identity,
    validatedExternalGroupIds: [...claims.validatedExternalGroupIds],
    platformCapabilities: [...claims.platformCapabilities],
    refreshedAt: claims.refreshedAt,
  };
  return { caller: callerFromPrincipal(principal), principal, identity, personalWorkspace };
}
