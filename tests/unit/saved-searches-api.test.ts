import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ preferences: { get: vi.fn(), put: vi.fn() }, listSources: vi.fn() }));
vi.mock("@/server/workspace-http", () => ({ workspaceHttp: async (work: (s: unknown, c: unknown) => unknown) => work({ personalPreferences: mocks.preferences, queries: { listSources: mocks.listSources } }, { identity: { id: "owner" } }) }));
import { GET, PUT } from "@/app/api/workspaces/[workspaceId]/saved-searches/route";
const context = { params: Promise.resolve({ workspaceId: "personal" }) };
const filters = { q: "query", scope: "workspace", source: "source", path: "", from: "", to: "", offset: "480", sort: "newest", archived: false };
const searches = [{ id: "one", name: "View", filters }];
const request = (data: unknown) => new Request("http://local", { method: "PUT", body: JSON.stringify(data) });
beforeEach(() => { mocks.preferences.get.mockReset().mockResolvedValue({ value: null, version: 0 }); mocks.preferences.put.mockReset().mockResolvedValue({ version: 1 }); mocks.listSources.mockReset().mockResolvedValue([{ id: "source" }]); });
it("uses a fixed feature key and returns an empty first-use list", async () => {
  expect(await GET(new Request("http://local?key=other"), context)).toEqual({ searches: [], version: 0 });
  expect(mocks.preferences.get).toHaveBeenCalledWith({ identity: { id: "owner" } }, "personal", "prefs:saved-searches");
});
it("checks ownership before parsing or listing sources", async () => {
  mocks.preferences.get.mockRejectedValue(new Error("hidden"));
  await expect(PUT(request({}), context)).rejects.toThrow("hidden");
  expect(mocks.listSources).not.toHaveBeenCalled(); expect(mocks.preferences.put).not.toHaveBeenCalled();
});
it("rejects foreign source filters without persisting", async () => {
  mocks.listSources.mockResolvedValue([]);
  await expect(PUT(request({ version: 0, searches }), context)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  expect(mocks.preferences.put).not.toHaveBeenCalled();
});
it("rejects unexpected top-level keys", async () => {
  await expect(PUT(request({ version: 0, searches, userId: "other" }), context)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  expect(mocks.preferences.put).not.toHaveBeenCalled();
});
it("passes the expected version and propagates conflicts", async () => {
  mocks.preferences.put.mockRejectedValue(new Error("conflict"));
  await expect(PUT(request({ version: 2, searches }), context)).rejects.toThrow("conflict");
  expect(mocks.preferences.put).toHaveBeenCalledWith({ identity: { id: "owner" } }, "personal", "prefs:saved-searches", { searches }, 2);
});
