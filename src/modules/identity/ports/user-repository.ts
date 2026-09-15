import type { UserIdentity } from "../domain/user-identity";

export interface UserRepository {
  upsertIdentity(identity: UserIdentity): Promise<void>;
  findById(id: string): Promise<UserIdentity | null>;
  findByEmpId(empId: string): Promise<UserIdentity | null>;
  /**
   * Insert a new Hub-owned user. Callers must supply a Hub-generated UUIDv7
   * id; external subject / emp_id values are never valid ids (spec §7.2
   * rule 6). The runtime resolver owns the only creation path for
   * company identities — there is no emp_id auto-attach here.
   */
  insert(identity: UserIdentity): Promise<void>;
  /**
   * Sync trusted profile fields on an already-resolved Hub user. Only
   * `name` / `org_code` may change; `emp_id` is never reassigned by
   * resolution (spec §7.2 rules 2 and 7).
   */
  updateProfile(id: string, profile: { name: string; org_code: string }): Promise<void>;
}
