import type { IdentityProvider } from "@/modules/identity/ports/identity-provider";
import type { TrustedIdentityClaims } from "@/modules/identity/domain/trusted-identity-claims";
import { localIdentityConfig } from "@/server/config";

export const LOCAL_IDENTITY_PROVIDER_NAME = "local";

export class LocalIdentityProvider implements IdentityProvider {
  async getCurrentIdentity() {
    return localIdentityConfig();
  }

  async getCurrentClaims(): Promise<TrustedIdentityClaims> {
    const identity = localIdentityConfig();
    return {
      externalIdentity: {
        provider: LOCAL_IDENTITY_PROVIDER_NAME,
        subject: identity.id,
        emp_id: identity.emp_id,
        name: identity.name,
        org_code: identity.org_code,
      },
      validatedExternalGroupIds: [],
      platformCapabilities: [],
      refreshedAt: new Date(),
    };
  }
}
