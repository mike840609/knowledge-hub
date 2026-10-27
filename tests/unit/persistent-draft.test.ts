// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PersistentDraft } from "@/lib/persistent-draft";
const draft = { title: "Note", markdown: "Recovery", baseRevisionId: null };
beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
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
it("inline autosave keeps local recovery without uploading successful edits twice", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ value: null, version: 0 }));
  vi.stubGlobal("fetch", fetcher);
  const client = new PersistentDraft("/personal", "draft:doc", vi.fn(), { autoSync: false });
  await client.load();
  client.change(draft);
  await vi.advanceTimersByTimeAsync(20000);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem("kh:persistent:/personal:draft:doc")).toContain("Recovery");
  client.change(null);
  await client.flush();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem("kh:persistent:/personal:draft:doc")).toBeNull();
});
it("stops after a too-large refusal and keeps the local copy", async () => {
  const status = vi.fn();
  const fetcher = vi.fn()
    .mockResolvedValueOnce(Response.json({ value: null, version: 0 }))
    .mockResolvedValueOnce(Response.json({ error: { code: "DRAFT_TOO_LARGE", message: "Draft is too large to save." } }, { status: 400 }));
  vi.stubGlobal("fetch", fetcher);
  const client = new PersistentDraft("/personal", "draft:doc", status);
  await client.load(); client.change(draft); await client.flush();
  expect(status).toHaveBeenLastCalledWith("too-large");
  await client.retry();
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(localStorage.getItem("kh:persistent:/personal:draft:doc")).toContain("Recovery");
});
it("resumes saving after the text shrinks below the limit", async () => {
  const status = vi.fn();
  const fetcher = vi.fn()
    .mockResolvedValueOnce(Response.json({ value: null, version: 0 }))
    .mockResolvedValueOnce(Response.json({ error: { code: "DRAFT_TOO_LARGE", message: "Draft is too large to save." } }, { status: 400 }))
    .mockResolvedValueOnce(Response.json({ version: 1 }));
  vi.stubGlobal("fetch", fetcher);
  const client = new PersistentDraft("/personal", "draft:doc", status);
  await client.load(); client.change(draft); await client.flush();
  client.change({ ...draft, markdown: "small" }); await client.flush();
  expect(status).toHaveBeenLastCalledWith("saved");
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it("deletes the server copy when discarding an oversized draft", async () => {
  const status = vi.fn();
  const earlier = { ...draft, markdown: "Earlier server copy" };
  const fetcher = vi.fn()
    .mockResolvedValueOnce(Response.json({ value: earlier, version: 1 }))
    .mockResolvedValueOnce(Response.json({ error: { code: "DRAFT_TOO_LARGE", message: "Draft is too large to save." } }, { status: 400 }))
    .mockResolvedValueOnce(Response.json({ version: 2 }));
  vi.stubGlobal("fetch", fetcher);
  const client = new PersistentDraft("/personal", "draft:doc", status);
  await client.load(); client.change(draft); await client.flush();
  expect(status).toHaveBeenLastCalledWith("too-large");
  await client.clear();
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(JSON.parse(fetcher.mock.calls[2][1].body)).toMatchObject({ value: null, version: 1 });
  expect(localStorage.getItem("kh:persistent:/personal:draft:doc")).toBeNull();
});
it("deletes the server copy when discarding while an oversized upload is in flight", async () => {
  const status = vi.fn();
  const earlier = { ...draft, markdown: "Earlier server copy" };
  let refuse!: (response: Response) => void;
  const fetcher = vi.fn()
    .mockResolvedValueOnce(Response.json({ value: earlier, version: 1 }))
    .mockReturnValueOnce(new Promise<Response>(resolve => { refuse = resolve; }))
    .mockResolvedValueOnce(Response.json({ version: 2 }));
  vi.stubGlobal("fetch", fetcher);
  const client = new PersistentDraft("/personal", "draft:doc", status);
  await client.load(); client.change(draft);
  const upload = client.flush();
  const discard = client.clear();
  refuse(Response.json({ error: { code: "DRAFT_TOO_LARGE", message: "Draft is too large to save." } }, { status: 400 }));
  await upload; await discard;
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(JSON.parse(fetcher.mock.calls[2][1].body)).toMatchObject({ value: null, version: 1 });
  expect(localStorage.getItem("kh:persistent:/personal:draft:doc")).toBeNull();
  expect(status).toHaveBeenLastCalledWith("saved");
});
it("saves a smaller edit made while an oversized upload is in flight", async () => {
  const status = vi.fn();
  let refuse!: (response: Response) => void;
  const fetcher = vi.fn()
    .mockResolvedValueOnce(Response.json({ value: null, version: 0 }))
    .mockReturnValueOnce(new Promise<Response>(resolve => { refuse = resolve; }))
    .mockResolvedValueOnce(Response.json({ version: 1 }));
  vi.stubGlobal("fetch", fetcher);
  const client = new PersistentDraft("/personal", "draft:doc", status);
  await client.load(); client.change(draft);
  const upload = client.flush();
  const small = { ...draft, markdown: "small" };
  client.change(small);
  refuse(Response.json({ error: { code: "DRAFT_TOO_LARGE", message: "Draft is too large to save." } }, { status: 400 }));
  await upload;
  expect(JSON.parse(localStorage.getItem("kh:persistent:/personal:draft:doc")!).value).toEqual(small);
  await client.flush();
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(JSON.parse(fetcher.mock.calls[2][1].body)).toMatchObject({ value: small, version: 0 });
  expect(status).toHaveBeenLastCalledWith("saved");
});
it("stays too large when an edit made during an oversized upload is still oversized", async () => {
  const status = vi.fn();
  let refuse!: (response: Response) => void;
  const fetcher = vi.fn()
    .mockResolvedValueOnce(Response.json({ value: null, version: 0 }))
    .mockReturnValueOnce(new Promise<Response>(resolve => { refuse = resolve; }))
    .mockResolvedValue(Response.json({ version: 1 }));
  vi.stubGlobal("fetch", fetcher);
  const client = new PersistentDraft("/personal", "draft:doc", status);
  await client.load(); client.change(draft);
  const upload = client.flush();
  client.change({ ...draft, markdown: "a".repeat(5 * 1024 * 1024 + 1) });
  refuse(Response.json({ error: { code: "DRAFT_TOO_LARGE", message: "Draft is too large to save." } }, { status: 400 }));
  await upload;
  await vi.advanceTimersByTimeAsync(20000);
  await client.flush();
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(status.mock.lastCall?.[0]).toMatch(/^too-large/);
});
it("does not claim a local copy when storage refuses an oversized draft", async () => {
  const status = vi.fn();
  const fetcher = vi.fn()
    .mockResolvedValueOnce(Response.json({ value: null, version: 0 }))
    .mockResolvedValueOnce(Response.json({ error: { code: "DRAFT_TOO_LARGE", message: "Draft is too large to save." } }, { status: 400 }));
  vi.stubGlobal("fetch", fetcher);
  const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
  try {
    const client = new PersistentDraft("/personal", "draft:doc", status);
    await client.load(); client.change(draft); await client.flush();
    expect(status).toHaveBeenLastCalledWith("too-large-unstored");
  } finally {
    setItem.mockRestore();
  }
});
it("flushes recovery on failure or leaving, then clears only the uploaded draft", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ value: null, version: 0 }))
    .mockResolvedValueOnce(Response.json({ version: 1 })).mockResolvedValueOnce(Response.json({ version: 2 }));
  vi.stubGlobal("fetch", fetcher);
  const client = new PersistentDraft("/personal", "draft:doc", vi.fn(), { autoSync: false });
  await client.load(); client.change(draft); await client.flush();
  client.change(null); await client.flush();
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(JSON.parse(fetcher.mock.calls[2][1].body)).toMatchObject({ value: null, version: 1 });
  client.change(null); await client.flush();
  expect(fetcher).toHaveBeenCalledTimes(3);
});
