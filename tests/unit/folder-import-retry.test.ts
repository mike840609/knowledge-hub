import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runFolderImport } from "@/components/imports/folder-import-form";

vi.mock("@/components/shell/use-workspace-authorization", () => ({
  requestWorkspaceAccessCheck: vi.fn(),
}));

// Retries wait (1, 2, 4 s, with jitter); fake clocks keep the suite instant. Math.random
// 0.5 makes the jitter factor exactly 1.
beforeEach(() => { vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }); vi.spyOn(Math, "random").mockReturnValue(0.5); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
/** Runs the import to completion, firing retry timers as they come due. */
async function settled<T>(run: Promise<T>): Promise<PromiseSettledResult<T>> {
  const outcome = Promise.allSettled([run]).then(([result]) => result);
  await vi.runAllTimersAsync();
  return outcome;
}
const input = {
  target: { kind: "new", workspaceId: "workspace" } as const,
  files: [new File(["# Hello"], "hello.md")],
  sourceName: "Notes",
  onProgress: vi.fn(),
};
const response = (body: unknown, status = 200) => Response.json(body, { status });

describe("folder import retries and cancellation", () => {
  it("does not create a snapshot when already cancelled, without a custom permission callback", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response({ snapshotId: "snapshot" }, 201));
    vi.stubGlobal("fetch", fetchMock);
    await expect(runFolderImport({ ...input, signal: controller.signal })).rejects.toMatchObject({ code: "IMPORT_CANCELLED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("obtains and abandons the created snapshot when cancellation occurs during create", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn<typeof fetch>()
      .mockImplementationOnce(async () => { controller.abort(); return response({ snapshotId: "snapshot" }, 201); })
      .mockResolvedValue(response({ abandoned: true }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(runFolderImport({ ...input, signal: controller.signal })).rejects.toMatchObject({ code: "IMPORT_CANCELLED" });
    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      ["/api/workspaces/workspace/source-imports", "POST"],
      ["/api/source-imports/snapshot", "DELETE"],
    ]);
  });

  it.each(["network", "body"])("retries the same finalize when its %s response is lost", async (failure) => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ snapshotId: "snapshot" }, 201))
      .mockResolvedValueOnce(response({}));
    if (failure === "network") fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    else fetchMock.mockResolvedValueOnce(new Response('{"snapshotId":', { status: 200 }));
    fetchMock.mockResolvedValueOnce(response({ snapshotId: "snapshot" }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await settled(runFolderImport(input))).toEqual({ status: "fulfilled", value: "snapshot" });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/workspaces/workspace/source-imports",
      "/api/source-imports/snapshot/entries",
      "/api/source-imports/snapshot/finalize",
      "/api/source-imports/snapshot/finalize",
    ]);
  });

  it("stops retries after cancellation, then abandons without reusing the aborted signal", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ snapshotId: "snapshot" }, 201))
      .mockImplementationOnce(async () => { controller.abort(); throw new DOMException("Aborted", "AbortError"); })
      .mockResolvedValueOnce(response({ abandoned: true }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(runFolderImport({ ...input, signal: controller.signal })).rejects.toMatchObject({ code: "IMPORT_CANCELLED" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2][1]).toMatchObject({ method: "DELETE", keepalive: true });
    expect(fetchMock.mock.calls[2][1]?.signal).toBeUndefined();
  });

  it("gives up on a batch after four attempts, abandoning the import and keeping the original failure", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ snapshotId: "snapshot" }, 201))
      .mockRejectedValue(new TypeError("Offline"));
    vi.stubGlobal("fetch", fetchMock);
    const result = await settled(runFolderImport(input));
    expect(result).toMatchObject({ status: "rejected", reason: { message: "Offline" } });
    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      ["/api/workspaces/workspace/source-imports", "POST"],
      ...Array(4).fill(["/api/source-imports/snapshot/entries", "POST"]),
      ["/api/source-imports/snapshot", "DELETE"],
    ]);
  });

  it("rides out a batch failing three times in a row, waiting longer each time", async () => {
    const waits: number[] = [];
    const realSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((handler: () => void, ms?: number) => { waits.push(ms ?? 0); return realSetTimeout(handler, ms); }) as typeof setTimeout);
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ snapshotId: "snapshot" }, 201))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(response({ code: "BUSY" }, 503))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(response({}))
      .mockResolvedValueOnce(response({ snapshotId: "snapshot" }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await settled(runFolderImport(input))).toEqual({ status: "fulfilled", value: "snapshot" });
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/entries"))).toHaveLength(4);
    expect(waits).toEqual([1_000, 2_000, 4_000]);
  });

  it("does not replay a request the server refused for good", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ snapshotId: "snapshot" }, 201))
      .mockResolvedValueOnce(response({ error: { code: "UPLOAD_ENTRY_CONFLICT", message: "Changed bytes." } }, 409))
      .mockResolvedValueOnce(response({ abandoned: true }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await settled(runFolderImport(input))).toMatchObject({ status: "rejected", reason: { code: "UPLOAD_ENTRY_CONFLICT" } });
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/entries"))).toHaveLength(1);
  });

  it("stops waiting to retry the moment the import is cancelled", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ snapshotId: "snapshot" }, 201))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue(response({ abandoned: true }));
    vi.stubGlobal("fetch", fetchMock);
    const run = Promise.allSettled([runFolderImport({ ...input, signal: controller.signal })]);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    controller.abort();
    // No timer is advanced: the wait must end on the abort alone.
    const [result] = await run;
    expect(result).toMatchObject({ status: "rejected", reason: { code: "IMPORT_CANCELLED" } });
    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      ["/api/workspaces/workspace/source-imports", "POST"],
      ["/api/source-imports/snapshot/entries", "POST"],
      ["/api/source-imports/snapshot", "DELETE"],
    ]);
  });
});
