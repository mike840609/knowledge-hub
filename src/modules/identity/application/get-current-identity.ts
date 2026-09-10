import type { IdentityProvider } from "../ports/identity-provider";

export function getCurrentIdentity(provider: IdentityProvider) {
  return provider.getCurrentIdentity();
}
