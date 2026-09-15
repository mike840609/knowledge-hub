import type { UserIdentity } from "./user-identity";
import type { PlatformCapability } from "./trusted-identity-claims";

/**
 * Resolved caller: the Hub-owned `UserIdentity` (durable account truth is
 * `(provider, subject) -> hub_user_id`, never `emp_id`) plus the trusted
 * claims the server validated for this session.
 */
export type AuthenticatedPrincipal = {
  identity: UserIdentity;
  validatedExternalGroupIds: readonly string[];
  platformCapabilities: readonly PlatformCapability[];
  refreshedAt: Date;
};
