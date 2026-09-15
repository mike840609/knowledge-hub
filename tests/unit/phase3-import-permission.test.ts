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
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/workspaces/workspace/source-imports", "/api/source-imports/snapshot/entries",
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
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/finalize"))).toBe(false);
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
    expect(requestWorkspaceAccessCheck).toHaveBeenCalledWith(403);
  });

  it("does not send another batch after the upload API denies access", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(response({ snapshotId: "snapshot" }, 201))
      .mockResolvedValueOnce(response({ error: { code: "WORKSPACE_ARCHIVED", message: "Archived." } }, 409));
    vi.stubGlobal("fetch", fetchMock);
    await expect(runFolderImport({ target, files: markdownFiles(45), sourceName: "Notes", onProgress: vi.fn(),
      assertAllowed: () => {},
    })).rejects.toMatchObject({ code: "WORKSPACE_ARCHIVED" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestWorkspaceAccessCheck).toHaveBeenCalledWith(409);
  });
});
