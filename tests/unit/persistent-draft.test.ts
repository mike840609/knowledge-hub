// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PersistentDraft } from "@/lib/persistent-draft";
const draft = { title: "Note", markdown: "Recovery", baseRevisionId: null };
beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it("recovers an account draft and saves against its version", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ value: draft, version: 3 })).mockResolvedValueOnce(Response.json({ version: 4 }));
  vi.stubGlobal("fetch", fetcher);
  const client = new PersistentDraft("/personal", "draft:new", vi.fn());
  expect(await client.load()).toEqual(draft);
  client.change({ ...draft, markdown: "Next" });
  await client.flush();
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({ version: 3, value: { markdown: "Next" } });
});
it("keeps recovery text when another device has changed the draft", async () => {
  const status = vi.fn();
  localStorage.setItem("kh:persistent:/personal:draft:new", JSON.stringify({ value: draft, version: 2 }));
  const fetcher = vi.fn().mockResolvedValue(Response.json({ value: { ...draft, markdown: "Other device" }, version: 3 }));
  vi.stubGlobal("fetch", fetcher);
  const client = new PersistentDraft("/personal", "draft:new", status);
  expect(await client.load()).toEqual(draft);
  client.change({ ...draft, markdown: "Still mine" });
  await client.flush();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(status).toHaveBeenLastCalledWith("conflict");
  expect(localStorage.getItem("kh:persistent:/personal:draft:new")).toContain("Still mine");
});
it("retains failed uploads across a new client instance", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ value: null, version: 0 })).mockRejectedValue(new Error("offline")));
  const client = new PersistentDraft("/personal", "draft:new", vi.fn());
  await client.load(); client.change(draft); await client.flush();
  expect(await new PersistentDraft("/personal", "draft:new", vi.fn()).load()).toEqual(draft);
});
it("discarding a conflicting recovery copy leaves the newer remote draft untouched", async () => {
  localStorage.setItem("kh:persistent:/personal:draft:new", JSON.stringify({ value: draft, version: 2 }));
  const remote = { ...draft, markdown: "Newer remote" };
  const fetcher = vi.fn().mockImplementation(async () => Response.json({ value: remote, version: 3 }));
  vi.stubGlobal("fetch", fetcher);
  const client = new PersistentDraft("/personal", "draft:new", vi.fn());
  await client.load(); await client.clear();
  expect(await new PersistentDraft("/personal", "draft:new", vi.fn()).load()).toEqual(remote);
  expect(fetcher.mock.calls.every(call => call[1]?.method !== "PUT")).toBe(true);
});
