import { afterEach, describe, expect, it, vi } from "vitest";
import { runFolderImport } from "@/components/imports/folder-import-form";

const target = { kind: "new", workspaceId: "workspace" } as const;
const DEFAULT_MAX_ASSET_FILE_BYTES = 64 * 1024 * 1024;

function response(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function fakeAsset(
  index: number,
  options: { size?: number; arrayBuffer?: () => Promise<ArrayBuffer> } = {},
): File {
  return {
    name: `asset-${index}.bin`,
    size: options.size ?? 1,
    type: "application/octet-stream",
    lastModified: 1_700_000_000_000 + index,
    webkitRelativePath: `wiki/asset-${index}.bin`,
    arrayBuffer: options.arrayBuffer ?? (async () => new Uint8Array([index]).buffer),
  } as unknown as File;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubDigest(): void {
  vi.stubGlobal("crypto", {
    subtle: {
      digest: vi.fn(async () => new Uint8Array(32).buffer),
    },
  });
}

describe("folder import asset manifest resource usage", () => {
  it("rejects custom per-file and combined asset limits before reading any files", async () => {
    stubDigest();
    const arrayBuffer = vi.fn(async () => new Uint8Array([1]).buffer);
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const base = { target, sourceName: "Assets", onProgress: vi.fn(), limits: { maxAssetFileBytes: 10, maxAssetTotalBytes: 15 } };
    await expect(runFolderImport({ ...base, files: [fakeAsset(0, { size: 11, arrayBuffer })] })).rejects.toMatchObject({ code: "IMPORT_LIMIT_EXCEEDED" });
    await expect(runFolderImport({ ...base, files: [fakeAsset(0, { size: 8, arrayBuffer }), fakeAsset(1, { size: 8, arrayBuffer })] })).rejects.toMatchObject({ code: "IMPORT_LIMIT_EXCEEDED" });
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("drains active hash workers and stops scheduling files after a read failure", async () => {
    stubDigest();
    let active = 0;
    let reads = 0;
    const files = Array.from({ length: 12 }, (_, index) => fakeAsset(index, {
      arrayBuffer: async () => {
        reads += 1;
        if (index === 0) throw new Error("File became unreadable");
        active += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
        return new Uint8Array([index]).buffer;
      },
    }));
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    await expect(runFolderImport({ target, files, sourceName: "Assets", onProgress: vi.fn() })).rejects.toThrow("File became unreadable");
    expect(active).toBe(0);
    expect(reads).toBeLessThanOrEqual(4);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not create a snapshot when cancellation occurs during the last asset read", async () => {
    stubDigest();
    const controller = new AbortController();
    const files = [fakeAsset(0, { arrayBuffer: async () => {
      controller.abort();
      return new Uint8Array([1]).buffer;
    } })];
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response({ snapshotId: "snapshot" }, 201));
    vi.stubGlobal("fetch", fetchMock);
    await expect(runFolderImport({ target, files, sourceName: "Assets", onProgress: vi.fn(), signal: controller.signal })).rejects.toMatchObject({ code: "IMPORT_CANCELLED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("hashes assets with bounded concurrency instead of reading the whole folder into memory at once", async () => {
    stubDigest();
    let active = 0;
    let maxActive = 0;
    const files = Array.from({ length: 8 }, (_, index) => fakeAsset(index, {
      arrayBuffer: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return new Uint8Array([index]).buffer;
      },
    }));
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ snapshotId: "snapshot" }, 201))
      .mockResolvedValueOnce(response({ snapshotId: "snapshot" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(runFolderImport({
      target,
      files,
      sourceName: "Assets",
      onProgress: vi.fn(),
      assertAllowed: () => {},
    })).resolves.toBe("snapshot");

    expect(maxActive).toBeLessThanOrEqual(4);
  });

  it("rejects an oversized asset before reading any bytes or creating a snapshot", async () => {
    stubDigest();
    const arrayBuffer = vi.fn(async () => new Uint8Array([1]).buffer);
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    await expect(runFolderImport({
      target,
      files: [fakeAsset(0, { size: DEFAULT_MAX_ASSET_FILE_BYTES + 1, arrayBuffer })],
      sourceName: "Assets",
      onProgress: vi.fn(),
      assertAllowed: () => {},
    })).rejects.toMatchObject({ code: "IMPORT_LIMIT_EXCEEDED" });

    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
