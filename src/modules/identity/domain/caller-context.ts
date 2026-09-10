import type { UserIdentity } from "./user-identity";

export type CallerContext = { identity: UserIdentity };

export function callerFromIdentity(identity: UserIdentity): CallerContext {
  return { identity: { ...identity } };
}
