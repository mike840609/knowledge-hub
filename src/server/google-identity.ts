import { createHash } from "node:crypto";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { HubIdentityResolver, type HubIdentityUnitOfWork } from "@/modules/identity/application/hub-identity-resolver";
import type { UserIdentity } from "@/modules/identity/domain/user-identity";
import { getDatabasePool } from "./database-pool";

/** A deterministic demo employee id for one Google subject. */
export function googleEmpId(subject: string): string {
  return `DEMO-${createHash("sha256").update(subject).digest("hex").slice(0, 10).toUpperCase()}`;
}

/** Google name first, then the email local-part, then a neutral demo label. */
export function googleDisplayName(name: string, email: string): string {
  const value = name.trim() || email.split("@")[0]?.trim() || "Demo user";
  return value.slice(0, 512);
}

/**
 * Resolve or create the Hub user for a Google account. The existing resolver
 * owns the transaction and the `(provider, subject)` link; the demo supplies
 * the generated emp id and org code.
 */
export async function resolveGoogleIdentity(
  input: { subject: string; name: string; email: string },
  unitOfWork: HubIdentityUnitOfWork = new MariaDbUnitOfWork(getDatabasePool()),
): Promise<UserIdentity> {
  if (!input.subject) throw new Error("Google subject is required.");
  const resolver = new HubIdentityResolver(unitOfWork);
  return resolver.resolve({
    provider: "google",
    subject: input.subject,
    emp_id: googleEmpId(input.subject),
    account: null,
    name_en: null,
    name: googleDisplayName(input.name, input.email),
    org_code: "DEMO",
  });
}
