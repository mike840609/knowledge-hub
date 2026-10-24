// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_UPLOAD_BATCH_BYTES, runFolderImport } from "@/components/imports/folder-import-form";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/source-import-scope", () => ({ loadSourceImportScope: vi.fn(async () => ({ paths: [], configured: true, syncVersion: 1 })) }));
vi.mock("@/components/shell/use-workspace-authorization", () => ({
  requestWorkspaceAccessCheck: vi.fn(),
  useWorkspaceAuthorization: () => ({ access: { actions: { canImport: true } }, confirmed: true }),
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function markdown(size: number, name: string): File {
  return new File(["a".repeat(size)], name, { type: "text/markdown" });
}

describe("folder-import upload batches", () => {
  it("keeps batches at or below the Vercel-safe ceiling", async () => {
    const files = [markdown(3 * 1024 * 1024, "a.md"), markdown(2 * 1024 * 1024, "b.md")];
    const batches: number[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/entries")) {
        const form = init?.body as FormData;
        let total = 0;
        form.forEach((value, key) => { if (key.startsWith("file-")) total += (value as File).size; });
        batches.push(total);
        return Response.json({});
      }
      if (url.includes("/source-imports") && !url.endsWith("/finalize")) return Response.json({ snapshotId: "snap-1" }, { status: 201 });
      return Response.json({});
    });
    vi.stubGlobal("fetch", fetchMock);

    await runFolderImport({ target: { kind: "new", workspaceId: "w1" }, files, sourceName: "Notes", onProgress: () => {} });

    expect(MAX_UPLOAD_BATCH_BYTES).toBe(4 * 1024 * 1024);
    expect(batches).toHaveLength(2);
    expect(batches[0]).toBe(3 * 1024 * 1024);
    expect(batches[1]).toBe(2 * 1024 * 1024);
    for (const total of batches) expect(total).toBeLessThanOrEqual(MAX_UPLOAD_BATCH_BYTES);
  });
});
