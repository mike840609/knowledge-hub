import type { IdentityProvider } from "@/modules/identity/ports/identity-provider";
import { localIdentityConfig } from "@/server/config";

export class LocalIdentityProvider implements IdentityProvider {
  async getCurrentIdentity() {
    return localIdentityConfig();
  }
}
