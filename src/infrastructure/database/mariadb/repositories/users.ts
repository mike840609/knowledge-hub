import { IdentityError } from "@/modules/knowledge/domain/errors";
import type { UserIdentity } from "@/modules/identity/domain/user-identity";
import type { UserRepository } from "@/modules/identity/ports/user-repository";
import type { QueryConnection, DbRow } from "./shared";

function mapUser(row: DbRow): UserIdentity {
  return { id: String(row.id), emp_id: String(row.emp_id), name: String(row.name), org_code: String(row.org_code) };
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

  async findById(id: string): Promise<UserIdentity | null> {
    const rows = await this.connection.query<DbRow[]>("SELECT id, emp_id, name, org_code FROM users WHERE id = ?", [id]);
    return rows[0] ? mapUser(rows[0]) : null;
  }

  async findByEmpId(empId: string): Promise<UserIdentity | null> {
    const rows = await this.connection.query<DbRow[]>("SELECT id, emp_id, name, org_code FROM users WHERE emp_id = ?", [empId]);
    return rows[0] ? mapUser(rows[0]) : null;
  }
}
