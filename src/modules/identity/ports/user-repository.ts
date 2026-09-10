import type { UserIdentity } from "../domain/user-identity";

export interface UserRepository {
  upsertIdentity(identity: UserIdentity): Promise<void>;
  findById(id: string): Promise<UserIdentity | null>;
  findByEmpId(empId: string): Promise<UserIdentity | null>;
}
