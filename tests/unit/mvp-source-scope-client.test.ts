import { afterEach, expect, it, vi } from "vitest";
import { runFolderImport } from "@/components/imports/folder-import-form";
function file(path: string) { const f = new File(["# A"], path.split("/").at(-1)!); Object.defineProperty(f, "webkitRelativePath", { value: `wiki/${path}` }); return f; }
afterEach(() => vi.unstubAllGlobals());
it("supports first-import exclusions and records the count in the staged snapshot", async () => {
  const fetch = vi.fn(async (url: string) => Response.json(url.endsWith("source-imports") ? { snapshotId: "snap" } : {})); vi.stubGlobal("fetch", fetch);
  await runFolderImport({ target: { kind: "new", workspaceId: "ws" }, files: [file("private/secret.md"), file("docs/a.md")], sourceName: "Wiki", excludedPaths: ["private"], onProgress: () => {} });
  const body = JSON.parse(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body));
  expect(body.importScope).toEqual({ paths: ["private"], excludedCount: 1 }); expect(body.manifest.map((f: { relativePath: string }) => f.relativePath)).toEqual(["docs/a.md"]);
});
it("uses server-saved rules on a device without local preferences", async () => {
  vi.stubGlobal("localStorage", { getItem: () => { throw new Error("No local settings"); } });
  const requests: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => { requests.push({ url, init }); return Response.json(url.endsWith("import-scope") ? { paths: ["private"], configured: true, syncVersion: 2 } : url.endsWith("source-imports") ? { snapshotId: "snap" } : {}); }));
  await runFolderImport({ target: { kind: "existing", workspaceId: "ws", sourceId: "s", sourceName: "Wiki" }, files: [file("private/secret.md"), file("docs/a.md")], sourceName: "", onProgress: () => {} });
  const body = JSON.parse(String(requests[1].init?.body)); expect(body.expectedSourceVersion).toBe(2); expect(body.manifest).toHaveLength(1);
});
it("refuses to upload after source settings change while an editor is open", async () => {
  const fetch = vi.fn(async () => Response.json({ paths: ["private"], configured: true, syncVersion: 3 })); vi.stubGlobal("fetch", fetch);
  await expect(runFolderImport({ target: { kind: "existing", workspaceId: "ws", sourceId: "s", sourceName: "Wiki" }, files: [file("docs/a.md")], sourceName: "", excludedPaths: [], expectedSourceVersion: 2, onProgress: () => {} })).rejects.toMatchObject({ code: "SOURCE_VERSION_CONFLICT" }); expect(fetch).toHaveBeenCalledOnce();
});
it("offers browser settings separately instead of silently applying them", async () => {
  vi.stubGlobal("localStorage", { getItem: () => "private" });
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ paths: [], configured: false, syncVersion: 0 })));
  const { loadSourceImportScope } = await import("@/lib/source-import-scope");
  expect(await loadSourceImportScope("ws", "s")).toMatchObject({ paths: [], legacyPaths: ["private"] });
});
