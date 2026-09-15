import { DomainError } from "@/shared/domain/errors";

/**
 * Production application readiness for the Phase 3 cutover (spec §15.4,
 * §19 step 8). Production traffic must switch only when ALL of these hold:
 *
 * 1. Migration 009 is APPLIED (final governance constraints active).
 * 2. The server is configured for the Company SSO provider (`company-sso`).
 * 3. A server-side Company SSO session integration is wired (claims come
 *    from the trusted session, never the browser).
 * 4. Every rollout-scope Hub user has its expected company-provider
 *    identity link (explicit bootstrap output, never runtime emp_id claim).
 *
 * All checks fail closed with the missing piece named. The default rollout
 * scope is every existing Hub user; pass an explicit list to narrow it.
 * Readiness never repairs anything: rerun the named bootstrap/migration,
 * then recheck.
 *
 * The "only writer" half of the cutover (the Phase-3-compatible deployment
 * is the sole canonical writer when maintenance is released) is procedural
 * — see the production cutover runbook — because no query can prove which
 * deployments hold write credentials.
 */

export class ProductionReadinessError extends DomainError {
  constructor(message: string) {
    super("PRODUCTION_READINESS_NOT_READY", message);
    this.name = "ProductionReadinessError";
  }
}

export type ReadinessQuery = <T>(sql: string, params?: unknown[]) => Promise<T>;

export type ProductionReadinessOptions = {
  query: ReadinessQuery;
  identityProviderKind: "local" | "company-sso";
  companySsoProvider: string;
  companySessionReaderConfigured: boolean;
  rolloutHubUserIds?: readonly string[];
};

export type ProductionReadinessSummary = {
  migrationVersion: 9;
  provider: string;
  linkedUsers: number;
  rolloutUsers: number;
};

export async function assertMigration009Applied(query: ReadinessQuery): Promise<void> {
  const rows = await query<{ version: unknown; state: unknown }[]>(
    "SELECT version, state FROM schema_migrations WHERE version = 9",
  );
  if (rows.length !== 1 || String(rows[0].state) !== "APPLIED") {
    throw new ProductionReadinessError(
      "Production readiness refused: migration 009 (phase-3-workspace-governance-finalize) is not APPLIED. Complete the staged cutover through 009, then recheck.",
    );
  }
}

export async function assertRolloutIdentityLinksComplete(
  query: ReadinessQuery,
  provider: string,
  rolloutHubUserIds?: readonly string[],
): Promise<{ linkedUsers: number; rolloutUsers: number }> {
  if (!provider) {
    throw new ProductionReadinessError("Production readiness refused: the company SSO provider name is not configured.");
  }
  const expected =
    rolloutHubUserIds === undefined
      ? (await query<{ id: unknown }[]>("SELECT id FROM users ORDER BY id")).map((row) => String(row.id))
      : [...rolloutHubUserIds];
  const missing: string[] = [];
  for (const hubUserId of expected) {
    const links = await query<{ count: unknown }[]>(
      "SELECT COUNT(*) AS count FROM external_identity_links WHERE provider = ? AND hub_user_id = ?",
      [provider, hubUserId],
    );
    if (Number(links[0]?.count) !== 1) missing.push(hubUserId);
  }
  if (missing.length > 0) {
    throw new ProductionReadinessError(
      `Production readiness refused: ${missing.length} of ${expected.length} rollout-scope Hub users have no ${provider} identity link (${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ` (+${missing.length - 5} more)` : ""}). Run the trusted legacy identity-link bootstrap, then recheck.`,
    );
  }
  return { linkedUsers: expected.length, rolloutUsers: expected.length };
}

export async function assertProductionReadiness(options: ProductionReadinessOptions): Promise<ProductionReadinessSummary> {
  if (options.identityProviderKind !== "company-sso") {
    throw new ProductionReadinessError(
      `Production readiness refused: identity provider is "${options.identityProviderKind}", expected "company-sso" (KM_IDENTITY_PROVIDER). Local identity is never a production fallback.`,
    );
  }
  if (!options.companySessionReaderConfigured) {
    throw new ProductionReadinessError(
      "Production readiness refused: no server-side Company SSO session integration is wired; refusing to authorize production traffic without trusted session claims.",
    );
  }
  await assertMigration009Applied(options.query);
  const links = await assertRolloutIdentityLinksComplete(options.query, options.companySsoProvider, options.rolloutHubUserIds);
  return { migrationVersion: 9, provider: options.companySsoProvider, linkedUsers: links.linkedUsers, rolloutUsers: links.rolloutUsers };
}
