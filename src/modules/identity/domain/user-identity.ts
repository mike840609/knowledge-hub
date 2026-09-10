export type UserIdentity = {
  id: string;
  emp_id: string;
  name: string;
  org_code: string;
};

export function validateUserIdentity(identity: UserIdentity): UserIdentity {
  const fields: Array<keyof UserIdentity> = ["id", "emp_id", "name", "org_code"];
  for (const field of fields) {
    if (typeof identity[field] !== "string" || identity[field].length === 0) {
      throw new Error(`Identity field ${field} must be a non-empty string.`);
    }
  }
  return { ...identity };
}
