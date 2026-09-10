import type { UserIdentity } from "../domain/user-identity";

export interface IdentityProvider {
  getCurrentIdentity(): Promise<UserIdentity>;
}
