import { afterEach, describe, expect, it, vi } from "vitest";
import { runFolderImport } from "@/components/imports/folder-import-form";
import { requestWorkspaceAccessCheck } from "@/components/shell/use-workspace-authorization";

vi.mock("@/components/shell/use-workspace-authorization", () => ({
  requestWorkspaceAccessCheck: vi.fn(),
  useWorkspaceAuthorization: vi.fn(),
}));

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
const target = { kind: "new", workspaceId: "workspace" } as const;
const revoked = Object.assign(new Error("Workspace access changed."), { code: "WORKSPACE_ACCESS_CHANGED" });
function markdownFiles(count: number) {
  return Array.from({ length: count }, (_, index) => new File([`# File ${index}`], `file-${String(index).padStart(2, "0")}.md`));
}
function response(body: unknown, status = 200) { return Response.json(body, { status }); }

describe("folder import stops writes when authorization changes", () => {
  it("stops after the first 20-file upload without sending later batches or finalize", async () => {
    let allowed = true;
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(response({ snapshotId: "snapshot" }, 201))
      .mockImplementationOnce(async () => { allowed = false; return response({}); });
    vi.stubGlobal("fetch", fetchMock);
    await expect(runFolderImport({ target, files: markdownFiles(45), sourceName: "Notes", onProgress: vi.fn(),
      assertAllowed: () => { if (!allowed) throw revoked; },
    })).rejects.toMatchObject({ code: "WORKSPACE_ACCESS_CHANGED" });
    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method ?? "GET"])).toEqual([
      ["/api/workspaces/workspace/source-imports", "POST"],
      ["/api/source-imports/snapshot/entries", "POST"],
      ["/api/source-imports/snapshot", "DELETE"],
    ]);
    const form = fetchMock.mock.calls[1][1]?.body as FormData;
    expect(JSON.parse(String(form.get("entries")))).toHaveLength(20);
  });

  it("rechecks after the last upload before finalization", async () => {
    let allowed = true;
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(response({ snapshotId: "snapshot" }, 201))
      .mockImplementationOnce(async () => { allowed = false; return response({}); });
    vi.stubGlobal("fetch", fetchMock);
    await expect(runFolderImport({ target, files: markdownFiles(1), sourceName: "Notes", onProgress: vi.fn(),
      assertAllowed: () => { if (!allowed) throw revoked; },
    })).rejects.toMatchObject({ code: "WORKSPACE_ACCESS_CHANGED" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/finalize"))).toBe(false);
    expect(fetchMock.mock.calls[2]?.[0]).toBe("/api/source-imports/snapshot");
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({ method: "DELETE", keepalive: true });
  });

  it("does not create a session when access changes while the asset manifest is being prepared", async () => {
    let allowed = true;
    const file = new File(["asset"], "image.png", { type: "image/png" });
    vi.spyOn(file, "arrayBuffer").mockImplementation(async () => {
      allowed = false;
      return new TextEncoder().encode("asset").buffer;
    });
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    await expect(runFolderImport({ target, files: [file], sourceName: "Notes", onProgress: vi.fn(),
      assertAllowed: () => { if (!allowed) throw revoked; },
    })).rejects.toMatchObject({ code: "WORKSPACE_ACCESS_CHANGED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not upload or finalize after the create API denies access", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response({ error: { code: "INSUFFICIENT_WORKSPACE_CAPABILITY", message: "Access changed." } }, 403));
    vi.stubGlobal("fetch", fetchMock);
    await expect(runFolderImport({ target, files: markdownFiles(21), sourceName: "Notes", onProgress: vi.fn(),
      assertAllowed: () => {},
    })).rejects.toMatchObject({ code: "INSUFFICIENT_WORKSPACE_CAPABILITY" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestWorkspaceAccessCheck).toHaveBeenCalledWith(403, "INSUFFICIENT_WORKSPACE_CAPABILITY");
  });

  it("does not send another batch after the upload API denies access", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(response({ snapshotId: "snapshot" }, 201))
      .mockResolvedValueOnce(response({ error: { code: "WORKSPACE_ARCHIVED", message: "Archived." } }, 409));
    vi.stubGlobal("fetch", fetchMock);
    await expect(runFolderImport({ target, files: markdownFiles(45), sourceName: "Notes", onProgress: vi.fn(),
      assertAllowed: () => {},
    })).rejects.toMatchObject({ code: "WORKSPACE_ARCHIVED" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2]?.[0]).toBe("/api/source-imports/snapshot");
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({ method: "DELETE", keepalive: true });
    expect(requestWorkspaceAccessCheck).toHaveBeenCalledWith(409, "WORKSPACE_ARCHIVED");
  });

  it("passes import conflict codes to the access checker instead of treating every 409 as an access change", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(response({ snapshotId: "snapshot" }, 201))
      .mockResolvedValueOnce(response({ error: { code: "UPLOAD_ENTRY_CONFLICT", message: "Entry already uploaded." } }, 409));
    vi.stubGlobal("fetch", fetchMock);
    await expect(runFolderImport({ target, files: markdownFiles(1), sourceName: "Notes", onProgress: vi.fn(),
      assertAllowed: () => {},
    })).rejects.toMatchObject({ code: "UPLOAD_ENTRY_CONFLICT" });
    expect(requestWorkspaceAccessCheck).toHaveBeenCalledWith(409, "UPLOAD_ENTRY_CONFLICT");
  });
  it("keeps a missing snapshot as an import error instead of pausing Workspace access during upload", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(response({ snapshotId: "snapshot" }, 201))
      .mockResolvedValueOnce(response({ error: { code: "NOT_FOUND", message: "The requested resource was not found." } }, 404));
    vi.stubGlobal("fetch", fetchMock);
    await expect(runFolderImport({ target, files: markdownFiles(1), sourceName: "Notes", onProgress: vi.fn(),
      assertAllowed: () => {},
    })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(requestWorkspaceAccessCheck).not.toHaveBeenCalled();
  });

  it("keeps a missing snapshot as an import error instead of pausing Workspace access during finalize", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(response({ snapshotId: "snapshot" }, 201))
      .mockResolvedValueOnce(response({}))
      .mockResolvedValueOnce(response({ error: { code: "NOT_FOUND", message: "The requested resource was not found." } }, 404));
    vi.stubGlobal("fetch", fetchMock);
    await expect(runFolderImport({ target, files: markdownFiles(1), sourceName: "Notes", onProgress: vi.fn(),
      assertAllowed: () => {},
    })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(requestWorkspaceAccessCheck).not.toHaveBeenCalled();
  });

  it("retries a transient upload failure against the same snapshot instead of creating another session", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ snapshotId: "snapshot" }, 201))
      .mockResolvedValueOnce(response({ error: { code: "TEMPORARY_FAILURE", message: "Try again." } }, 503))
      .mockResolvedValueOnce(response({ accepted: 1, idempotent: 0, diagnostics: [] }))
      .mockResolvedValueOnce(response({ snapshotId: "snapshot" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(runFolderImport({
      target,
      files: markdownFiles(1),
      sourceName: "Notes",
      onProgress: vi.fn(),
      assertAllowed: () => {},
    })).resolves.toBe("snapshot");

    const calls = fetchMock.mock.calls.map(([url, init]) => [String(url), init?.method ?? "GET"]);
    expect(calls).toEqual([
      ["/api/workspaces/workspace/source-imports", "POST"],
      ["/api/source-imports/snapshot/entries", "POST"],
      ["/api/source-imports/snapshot/entries", "POST"],
      ["/api/source-imports/snapshot/finalize", "POST"],
    ]);
  });

  it("abandons a known BUILDING snapshot after a terminal upload failure", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ snapshotId: "snapshot" }, 201))
      .mockResolvedValueOnce(response({ error: { code: "UPLOAD_SIZE_MISMATCH", message: "Bad upload." } }, 400))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(runFolderImport({
      target,
      files: markdownFiles(1),
      sourceName: "Notes",
      onProgress: vi.fn(),
      assertAllowed: () => {},
    })).rejects.toMatchObject({ code: "UPLOAD_SIZE_MISMATCH" });

    expect(fetchMock.mock.calls[2]?.[0]).toBe("/api/source-imports/snapshot");
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({ method: "DELETE", keepalive: true });
  });

});
