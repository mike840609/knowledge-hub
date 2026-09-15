import type { TrustedIdentityClaims } from "../domain/trusted-identity-claims";
import type { UserIdentity } from "../domain/user-identity";

export interface IdentityProvider {
  getCurrentIdentity(): Promise<UserIdentity>;
  /**
   * Server-validated claims for this session (spec §7.4). Providers must
   * re-read trusted session state on every call and never accept
   * browser-supplied identity, groups, or capabilities.
   */
  getCurrentClaims(): Promise<TrustedIdentityClaims>;
}
