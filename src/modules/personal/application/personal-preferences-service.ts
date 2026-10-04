import type { CallerContext } from "@/modules/identity/domain/caller-context";
import type { WorkspaceUnitOfWork } from "@/modules/workspaces/ports/unit-of-work";
import type { PersonalStore } from "@/modules/personal/ports/personal-store";
import { evaluateWorkspaceCapabilities, requireWorkspaceRead } from "@/modules/workspaces/application/workspace-authorization";
import { DomainError } from "@/shared/domain/errors";

/** Owner-only preferences. Feature services validate their own payload schemas. */
export class PersonalPreferencesService {
  constructor(private readonly store: PersonalStore, private readonly uow: WorkspaceUnitOfWork) {}
  private async authorize(caller: CallerContext, workspaceId: string, key: string) {
    if (!/^prefs:[a-z-]{1,40}$/.test(key)) throw new DomainError("INVALID_REQUEST", "Invalid preference key.");
    await this.uow.run(async (r) => {
      const workspace = await r.workspaces.findById(workspaceId);
      if (workspace?.workspaceType !== "PERSONAL" || workspace.lifecycleState !== "ACTIVE" || workspace.personalOwnerUserId !== caller.identity.id)
        throw new DomainError("WORKSPACE_NOT_FOUND", "Personal workspace unavailable.");
      requireWorkspaceRead(await evaluateWorkspaceCapabilities(r, caller, workspaceId));
    });
  }
  async get(caller: CallerContext, workspaceId: string, key: string) {
    await this.authorize(caller, workspaceId, key);
    return await this.store.get(caller.identity.id, workspaceId, key) ?? { key, value: null, version: 0, updatedAt: "" };
  }
  async put(caller: CallerContext, workspaceId: string, key: string, value: Record<string, unknown> | null, version: number) {
    await this.authorize(caller, workspaceId, key);
    if (!Number.isSafeInteger(version) || version < 0 || (value !== null && (typeof value !== "object" || Array.isArray(value))) || JSON.stringify(value).length > 65536)
      throw new DomainError("INVALID_REQUEST", "Invalid preference value or version.");
    if (!await this.store.put(caller.identity.id, workspaceId, key, value, version))
      throw new DomainError("PERSONAL_ITEM_CONFLICT", "Preferences changed in another session. Reload and try again.");
    return { key, value, version: version + 1 };
  }
}
