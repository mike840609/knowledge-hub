import { describe, expect, it, vi } from "vitest";
import { parseOnboardingPreference } from "@/modules/personal/domain/onboarding";
import { GET, PUT } from "@/app/api/workspaces/[workspaceId]/onboarding/route";
const preferences = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock("@/server/workspace-http", () => ({ workspaceHttp: async (work: (services: unknown, caller: unknown) => unknown) => work({ personalPreferences: preferences }, { identity: { id: "owner" } }) }));
const context = { params: Promise.resolve({ workspaceId: "personal" }) };
describe("onboarding preference boundary", () => {
  it.each([null, [], { schemaVersion: 2, dismissed: true }, { schemaVersion: 1, dismissed: "true" }, { schemaVersion: 1, dismissed: true, key: "prefs:other" }])("rejects malformed feature payload %j", value => expect(() => parseOnboardingPreference(value)).toThrow());
  it("reads the feature key and defaults a missing value", async () => {
    preferences.get.mockResolvedValue({ value: null, version: 0 });
    expect(await GET(new Request("http://test"), context)).toEqual({ value: { schemaVersion: 1, dismissed: true }, version: 0 });
    expect(preferences.get).toHaveBeenLastCalledWith({ identity: { id: "owner" } }, "personal", "prefs:onboarding");
  });
  it("passes a strict value and expected version to owner-only persistence", async () => {
    preferences.get.mockResolvedValue({ value: null, version: 0 });
    preferences.put.mockResolvedValue({ version: 1 });
    await PUT(new Request("http://test", { method: "PUT", body: JSON.stringify({ value: { schemaVersion: 1, dismissed: true }, version: 0 }) }), context);
    expect(preferences.put).toHaveBeenLastCalledWith({ identity: { id: "owner" } }, "personal", "prefs:onboarding", { schemaVersion: 1, dismissed: true }, 0);
  });
  it("authorizes before parsing and never writes denied preferences", async () => {
    preferences.put.mockClear(); preferences.get.mockRejectedValueOnce(new Error("Personal workspace unavailable"));
    await expect(PUT(new Request("http://test", { method: "PUT", body: "malformed" }), context)).rejects.toThrow("Personal workspace unavailable");
    expect(preferences.put).not.toHaveBeenCalled();
  });
});
