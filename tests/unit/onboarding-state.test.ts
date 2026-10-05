import { describe, expect, it, vi } from "vitest";
import type { CallerContext } from "@/modules/identity/domain/caller-context";
import { getHomeOnboardingState } from "@/server/onboarding-state";
import { DomainError } from "@/shared/domain/errors";
const caller = { identity: { id: "owner" } } as CallerContext;
const visible = { schemaVersion: 1 as const, dismissed: false };
const hidden = { schemaVersion: 1 as const, dismissed: true };
function preferences() {
  return {
    get: vi.fn().mockResolvedValue({ value: null, version: 0 }),
    put: vi.fn().mockResolvedValue({ value: visible, version: 1 }),
  };
}
describe("Home onboarding enrolment", () => {
  it("keeps an existing workspace hidden without writing a preference", async () => {
    const p = preferences();
    expect(await getHomeOnboardingState(p, caller, "ws", true)).toEqual({ value: hidden, version: 0 });
    expect(p.put).not.toHaveBeenCalled();
  });
  it("persists enrolment in an empty workspace so guidance survives importing content", async () => {
    const p = preferences();
    expect(await getHomeOnboardingState(p, caller, "ws", false)).toEqual({ value: visible, version: 1 });
    expect(p.put).toHaveBeenCalledWith(caller, "ws", "prefs:onboarding", visible, 0);
    p.get.mockResolvedValue({ value: visible, version: 1 });
    expect(await getHomeOnboardingState(p, caller, "ws", true)).toEqual({ value: visible, version: 1 });
    expect(p.put).toHaveBeenCalledTimes(1);
  });
  it.each([visible, hidden])("honours an explicit reopening or dismissal %j", async value => {
    const p = preferences(); p.get.mockResolvedValue({ value, version: 4 });
    expect(await getHomeOnboardingState(p, caller, "ws", true)).toEqual({ value, version: 4 });
    expect(p.put).not.toHaveBeenCalled();
  });
  it("honours a dismissal saved by another session during enrolment", async () => {
    const p = preferences();
    p.put.mockRejectedValue(new DomainError("PERSONAL_ITEM_CONFLICT", "stale"));
    p.get.mockResolvedValueOnce({ value: null, version: 0 }).mockResolvedValueOnce({ value: hidden, version: 1 });
    expect(await getHomeOnboardingState(p, caller, "ws", false)).toEqual({ value: hidden, version: 1 });
  });
  it("keeps Home available when enrolment persistence fails", async () => {
    const p = preferences(); p.put.mockRejectedValue(new Error("offline"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await getHomeOnboardingState(p, caller, "ws", false)).toEqual({ value: hidden, version: 0 });
  });
});
