import { afterEach, describe, expect, it, vi } from "vitest";
import { runFolderImport } from "@/components/imports/folder-import-form";

vi.mock("@/components/shell/use-workspace-authorization", () => ({
  requestWorkspaceAccessCheck: vi.fn(),
}));

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
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
    await expect(runFolderImport(input)).resolves.toBe("snapshot");
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

  it("bounds exhausted upload retries and preserves the original failure if cleanup is offline", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ snapshotId: "snapshot" }, 201))
      .mockRejectedValue(new TypeError("Offline"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(runFolderImport(input)).rejects.toThrow("Offline");
    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      ["/api/workspaces/workspace/source-imports", "POST"],
      ["/api/source-imports/snapshot/entries", "POST"],
      ["/api/source-imports/snapshot/entries", "POST"],
      ["/api/source-imports/snapshot", "DELETE"],
    ]);
  });
});
