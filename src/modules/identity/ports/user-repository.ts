import type { UserIdentity } from "../domain/user-identity";

export interface UserRepository {
  searchExisting(query: string, limit: number): Promise<Array<UserIdentity & { nameEn: string | null }>>;
  upsertIdentity(identity: UserIdentity): Promise<void>;
  findById(id: string): Promise<UserIdentity | null>;
  /** Batched identity lookup for read-path labels. Unknown ids are omitted. */
  findByIds(ids: readonly string[]): Promise<Array<UserIdentity & { nameEn: string | null }>>;
  findByEmpId(empId: string): Promise<UserIdentity | null>;
  /**
   * Insert a new Hub-owned user. Callers must supply a Hub-generated UUIDv7
   * id; external subject / emp_id values are never valid ids (spec §7.2
   * rule 6). The runtime resolver owns the only creation path for
   * company identities — there is no emp_id auto-attach here. `account` and
   * `nameEn` are trusted company profile fields and are absent for local/Google
   * users.
   */
  insert(identity: UserIdentity, account?: string | null, nameEn?: string | null): Promise<void>;
  /**
   * Store the trusted company account name on an existing Hub user. This is
   * stored profile data, never an identity-link key; local and Google
   * callers never invoke it.
   */
  updateAccount(id: string, account: string): Promise<void>;
  /**
   * Store the optional trusted English display name on an existing Hub user.
   * Like `account`, this is profile data and is never invoked by local/Google.
   */
  updateNameEn(id: string, nameEn: string): Promise<void>;
  /**
   * Sync trusted profile fields on an already-resolved Hub user. Only
   * `name` / `org_code` may change; `emp_id` is never reassigned by
   * resolution (spec §7.2 rules 2 and 7).
   */
  updateProfile(id: string, profile: { name: string; org_code: string }): Promise<void>;
}
