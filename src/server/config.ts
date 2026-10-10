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

/**
 * Whether Team workspaces are open to the people who use the product. They are announced and not yet
 * open: the workspace switcher shows "Coming soon" where they will be, and does not take anyone to one.
 * `KM_TEAM_WORKSPACES_ENABLED=true` opens them; anything else, unset included, keeps them closed. It is
 * read on every request, so opening them later is a configuration change and a restart, not a build.
 *
 * The switcher reads this flag. Trusted callers also receive a personal-only authorization scope while
 * it is closed; the Team's stored membership and lifecycle stay intact for later reopening.
 */
export function teamWorkspacesEnabled(): boolean {
  return process.env.KM_TEAM_WORKSPACES_ENABLED === "true";
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

/**
 * Explicit test-only opt-in permitting the Local identity provider under
 * `NODE_ENV=production` (E2E boots via `next build`/`next start`, which
 * require production mode). Set ONLY via
 * `KM_ALLOW_LOCAL_IDENTITY_IN_PRODUCTION=true` by the E2E harness; never set
 * this in a real company deployment — production readiness still requires the
 * Company SSO provider.
 */
export function allowLocalIdentityInProduction(): boolean {
  return process.env.KM_ALLOW_LOCAL_IDENTITY_IN_PRODUCTION === "true";
}

/** Corporate login initiation/continuation has a separate deployment gate. */
export function reviewLoginAvailable(): boolean { return false; }
export function reviewWritesEnabled(): boolean { return process.env.KM_REVIEW_WRITES_ENABLED === "true"; }
