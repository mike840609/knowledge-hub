import { CompanySsoIdentityProvider } from "@/infrastructure/identity/company-sso-identity-provider";
import { LocalIdentityProvider } from "@/infrastructure/identity/local-identity-provider";
import type { IdentityProvider } from "@/modules/identity/ports/identity-provider";
import type { CompanySsoSessionReader } from "@/modules/identity/ports/company-sso-session-reader";
import { IdentityError } from "@/modules/knowledge/domain/errors";
import {
  companySsoProviderName,
  companySsoTeamCreateGroups,
  identityProviderKind,
  isProductionEnvironment,
} from "./config";

export type IdentityProviderFactoryDeps = {
  companySessionReader?: CompanySsoSessionReader;
};

/**
 * Select the trusted identity provider from server-side configuration
 * (spec §7.4). Production fails closed: a missing Company SSO session
 * integration throws at startup/readiness, and Local is never a silent
 * production fallback.
 */
export function createIdentityProvider(deps: IdentityProviderFactoryDeps = {}): IdentityProvider {
  const kind = identityProviderKind();
  if (kind === "company-sso") {
    if (!deps.companySessionReader) {
      throw new IdentityError(
        "Company SSO provider is configured but no server-side session reader is wired; refusing to start without trusted session integration.",
      );
    }
    return new CompanySsoIdentityProvider(deps.companySessionReader, {
      provider: companySsoProviderName(),
      teamCreateGroupIds: companySsoTeamCreateGroups(),
    });
  }
  if (isProductionEnvironment()) {
    throw new IdentityError("Local identity provider is not allowed in production; configure the Company SSO provider.");
  }
  return new LocalIdentityProvider();
}
