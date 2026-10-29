import { IdentityError } from "@/modules/knowledge/domain/errors";
import type { UserIdentity } from "@/modules/identity/domain/user-identity";
import type { UserRepository } from "@/modules/identity/ports/user-repository";
import type { QueryConnection, DbRow } from "./shared";

function mapUser(row: DbRow): UserIdentity {
  return { id: String(row.id), emp_id: String(row.emp_id), name: String(row.name), org_code: String(row.org_code) };
}

/** One `IN (?…)` batch per statement; well under MariaDB's placeholder limit. */
const USER_ID_CHUNK = 500;

function placeholders(count: number): string {
  return Array(count).fill("?").join(", ");
}

export class MariaDbUserRepository implements UserRepository {
  constructor(private readonly connection: QueryConnection) {}

  async upsertIdentity(identity: UserIdentity): Promise<void> {
    const byId = await this.findById(identity.id);
    const byEmp = await this.findByEmpId(identity.emp_id);
    if (byId && byEmp && byId.id !== byEmp.id) throw new IdentityError("Configured identity id and employee id belong to different users.");
    if (byId && byId.emp_id !== identity.emp_id) throw new IdentityError("Configured identity would change an existing employee id.");
    if (byEmp && byEmp.id !== identity.id) throw new IdentityError("Configured employee id already belongs to another user.");
    if (byId) {
      if (byId.name !== identity.name || byId.org_code !== identity.org_code) {
        await this.connection.query("UPDATE users SET name = ?, org_code = ? WHERE id = ?", [identity.name, identity.org_code, identity.id]);
      }
      return;
    }
    await this.connection.query("INSERT INTO users (id, emp_id, name, org_code) VALUES (?, ?, ?, ?)", [identity.id, identity.emp_id, identity.name, identity.org_code]);
  }

  async searchExisting(query: string, limit: number): Promise<Array<UserIdentity & { nameEn: string | null }>> {
    const bounded = Math.min(50, Math.max(1, Math.floor(limit) || 20));
    const rows = await this.connection.query<DbRow[]>(
      "SELECT id, emp_id, name, name_en, org_code FROM users WHERE LOCATE(LOWER(?), LOWER(name)) > 0 OR LOCATE(LOWER(?), LOWER(emp_id)) > 0 OR (name_en IS NOT NULL AND LOCATE(LOWER(?), LOWER(name_en)) > 0) ORDER BY name ASC, id ASC LIMIT ?",
      [query, query, query, bounded],
    );
    return rows.map(row => ({ ...mapUser(row), nameEn: row.name_en == null ? null : String(row.name_en) }));
  }

  async findById(id: string): Promise<UserIdentity | null> {
    const rows = await this.connection.query<DbRow[]>("SELECT id, emp_id, name, org_code FROM users WHERE id = ?", [id]);
    return rows[0] ? mapUser(rows[0]) : null;
  }

  async findByIds(ids: readonly string[]): Promise<UserIdentity[]> {
    const users: UserIdentity[] = [];
    for (let start = 0; start < ids.length; start += USER_ID_CHUNK) {
      const batch = ids.slice(start, start + USER_ID_CHUNK);
      const rows = await this.connection.query<DbRow[]>(
        `SELECT id, emp_id, name, org_code FROM users WHERE id IN (${placeholders(batch.length)})`,
        [...batch],
      );
      users.push(...rows.map(mapUser));
    }
    return users;
  }

  async findByEmpId(empId: string): Promise<UserIdentity | null> {
    const rows = await this.connection.query<DbRow[]>("SELECT id, emp_id, name, org_code FROM users WHERE emp_id = ?", [empId]);
    return rows[0] ? mapUser(rows[0]) : null;
  }

  async insert(identity: UserIdentity, account: string | null = null, nameEn: string | null = null): Promise<void> {
    await this.connection.query(
      "INSERT INTO users (id, emp_id, account, name_en, name, org_code) VALUES (?, ?, ?, ?, ?, ?)",
      [identity.id, identity.emp_id, account, nameEn, identity.name, identity.org_code],
    );
  }

  async updateAccount(id: string, account: string): Promise<void> {
    await this.connection.query("UPDATE users SET account = ? WHERE id = ?", [account, id]);
  }

  async updateNameEn(id: string, nameEn: string): Promise<void> {
    await this.connection.query("UPDATE users SET name_en = ? WHERE id = ?", [nameEn, id]);
  }

  async updateProfile(id: string, profile: { name: string; org_code: string }): Promise<void> {
    await this.connection.query("UPDATE users SET name = ?, org_code = ? WHERE id = ?", [profile.name, profile.org_code, id]);
  }
}
