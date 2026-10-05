import { describe, expect, it, vi } from "vitest";
import { PersonalPreferencesService } from "@/modules/personal/application/personal-preferences-service";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import type { WorkspaceUnitOfWork, WorkspaceRepositories } from "@/modules/workspaces/ports/unit-of-work";
import type { PersonalStore } from "@/modules/personal/ports/personal-store";
const caller = callerFromIdentity({ id: "owner", emp_id: "EMP", name: "Owner", org_code: "ORG" });
function fixture(overrides: Record<string, unknown> = {}, membership: string | null = "OWNER") {
  const store = { get: vi.fn().mockResolvedValue(null), list: vi.fn(), put: vi.fn().mockResolvedValue(true) };
  const repositories = {
    workspaces: { findById: vi.fn().mockResolvedValue({ workspaceType: "PERSONAL", lifecycleState: "ACTIVE", personalOwnerUserId: "owner", ...overrides }) },
    workspaceMemberships: { find: vi.fn().mockResolvedValue(membership ? { role: membership } : null) },
  } as unknown as WorkspaceRepositories;
  const uow: WorkspaceUnitOfWork = { run: async (work) => work(repositories) };
  return { store, service: new PersonalPreferencesService(store as PersonalStore, uow) };
}
describe("personal preference persistence boundary", () => {
  it("returns the first-write version and scopes storage to the trusted owner", async () => {
    const { service, store } = fixture();
    expect(await service.get(caller, "mine", "prefs:onboarding")).toMatchObject({ value: null, version: 0 });
    await expect(service.put(caller, "mine", "prefs:onboarding", { dismissed: true }, 0)).resolves.toMatchObject({ version: 1 });
    expect(store.put).toHaveBeenCalledWith("owner", "mine", "prefs:onboarding", { dismissed: true }, 0);
  });
  it.each([{ personalOwnerUserId: "other" }, { workspaceType: "TEAM" }, { lifecycleState: "ARCHIVED" }])("hides an unavailable personal workspace: %j", async (overrides) => {
    const { service, store } = fixture(overrides);
    await expect(service.get(caller, "mine", "prefs:freshness")).rejects.toMatchObject({ code: "WORKSPACE_NOT_FOUND" });
    expect(store.get).not.toHaveBeenCalled();
  });
  it("requires current membership even for the recorded owner", async () => {
    const { service, store } = fixture({}, null);
    await expect(service.get(caller, "mine", "prefs:freshness")).rejects.toMatchObject({ code: "WORKSPACE_NOT_FOUND" });
    expect(store.get).not.toHaveBeenCalled();
  });
  it("honors the caller personal-only boundary", async () => {
    const { service, store } = fixture();
    await expect(service.get({ ...caller, personalWorkspaceOnly: "elsewhere" }, "mine", "prefs:freshness")).rejects.toMatchObject({ code: "WORKSPACE_NOT_FOUND" });
    expect(store.get).not.toHaveBeenCalled();
  });
  it("rejects unrelated item namespaces", async () => {
    const { service, store } = fixture();
    await expect(service.get(caller, "mine", "favorite:doc")).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(store.get).not.toHaveBeenCalled();
  });
  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1])("rejects invalid CAS version %s", async (version) => {
    const { service, store } = fixture();
    await expect(service.put(caller, "mine", "prefs:freshness", {}, version)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(store.put).not.toHaveBeenCalled();
  });
  it("bounds the serialized preference payload", async () => {
    const { service, store } = fixture();
    await expect(service.put(caller, "mine", "prefs:saved-searches", { value: "x".repeat(65536) }, 0)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(store.put).not.toHaveBeenCalled();
  });
  it("rejects a stale write without claiming success", async () => {
    const { service, store } = fixture();
    store.put.mockResolvedValue(false);
    await expect(service.put(caller, "mine", "prefs:freshness", { days: 14 }, 2)).rejects.toMatchObject({ code: "PERSONAL_ITEM_CONFLICT" });
  });
});
