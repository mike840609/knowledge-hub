import { AuthUnavailableError } from "@/modules/identity/domain/identity-session-errors";
import { CompanySsoIdentityProvider } from "@/infrastructure/identity/company-sso-identity-provider";
import { GoogleIdentityProvider } from "@/infrastructure/identity/google-identity-provider";
import { LocalIdentityProvider } from "@/infrastructure/identity/local-identity-provider";
import type { IdentityProvider } from "@/modules/identity/ports/identity-provider";
import type { CompanySsoSessionReader } from "@/modules/identity/ports/company-sso-session-reader";
import { IdentityError } from "@/modules/knowledge/domain/errors";
import {
  allowLocalIdentityInProduction,
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
      throw new AuthUnavailableError({
        cause: new IdentityError("Company SSO provider is configured but no server-side session reader is wired; refusing to start without trusted session integration."),
      });
    }
    return new CompanySsoIdentityProvider(deps.companySessionReader, {
      provider: companySsoProviderName(),
      teamCreateGroupIds: companySsoTeamCreateGroups(),
    });
  }
  if (kind === "google") {
    for (const name of ["AUTH_SECRET", "AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET"]) {
      if (!(process.env[name] ?? "").trim()) throw new IdentityError(`Google identity requires ${name}.`);
    }
    return new GoogleIdentityProvider(async () => {
      const { auth } = await import("@/auth");
      return auth();
    });
  }
  if (isProductionEnvironment()) {
    // Test/E2E only: the E2E harness sets KM_ALLOW_LOCAL_IDENTITY_IN_PRODUCTION
    // explicitly to boot next start with local identity. Never set in a real
    // company deployment; production readiness still requires company-sso.
    if (allowLocalIdentityInProduction()) return new LocalIdentityProvider();
    throw new IdentityError("Local identity provider is not allowed in production; configure the Company SSO provider.");
  }
  return new LocalIdentityProvider();
}
