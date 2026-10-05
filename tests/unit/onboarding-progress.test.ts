import { describe, expect, it, vi } from "vitest";
import type { CallerContext } from "@/modules/identity/domain/caller-context";
import { DomainError } from "@/shared/domain/errors";
import { getOnboardingProgress, recordOnboardingStep } from "@/server/onboarding-progress";
const caller = { identity: { id: "owner" } } as CallerContext;
function preferences() {
  return { get: vi.fn().mockResolvedValue({ value: null, version: 0 }), put: vi.fn().mockResolvedValue({ version: 1 }) };
}
describe("server-owned onboarding progress", () => {
  it("keeps missing steps pending and reads persisted completion independently", async () => {
    const p = preferences();
    p.get.mockImplementation(async (_c, _w, key) => ({ value: key === "prefs:onboarding-search" ? { completed: true } : null, version: 1 }));
    expect(await getOnboardingProgress(p, caller, "personal")).toEqual({ read: false, search: true, context: false });
  });
  it("records an idempotent step without changing dismissal or other steps", async () => {
    const p = preferences();
    await recordOnboardingStep(p, caller, "personal", "read");
    expect(p.put).toHaveBeenCalledWith(caller, "personal", "prefs:onboarding-read", { completed: true }, 0);
    p.get.mockResolvedValue({ value: { completed: true }, version: 1 });
    await recordOnboardingStep(p, caller, "personal", "read");
    expect(p.put).toHaveBeenCalledTimes(1);
  });
  it("accepts another session completing the step during a CAS race", async () => {
    const p = preferences();
    p.put.mockRejectedValueOnce(new DomainError("PERSONAL_ITEM_CONFLICT", "stale"));
    p.get.mockResolvedValueOnce({ value: null, version: 0 }).mockResolvedValueOnce({ value: { completed: true }, version: 1 });
    await recordOnboardingStep(p, caller, "personal", "context");
    expect(p.put).toHaveBeenCalledTimes(1);
  });
  it("does not write personal progress for team or inaccessible workspaces", async () => {
    const p = preferences();
    p.get.mockRejectedValue(new DomainError("WORKSPACE_NOT_FOUND", "unavailable"));
    await recordOnboardingStep(p, caller, "team", "search");
    expect(p.put).not.toHaveBeenCalled();
    await expect(getOnboardingProgress(p, caller, "team")).rejects.toThrow("unavailable");
  });
  it("does not fail a successful action when auxiliary storage is unavailable", async () => {
    const p = preferences(), warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    p.put.mockRejectedValue(new Error("database offline"));
    await expect(recordOnboardingStep(p, caller, "personal", "search")).resolves.toBeUndefined();
    expect(warning).toHaveBeenCalledWith("Unable to save onboarding progress", "PERSISTENCE_FAILURE");
    warning.mockRestore();
  });
});
