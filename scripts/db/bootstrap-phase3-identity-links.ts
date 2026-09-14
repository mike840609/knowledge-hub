import { readFile } from "node:fs/promises";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { isUuid, uuidv7 } from "@/shared/ids/uuidv7";

/**
 * Phase 3 explicit legacy identity-link bootstrap (spec §7.3).
 *
 * Links pre-existing Hub users to their trusted company provider subjects
 * BEFORE production enable. This script is the ONLY legacy-link path:
 * runtime resolution never claims an existing account by emp_id (it fails
 * `IDENTITY_LINK_REQUIRED` / `IDENTITY_LINK_CONFLICT` instead).
 *
 * Rules (fail closed, single all-or-nothing transaction, rerunnable):
 * - the Hub user target must exist;
 * - `expectedEmpId` is an operator safety assertion only, never the link
 *   key: it must equal the target user's current `emp_id` or the entry is
 *   refused;
 * - `subject` is opaque exact UTF-8 bytes (no trim/lowercase/normalize);
 * - an existing `(provider, subject)` link pointing at a different Hub user,
 *   or an existing `(provider, hub_user)` link with a different subject,
 *   refuses the whole batch;
 * - an identical rerun is a no-op (`alreadyLinked`).
 *
 * Run under canonical-write quiescence. beforeApply checks and the migration
 * advisory lock are NOT application write fences. See
 * docs/operations/phase3-workspace-governance-cutover.md.
 */
export type LegacyIdentityLinkBootstrapEntry = {
  provider: string;
  subject: string;
  hubUserId: string;
  expectedEmpId: string;
};

export type IdentityLinkBootstrapResult = {
  linked: number;
  alreadyLinked: number;
};

export function parseIdentityLinkBootstrapConfig(raw: unknown): { links: LegacyIdentityLinkBootstrapEntry[] } {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Identity-link bootstrap config must be a JSON object with a \"links\" array.");
  }
  const links = (raw as { links?: unknown }).links;
  if (!Array.isArray(links)) {
    throw new Error("Identity-link bootstrap config must contain a \"links\" array.");
  }
  return { links: links.map((entry, index) => assertBootstrapEntry(entry, index)) };
}

function assertBootstrapEntry(entry: unknown, index: number): LegacyIdentityLinkBootstrapEntry {
  const label = `identity-link entry ${index}`;
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error(`Identity-link bootstrap refused: ${label} must be an object.`);
  }
  const { provider, subject, hubUserId, expectedEmpId } = entry as Record<string, unknown>;
  if (typeof provider !== "string" || provider.length === 0) {
    throw new Error(`Identity-link bootstrap refused: ${label} has an empty provider.`);
  }
  if (typeof subject !== "string" || subject.length === 0) {
    throw new Error(`Identity-link bootstrap refused: ${label} has an empty subject.`);
  }
  if (typeof hubUserId !== "string" || !isUuid(hubUserId)) {
    throw new Error(`Identity-link bootstrap refused: ${label} hubUserId is not a UUID.`);
  }
  if (typeof expectedEmpId !== "string" || expectedEmpId.length === 0) {
    throw new Error(`Identity-link bootstrap refused: ${label} has an empty expectedEmpId.`);
  }
  return { provider, subject, hubUserId, expectedEmpId };
}

export async function bootstrapIdentityLinks(
  pool: Pool,
  entries: readonly LegacyIdentityLinkBootstrapEntry[],
): Promise<IdentityLinkBootstrapResult> {
  const normalized = entries.map((entry, index) => assertBootstrapEntry(entry, index));
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    let linked = 0;
    let alreadyLinked = 0;
    for (const entry of normalized) {
      const subjectBytes = Buffer.from(entry.subject, "utf8");
      const users = await connection.query<{ emp_id: string }[]>("SELECT emp_id FROM users WHERE id = ? FOR UPDATE", [entry.hubUserId]);
      if (users.length === 0) {
        throw new Error(
          `Identity-link bootstrap refused: hub user ${entry.hubUserId} does not exist (provider=${entry.provider}).`,
        );
      }
      const actualEmpId = String(users[0].emp_id);
      if (actualEmpId !== entry.expectedEmpId) {
        throw new Error(
          `Identity-link bootstrap refused: expected_emp_id mismatch for hub user ${entry.hubUserId} ` +
            `(expected=${entry.expectedEmpId}); refusing to guess the link target.`,
        );
      }
      const bySubject = await connection.query<{ hub_user_id: string }[]>(
        "SELECT hub_user_id FROM external_identity_links WHERE provider = ? AND subject_bytes = ? FOR UPDATE",
        [entry.provider, subjectBytes],
      );
      if (bySubject.length > 0) {
        if (String(bySubject[0].hub_user_id) !== entry.hubUserId) {
          throw new Error(
            `Identity-link bootstrap refused: provider ${entry.provider} subject is already linked to a different hub user (conflict, failing closed).`,
          );
        }
        alreadyLinked += 1;
        continue;
      }
      const byHubUser = await connection.query<{ subject_bytes: Buffer }[]>(
        "SELECT subject_bytes FROM external_identity_links WHERE provider = ? AND hub_user_id = ? FOR UPDATE",
        [entry.provider, entry.hubUserId],
      );
      if (byHubUser.length > 0) {
        throw new Error(
          `Identity-link bootstrap refused: hub user ${entry.hubUserId} is already linked to a different subject ` +
            `under provider ${entry.provider} (conflict, failing closed).`,
        );
      }
      await connection.query(
        "INSERT INTO external_identity_links (id, provider, subject_bytes, hub_user_id) VALUES (?, ?, ?, ?)",
        [uuidv7(), entry.provider, subjectBytes, entry.hubUserId],
      );
      linked += 1;
    }
    await connection.commit();
    return { linked, alreadyLinked };
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      /* preserve the original failure */
    }
    throw error;
  } finally {
    connection.release();
  }
}

const IDENTITY_LINK_BOOTSTRAP_HELP = `Usage: npx tsx scripts/db/bootstrap-phase3-identity-links.ts --config <path> [--target dev|test|e2e]

Explicit legacy identity-link bootstrap (migration 008 only; never applies
009). Links each pre-existing Hub user to its trusted company provider
subject. This script is the ONLY legacy-link path: runtime resolution never
claims an existing account by emp_id.

Config shape:

  { "links": [{ "provider": "company-sso", "subject": "<opaque-subject>",
                "hubUserId": "<existing-hub-user-id>",
                "expectedEmpId": "<user-emp-id-safety-assertion>" }] }

Rules (fail closed, single all-or-nothing transaction, rerunnable):
- The Hub user target must exist.
- expectedEmpId must equal the target user's current emp_id; it is a safety
  assertion, never the link key.
- subject is opaque exact UTF-8 bytes: no trim, lowercase, or normalization.
- Duplicate provider+subject or provider+hub_user conflicts fail closed.
- Identical reruns are no-ops.

Run under canonical-write quiescence. beforeApply checks and the migration
advisory lock are NOT application write fences. See
docs/operations/phase3-workspace-governance-cutover.md.
`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(IDENTITY_LINK_BOOTSTRAP_HELP);
    return;
  }
  const configIndex = args.indexOf("--config");
  const configPath = configIndex === -1 ? undefined : args[configIndex + 1];
  const targetIndex = args.indexOf("--target");
  const target = targetIndex === -1 ? "dev" : args[targetIndex + 1];
  if (!configPath || (target !== "dev" && target !== "test" && target !== "e2e")) {
    throw new Error("Invalid arguments. Expected: --config <path> [--target dev|test|e2e].");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(configPath, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read identity-link bootstrap config ${configPath}: ${error instanceof Error ? error.message : error}`);
  }
  const { links } = parseIdentityLinkBootstrapConfig(raw);
  const pool = createDatabasePool(databaseConfig(target));
  try {
    const result = await bootstrapIdentityLinks(pool, links);
    console.log(`Identity-link bootstrap complete: ${result.linked} linked, ${result.alreadyLinked} already linked.`);
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
