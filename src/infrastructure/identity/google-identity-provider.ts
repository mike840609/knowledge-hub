import { AuthRequiredError } from "@/modules/identity/domain/identity-session-errors";
import type { TrustedIdentityClaims } from "@/modules/identity/domain/trusted-identity-claims";
import type { IdentityProvider } from "@/modules/identity/ports/identity-provider";
import { validateUserIdentity, type UserIdentity } from "@/modules/identity/domain/user-identity";

export const GOOGLE_IDENTITY_PROVIDER_NAME = "google";

export type GoogleSession = {
  user?: {
    hubUserId?: string;
    empId?: string;
    orgCode?: string;
    displayName?: string;
  };
};

/**
 * Reading the Auth.js session is injected so this module (and the factory)
 * never imports `@/auth` for local/company-sso deployments. The factory's
 * reader lazily imports Auth.js only when a Google session is actually read.
 */
export type GoogleSessionReader = () => Promise<GoogleSession | null>;

export class GoogleIdentityProvider implements IdentityProvider {
  constructor(private readonly readSession: GoogleSessionReader) {}

  async getCurrentIdentity(): Promise<UserIdentity> {
    const session = await this.readSession();
    const user = session?.user;
    if (!user?.hubUserId) throw new AuthRequiredError();
    return validateUserIdentity({
      id: user.hubUserId,
      emp_id: user.empId ?? "",
      name: user.displayName ?? "",
      org_code: user.orgCode ?? "",
    });
  }

  async getCurrentClaims(): Promise<TrustedIdentityClaims> {
    const identity = await this.getCurrentIdentity();
    return {
      externalIdentity: {
        provider: GOOGLE_IDENTITY_PROVIDER_NAME,
        subject: identity.id,
        emp_id: identity.emp_id,
        account: null,
        name_en: null,
        name: identity.name,
        org_code: identity.org_code,
      },
      validatedExternalGroupIds: [],
      platformCapabilities: [],
      refreshedAt: new Date(),
    };
  }
}
