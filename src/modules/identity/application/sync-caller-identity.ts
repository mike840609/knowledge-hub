import type { CallerContext } from "../domain/caller-context";
import type { UserRepository } from "../ports/user-repository";

/**
 * Makes sure the caller's Hub user row exists and carries its current name
 * and org, as every service does before it reads or writes on the caller's
 * behalf. A caller the request bootstrap has already synced is not synced
 * again: within one request that is the same row, read back unchanged, once
 * per service call.
 */
export async function syncCallerIdentity(users: Pick<UserRepository, "upsertIdentity">, caller: CallerContext): Promise<void> {
  if (caller.identitySynced) return;
  await users.upsertIdentity(caller.identity);
}
