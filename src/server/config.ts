import { validateUserIdentity, type UserIdentity } from "@/modules/identity/domain/user-identity";
import { IdentityError } from "@/modules/knowledge/domain/errors";
import { isUuid } from "@/shared/ids/uuidv7";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new IdentityError(`Missing required server identity configuration: ${name}.`);
  return value;
}

export function localIdentityEnabled(): boolean {
  return process.env.KM_LOCAL_IDENTITY_ENABLED === "true";
}

export function localIdentityConfig(): UserIdentity {
  if (!localIdentityEnabled()) throw new IdentityError("Local identity is disabled; configure a trusted identity provider.");
  return validateUserIdentity({
    id: required("KM_LOCAL_ID"),
    emp_id: required("KM_LOCAL_EMP_ID"),
    name: required("KM_LOCAL_NAME"),
    org_code: required("KM_LOCAL_ORG_CODE"),
  });
}

export type IdentityProviderKind = "local" | "company-sso";

export function identityProviderKind(): IdentityProviderKind {
  const raw = process.env.KM_IDENTITY_PROVIDER ?? "local";
  if (raw !== "local" && raw !== "company-sso") {
    throw new IdentityError(`Unknown identity provider: ${raw}; expected "local" or "company-sso".`);
  }
  return raw;
}

export function companySsoProviderName(): string {
  return process.env.KM_COMPANY_SSO_PROVIDER ?? "company-sso";
}

export function companySsoTeamCreateGroups(): readonly string[] {
  const raw = process.env.KM_COMPANY_SSO_TEAM_CREATE_GROUPS ?? "";
  return raw
    .split(",")
    .map((group) => group.trim())
    .filter((group) => group.length > 0);
}

/**
 * Explicit rollout-scope Hub user IDs whose company-provider identity links
 * production readiness requires. Comma-separated UUIDs via
 * KM_COMPANY_SSO_ROLLOUT_USER_IDS; unset means every existing Hub user.
 */
export function companySsoRolloutHubUserIds(): readonly string[] | undefined {
  const raw = (process.env.KM_COMPANY_SSO_ROLLOUT_USER_IDS ?? "").trim();
  if (raw.length === 0) return undefined;
  const ids = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  for (const id of ids) {
    if (!isUuid(id)) throw new IdentityError(`Invalid company SSO rollout scope: not a UUID: ${id}.`);
  }
  return ids;
}

export function isProductionEnvironment(): boolean {
  return process.env.NODE_ENV === "production";
}
