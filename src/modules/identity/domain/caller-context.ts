import type { AuthenticatedPrincipal } from "./authenticated-principal";
import type { PlatformCapability } from "./trusted-identity-claims";
import type { UserIdentity } from "./user-identity";

export type CallerContext = {
  identity: UserIdentity;
  /** Validated external group IDs resolved server-side; never browser-supplied. */
  validatedExternalGroupIds: readonly string[];
  /** Platform capabilities mapped server-side; never browser-supplied. */
  platformCapabilities: readonly PlatformCapability[];
};

export function callerFromIdentity(identity: UserIdentity): CallerContext {
  return { identity: { ...identity }, validatedExternalGroupIds: [], platformCapabilities: [] };
}

/**
 * Build a trusted CallerContext from the resolved Hub identity plus the
 * server-validated claims. Takes the whole principal as its only
 * parameter, so there is no channel for browser-supplied identity, groups,
 * or platform capabilities.
 */
export function callerFromPrincipal(principal: AuthenticatedPrincipal): CallerContext {
  return {
    identity: { ...principal.identity },
    validatedExternalGroupIds: [...principal.validatedExternalGroupIds],
    platformCapabilities: [...principal.platformCapabilities],
  };
}
