import { validateUserIdentity, type UserIdentity } from "@/modules/identity/domain/user-identity";
import { IdentityError } from "@/modules/knowledge/domain/errors";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new IdentityError(`Missing required server identity configuration: ${name}.`);
  return value;
}

export function localIdentityEnabled(): boolean {
  return process.env.KM_LOCAL_IDENTITY_ENABLED === "true";
}

export function localIdentityConfig(): UserIdentity {
  if (!localIdentityEnabled()) throw new IdentityError("Local identity is disabled; configure a trusted identity provider.");
  return validateUserIdentity({
    id: required("KM_LOCAL_ID"),
    emp_id: required("KM_LOCAL_EMP_ID"),
    name: required("KM_LOCAL_NAME"),
    org_code: required("KM_LOCAL_ORG_CODE"),
  });
}
