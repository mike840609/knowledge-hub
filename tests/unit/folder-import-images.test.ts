import { afterEach, expect, it, vi } from "vitest";
import { runFolderImport } from "@/components/imports/folder-import-form";

const target = { kind: "new", workspaceId: "workspace" } as const;
const file = (relativePath: string, content: string) => {
  const created = new File([content], relativePath.split("/").pop()!);
  Object.defineProperty(created, "webkitRelativePath", { value: relativePath });
  return created;
};
const json = (body: unknown, status = 200) => Response.json(body, { status });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function stubServer(assetUploads: (manifest: { uploadKey: string; relativePath: string }[]) => string[], assetStatus = 200) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input), method = init.method ?? "GET";
    calls.push({ method, url, body: init.body });
    if (url.endsWith("/source-imports")) return json({ snapshotId: "snap", state: "BUILDING", assetUploads: assetUploads(JSON.parse(String(init.body)).manifest) });
    if (url.includes("/asset?")) return assetStatus === 200 ? json({ accepted: true }) : json({ error: { code: "UPLOAD_SIZE_MISMATCH", message: "mismatch" } }, assetStatus);
    if (method === "DELETE") return json({ abandoned: true });
    return json({});
  }));
  return calls;
}
const folder = () => [file("wiki/guide.md", "# Guide"), file("wiki/img/a b.png", "aaa"), file("wiki/img/c.png", "ccc"), file("wiki/notes.pdf", "pdf")];

it("uploads exactly the images the server asked for, after Markdown and before finalize", async () => {
  const calls = stubServer((manifest) => manifest.filter((entry) => entry.relativePath.endsWith("a b.png")).map((entry) => entry.uploadKey));
  const states: { kind: string }[] = [];
  await runFolderImport({ target, files: folder(), sourceName: "Wiki", onProgress: (state) => states.push(state) });
  const order = calls.map((call) => call.url.includes("/asset?") ? "asset" : call.url.split("/").pop());
  expect(order).toEqual(["source-imports", "entries", "asset", "finalize"]);
  const asset = calls.find((call) => call.url.includes("/asset?"))!;
  expect(asset.method).toBe("PUT");
  expect(new URL(asset.url, "http://hub.test").searchParams.get("uploadKey")).toMatch(/a b\.png$/);
  expect(await (asset.body as File).text()).toBe("aaa");
  expect(states.filter((state) => state.kind === "UPLOADING_IMAGES")).toEqual([
    { kind: "UPLOADING_IMAGES", uploaded: 0, total: 1 }, { kind: "UPLOADING_IMAGES", uploaded: 1, total: 1 },
  ]);
});
it("uploads nothing and shows no image step when the server asks for none", async () => {
  const calls = stubServer(() => []);
  const states: { kind: string }[] = [];
  await runFolderImport({ target, files: folder(), sourceName: "Wiki", onProgress: (state) => states.push(state) });
  expect(calls.some((call) => call.url.includes("/asset?"))).toBe(false);
  expect(states.some((state) => state.kind === "UPLOADING_IMAGES")).toBe(false);
});
it("an older server that returns no assetUploads still imports", async () => {
  const calls = stubServer(() => undefined as unknown as string[]);
  await runFolderImport({ target, files: folder(), sourceName: "Wiki", onProgress: vi.fn() });
  expect(calls.map((call) => call.url.split("/").pop())).toEqual(["source-imports", "entries", "finalize"]);
});
it("a rejected image stops the import with the server's code, abandons the snapshot and never finalizes", async () => {
  const calls = stubServer((manifest) => manifest.filter((entry) => entry.relativePath.endsWith(".png")).map((entry) => entry.uploadKey), 400);
  await expect(runFolderImport({ target, files: folder(), sourceName: "Wiki", onProgress: vi.fn() })).rejects.toMatchObject({ code: "UPLOAD_SIZE_MISMATCH" });
  expect(calls.some((call) => call.url.endsWith("/finalize"))).toBe(false);
  expect(calls.some((call) => call.method === "DELETE" && call.url.endsWith("/source-imports/snap"))).toBe(true);
});
