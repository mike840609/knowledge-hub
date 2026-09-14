import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUserRepository } from "@/infrastructure/database/mariadb/repositories/users";
import { MariaDbExternalIdentityLinkRepository } from "@/infrastructure/database/mariadb/repositories/external-identity-links";
import { mapDatabaseError } from "@/infrastructure/database/mariadb/repositories/shared";
import { HubIdentityResolver, type HubIdentityRepositories, type HubIdentityUnitOfWork } from "@/modules/identity/application/hub-identity-resolver";
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
});
