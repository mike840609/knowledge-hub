import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUserRepository } from "@/infrastructure/database/mariadb/repositories/users";
import { MariaDbExternalIdentityLinkRepository } from "@/infrastructure/database/mariadb/repositories/external-identity-links";
import { mapDatabaseError } from "@/infrastructure/database/mariadb/repositories/shared";
import { HubIdentityResolver, type HubIdentityRepositories, type HubIdentityUnitOfWork } from "@/modules/identity/application/hub-identity-resolver";
import { assertProductionReadiness } from "@/modules/workspaces/application/workspace-readiness";
import { bootstrapIdentityLinks } from "../../scripts/db/bootstrap-phase3-identity-links";
import { migrations } from "@/infrastructure/database/mariadb/migrations";
import { runMigrations, type IsolatedDatabaseHandle } from "../../scripts/db/migrate";
import { disposeIsolatedDatabase, provisionIsolatedDatabase } from "../../scripts/db/test-database";
import {
  IdentityLinkConflictError,
  IdentityLinkRequiredError,
} from "@/modules/identity/domain/identity-errors";
import type { ExternalCompanyIdentity } from "@/modules/identity/domain/external-company-identity";
import { DomainError } from "@/shared/domain/errors";
import { isUuid, uuidv7 } from "@/shared/ids/uuidv7";

let pool: Pool;
let unitOfWork: HubIdentityUnitOfWork;
let resolver: HubIdentityResolver;

class MariaDbTestIdentityUnitOfWork implements HubIdentityUnitOfWork {
  constructor(private readonly pool: Pool) {}

  async run<T>(work: (repositories: HubIdentityRepositories) => Promise<T>): Promise<T> {
    const connection = await this.pool.getConnection();
    try {
      await connection.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
      await connection.beginTransaction();
      const result = await work({
        users: new MariaDbUserRepository(connection),
        identityLinks: new MariaDbExternalIdentityLinkRepository(connection),
      });
      await connection.commit();
      return result;
    } catch (error) {
      try {
        await connection.rollback();
      } catch {
        /* preserve the original failure */
      }
      if (error instanceof DomainError) throw error;
      throw mapDatabaseError(error);
    } finally {
      connection.release();
    }
  }
}

function claims(provider: string, subject: string, empId: string, name = "SSO User", org = "RD"): ExternalCompanyIdentity {
  return { provider, subject, emp_id: empId, name, org_code: org };
}

async function countUsersByEmp(empId: string): Promise<number> {
  const rows = await pool.query<{ count: number }[]>("SELECT COUNT(*) AS count FROM users WHERE emp_id = ?", [empId]);
  return Number(rows[0].count);
}

async function countLinks(provider: string, subject: string): Promise<number> {
  const rows = await pool.query<{ count: number }[]>(
    "SELECT COUNT(*) AS count FROM external_identity_links WHERE provider = ? AND subject_bytes = ?",
    [provider, Buffer.from(subject, "utf8")],
  );
  return Number(rows[0].count);
}

async function seedUser(empId: string, name = "Seeded User"): Promise<string> {
  const id = uuidv7();
  await pool.query("INSERT INTO users (id, emp_id, name, org_code) VALUES (?, ?, ?, 'RD')", [id, empId, name]);
  return id;
}

async function seedLink(provider: string, subject: string, hubUserId: string): Promise<void> {
  await pool.query("INSERT INTO external_identity_links (id, provider, subject_bytes, hub_user_id) VALUES (?, ?, ?, ?)", [
    uuidv7(),
    provider,
    Buffer.from(subject, "utf8"),
    hubUserId,
  ]);
}

beforeAll(() => {
  pool = createDatabasePool(databaseConfig("test"));
  unitOfWork = new MariaDbTestIdentityUnitOfWork(pool);
  resolver = new HubIdentityResolver(unitOfWork);
});

afterAll(async () => {
  await pool.end();
});

describe("Hub runtime identity resolution", () => {
  it("A. existing (provider, subject) link resolves to the same Hub UUID", async () => {
    const tag = uuidv7();
    const provider = "company-sso";
    const subject = `subject-A-${tag}`;
    const empId = `EMP-A-${tag}`;
    const hubUserId = await seedUser(empId, "Linked User");
    await seedLink(provider, subject, hubUserId);

    const resolved = await resolver.resolve(claims(provider, subject, empId, "Linked User"));
    expect(resolved.id).toBe(hubUserId);
    expect(resolved.emp_id).toBe(empId);
  });

  it("B. external subject and emp_id never become users.id", async () => {
    const tag = uuidv7();
    const provider = "company-sso";
    const subject = `subject-B-${tag}`;
    const empId = `EMP-B-${tag}`;
    const resolved = await resolver.resolve(claims(provider, subject, empId));
    expect(isUuid(resolved.id)).toBe(true);
    expect(resolved.id).not.toBe(subject);
    expect(resolved.id).not.toBe(empId);
  });

  it("C. missing link plus existing emp_id fails IDENTITY_LINK_REQUIRED without auto-attach", async () => {
    const tag = uuidv7();
    const provider = "company-sso";
    const empId = `EMP-C-${tag}`;
    const hubUserId = await seedUser(empId, "Legacy Owner");
    const subject = `subject-C-${tag}`;

    const failure = await resolver.resolve(claims(provider, subject, empId)).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(IdentityLinkRequiredError);
    expect((failure as DomainError).code).toBe("IDENTITY_LINK_REQUIRED");
    expect(await countLinks(provider, subject)).toBe(0);
    const rows = await pool.query<{ id: string; name: string }[]>("SELECT id, name FROM users WHERE emp_id = ?", [empId]);
    expect(rows.map((row) => String(row.id))).toEqual([hubUserId]);
    expect(rows[0].name).toBe("Legacy Owner");
  });

  it("D. different subject plus emp_id owned by an already-linked user fails IDENTITY_LINK_CONFLICT", async () => {
    const tag = uuidv7();
    const provider = "company-sso";
    const empId = `EMP-D-${tag}`;
    const hubUserId = await seedUser(empId, "Bound User");
    await seedLink(provider, `subject-D-bound-${tag}`, hubUserId);

    const failure = await resolver.resolve(claims(provider, `subject-D-intruder-${tag}`, empId)).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(IdentityLinkConflictError);
    expect((failure as DomainError).code).toBe("IDENTITY_LINK_CONFLICT");
    expect(await countLinks(provider, `subject-D-intruder-${tag}`)).toBe(0);
    const rows = await pool.query<{ id: string }[]>("SELECT id FROM users WHERE emp_id = ?", [empId]);
    expect(rows.map((row) => String(row.id))).toEqual([hubUserId]);
  });

  it("E. missing link plus unused emp_id creates a UUIDv7 user and link atomically", async () => {
    const tag = uuidv7();
    const provider = "company-sso";
    const subject = `subject-E-${tag}`;
    const empId = `EMP-E-${tag}`;

    const first = await resolver.resolve(claims(provider, subject, empId, "First Login", "RD"));
    expect(isUuid(first.id)).toBe(true);
    expect(first.emp_id).toBe(empId);
    expect(await countUsersByEmp(empId)).toBe(1);
    expect(await countLinks(provider, subject)).toBe(1);

    const second = await resolver.resolve(claims(provider, subject, empId, "First Login", "RD"));
    expect(second.id).toBe(first.id);
    expect(await countUsersByEmp(empId)).toBe(1);
    expect(await countLinks(provider, subject)).toBe(1);
  });

  it("F. concurrent identical first-login converges to one user and one link", async () => {
    const tag = uuidv7();
    const provider = "company-sso";
    const subject = `subject-F-${tag}`;
    const empId = `EMP-F-${tag}`;
    const outcomes = await Promise.allSettled(
      Array.from({ length: 8 }, () => resolver.resolve(claims(provider, subject, empId, "Racing Login", "RD"))),
    );
    const ids = outcomes.map((outcome) => {
      expect(outcome.status).toBe("fulfilled");
      if (outcome.status !== "fulfilled") throw new Error("concurrent first-login must converge");
      return outcome.value.id;
    });
    expect(new Set(ids).size).toBe(1);
    expect(await countUsersByEmp(empId)).toBe(1);
    expect(await countLinks(provider, subject)).toBe(1);
  });

  it("G. trusted emp_id drift on an existing subject never relinks another account", async () => {
    const tag = uuidv7();
    const provider = "company-sso";
    const subject = `subject-G-${tag}`;
    const empA = `EMP-G-A-${tag}`;
    const empB = `EMP-G-B-${tag}`;
    const hubUserA = await seedUser(empA, "Drift User");
    const hubUserB = await seedUser(empB, "Other User");
    await seedLink(provider, subject, hubUserA);

    const resolved = await resolver.resolve(claims(provider, subject, empB, "Drifted Name", "IT"));
    expect(resolved.id).toBe(hubUserA);
    expect(resolved.emp_id).toBe(empA);

    const userA = await pool.query<{ id: string; emp_id: string }[]>("SELECT id, emp_id FROM users WHERE id = ?", [hubUserA]);
    expect(userA.map((row) => String(row.emp_id))).toEqual([empA]);
    const userB = await pool.query<{ id: string; emp_id: string }[]>("SELECT id, emp_id FROM users WHERE id = ?", [hubUserB]);
    expect(userB.map((row) => String(row.emp_id))).toEqual([empB]);
    const links = await pool.query<{ hub_user_id: string }[]>(
      "SELECT hub_user_id FROM external_identity_links WHERE provider = ? AND subject_bytes = ?",
      [provider, Buffer.from(subject, "utf8")],
    );
    expect(links.map((row) => String(row.hub_user_id))).toEqual([hubUserA]);
  });

  it("H. explicitly bootstrapped legacy link resolves at runtime; wrong expected_emp_id never links", async () => {
    const tag = uuidv7();
    const provider = "company-sso";
    const subject = `subject-H-${tag}`;
    const empId = `EMP-H-${tag}`;
    const hubUserId = await seedUser(empId, "Legacy Bootstrap User");

    const refusal = await bootstrapIdentityLinks(pool, [
      { provider, subject, hubUserId, expectedEmpId: "EMP-WRONG" },
    ]).then(
      () => null,
      (error: unknown) => error,
    );
    expect(refusal).toBeInstanceOf(Error);
    expect(await countLinks(provider, subject)).toBe(0);

    const result = await bootstrapIdentityLinks(pool, [{ provider, subject, hubUserId, expectedEmpId: empId }]);
    expect(result.linked).toBe(1);

    const resolved = await resolver.resolve(claims(provider, subject, empId, "Legacy Bootstrap User"));
    expect(resolved.id).toBe(hubUserId);
    expect(resolved.emp_id).toBe(empId);
    expect(await countUsersByEmp(empId)).toBe(1);
  });
});

describe("Production readiness (Task 11)", () => {
  function bind(target: Pool): <T>(sql: string, params?: unknown[]) => Promise<T> {
    return <T>(sql: string, params?: unknown[]): Promise<T> => target.query(sql, params) as Promise<T>;
  }

  async function createIsolatedPool(): Promise<{ handle: IsolatedDatabaseHandle; pool: Pool }> {
    const handle = await provisionIsolatedDatabase("test");
    const previous = process.env.KM_TEST_DB_NAME;
    process.env.KM_TEST_DB_NAME = handle.databaseName;
    try {
      return { handle, pool: createDatabasePool(databaseConfig("test")) };
    } finally {
      if (previous === undefined) delete process.env.KM_TEST_DB_NAME;
      else process.env.KM_TEST_DB_NAME = previous;
    }
  }

  async function disposePool(handle: IsolatedDatabaseHandle, target: Pool): Promise<void> {
    await target.end();
    await disposeIsolatedDatabase(handle);
  }

  it("fails closed when the identity provider is not company-sso", async () => {
    await expect(
      assertProductionReadiness({
        query: bind(pool),
        identityProviderKind: "local",
        companySsoProvider: "company-sso",
        companySessionReaderConfigured: true,
      }),
    ).rejects.toThrow(/company-sso/i);
  });

  it("fails closed when no company session integration is wired", async () => {
    await expect(
      assertProductionReadiness({
        query: bind(pool),
        identityProviderKind: "company-sso",
        companySsoProvider: "company-sso",
        companySessionReaderConfigured: false,
      }),
    ).rejects.toThrow(/session/i);
  });

  it("fails closed when migration 009 is not applied", async () => {
    const { handle, pool: stagedPool } = await createIsolatedPool();
    try {
      await runMigrations(stagedPool, migrations, { to: 8 });
      await expect(
        assertProductionReadiness({
          query: bind(stagedPool),
          identityProviderKind: "company-sso",
          companySsoProvider: "company-sso",
          companySessionReaderConfigured: true,
        }),
      ).rejects.toThrow(/009|migration/i);
    } finally {
      await disposePool(handle, stagedPool);
    }
  });

  it("fails closed when a rollout-scope user has no company-provider link", async () => {
    const { handle, pool: stagedPool } = await createIsolatedPool();
    try {
      await runMigrations(stagedPool, migrations);
      const linkedId = uuidv7();
      const missingId = uuidv7();
      await stagedPool.query("INSERT INTO users (id, emp_id, name, org_code) VALUES (?, ?, 'Linked User', 'RD'), (?, ?, 'Missing User', 'RD')", [
        linkedId,
        `RDY-LINKED-${linkedId.slice(0, 8)}`,
        missingId,
        `RDY-MISSING-${missingId.slice(0, 8)}`,
      ]);
      await bootstrapIdentityLinks(stagedPool, [
        { provider: "company-sso", subject: `readiness-subject-${uuidv7()}`, hubUserId: linkedId, expectedEmpId: `RDY-LINKED-${linkedId.slice(0, 8)}` },
      ]);
      await expect(
        assertProductionReadiness({
          query: bind(stagedPool),
          identityProviderKind: "company-sso",
          companySsoProvider: "company-sso",
          companySessionReaderConfigured: true,
        }),
      ).rejects.toThrow(new RegExp(missingId));
    } finally {
      await disposePool(handle, stagedPool);
    }
  });

  it("passes with 009 applied, company-sso session, and complete rollout links", async () => {
    const { handle, pool: stagedPool } = await createIsolatedPool();
    try {
      await runMigrations(stagedPool, migrations);
      const userId = uuidv7();
      const empId = `RDY-READY-${userId.slice(0, 8)}`;
      await stagedPool.query("INSERT INTO users (id, emp_id, name, org_code) VALUES (?, ?, 'Ready User', 'RD')", [userId, empId]);
      await bootstrapIdentityLinks(stagedPool, [
        { provider: "company-sso", subject: `readiness-ready-${uuidv7()}`, hubUserId: userId, expectedEmpId: empId },
      ]);
      const summary = await assertProductionReadiness({
        query: bind(stagedPool),
        identityProviderKind: "company-sso",
        companySsoProvider: "company-sso",
        companySessionReaderConfigured: true,
      });
      expect(summary).toMatchObject({ migrationVersion: 9, provider: "company-sso", linkedUsers: 1, rolloutUsers: 1 });
    } finally {
      await disposePool(handle, stagedPool);
    }
  });
});
