import type { ExternalCompanyIdentity } from "./external-company-identity";

/**
 * Server-side platform capabilities granted to a caller by trusted
 * configuration (never by browser parameters). `workspace.create_team`
 * gates Team Workspace creation; it is not a Workspace role capability.
 */
export type PlatformCapability = "workspace.create_team";

/**
 * Server-validated claims established by the trusted identity provider:
 * the external company identity plus validated group IDs and platform
 * capabilities resolved server-side, with the time they were refreshed.
 */
export type TrustedIdentityClaims = {
  externalIdentity: ExternalCompanyIdentity;
  validatedExternalGroupIds: readonly string[];
  platformCapabilities: readonly PlatformCapability[];
  refreshedAt: Date;
};
