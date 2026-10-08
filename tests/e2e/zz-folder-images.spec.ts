import { createHash } from "node:crypto";
import { test, expect, type APIRequestContext } from "@playwright/test";

// A real 1×1 PNG, so the browser decodes it and naturalWidth proves it loaded.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><script>document.title="pwned"</script><rect width="4" height="4"/></svg>');
// In the folder, drawn by no page. It only has to be stored, not decoded.
const SECRET = Buffer.from("an image no document refers to");
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const MARKDOWN = Buffer.from("# Picture guide\n\n![pixel](img/pixel.png)\n\n![vector](img/vector.svg)\n");
const files = [
  { key: "m0", path: "picture-guide.md", bytes: MARKDOWN, markdown: true },
  { key: "a1", path: "img/pixel.png", bytes: PNG, markdown: false },
  { key: "a2", path: "img/vector.svg", bytes: SVG, markdown: false },
  { key: "a3", path: "img/secret.png", bytes: SECRET, markdown: false },
];

async function importFolder(request: APIRequestContext, workspaceId: string) {
  const manifest = files.map((file) => file.markdown
    ? { uploadKey: file.key, relativePath: file.path, kind: "MARKDOWN", size: file.bytes.length }
    : { uploadKey: file.key, relativePath: file.path, kind: "ASSET", size: file.bytes.length, contentHash: sha(file.bytes), mimeType: null, lastModified: null });
  const created = await request.post(`/api/workspaces/${workspaceId}/source-imports`, { data: { sourceName: "Picture folder", rootName: "pictures", manifest } });
  expect(created.ok()).toBe(true);
  const { snapshotId, assetUploads } = await created.json();
  expect([...assetUploads].sort()).toEqual(["a1", "a2", "a3"]);
  expect((await request.post(`/api/source-imports/${snapshotId}/entries`, { multipart: { entries: JSON.stringify([{ uploadKey: "m0", field: "file-0" }]), "file-0": { name: "picture-guide.md", mimeType: "text/markdown", buffer: MARKDOWN } } })).ok()).toBe(true);
  // Finalize must refuse while an image is outstanding.
  expect((await request.post(`/api/source-imports/${snapshotId}/finalize`, { data: {} })).ok()).toBe(false);
  for (const file of files.filter((candidate) => !candidate.markdown)) {
    const sent = await request.put(`/api/source-imports/${snapshotId}/asset?uploadKey=${file.key}`, { data: file.bytes, headers: { "Content-Type": "application/octet-stream" } });
    expect(sent.ok(), file.path).toBe(true);
  }
  expect((await request.post(`/api/source-imports/${snapshotId}/finalize`, { data: {} })).ok()).toBe(true);
  const applied = await request.post(`/api/source-imports/${snapshotId}/apply`, { data: {} });
  expect(applied.ok()).toBe(true);
  return (await applied.json()).sourceId as string;
}

test("a synced folder's images show to its reader and on a shared page, and nowhere else", async ({ page, request, browser }) => {
  const nav = await (await request.get("/api/workspaces")).json();
  const ws = nav.items.find((workspace: { type: string }) => workspace.type === "PERSONAL").id;
  const sourceId = await importFolder(request, ws);

  await page.goto(`/w/${ws}/knowledge/${sourceId}`);
  await expect(page.getByRole("heading", { name: "Picture guide", level: 1 })).toBeVisible();
  const pixel = page.getByRole("img", { name: "pixel" });
  await expect(pixel).toBeVisible();
  await expect.poll(() => pixel.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1);
  await expect.poll(() => page.getByRole("img", { name: "vector" }).evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(4);
  const documentId = page.url().split("/").pop()!.split("?")[0];

  const direct = await request.get(`/api/documents/${documentId}/asset?src=${encodeURIComponent("img/vector.svg")}`);
  expect(direct.status()).toBe(200);
  expect(direct.headers()).toMatchObject({ "content-type": "image/svg+xml", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox" });
  expect((await request.get(`/api/documents/${documentId}/asset?src=${encodeURIComponent("img/vector.svg")}`, { headers: { "If-None-Match": direct.headers().etag } })).status()).toBe(304);
  // Opened as a page, the SVG's script must not run.
  await page.goto(`/api/documents/${documentId}/asset?src=${encodeURIComponent("img/vector.svg")}`);
  expect(await page.title()).not.toBe("pwned");

  const shareResponse = await request.post(`/api/documents/${documentId}/share-links`, { data: { label: "Pictures" } });
  expect(shareResponse.ok()).toBe(true);
  const { link } = await shareResponse.json();
  const token = String(link.path).split("/").pop()!;

  const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const visitor = await anonymous.newPage();
  await visitor.goto(`/s/${token}`);
  await expect.poll(() => visitor.getByRole("img", { name: "pixel" }).evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1);
  const sharedImage = await anonymous.request.get(`/s/${token}/asset?src=${encodeURIComponent("img/vector.svg")}`);
  expect(sharedImage.status()).toBe(200);
  expect(sharedImage.headers()).toMatchObject({ "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox", "referrer-policy": "no-referrer" });
  // In the folder, not on the page: the token does not reach it.
  expect((await anonymous.request.get(`/s/${token}/asset?src=${encodeURIComponent("img/secret.png")}`)).status()).toBe(404);

  expect((await request.post(`/api/share-links/${link.id}/revoke`)).status()).toBe(204);
  expect((await anonymous.request.get(`/s/${token}/asset?src=${encodeURIComponent("img/pixel.png")}`)).status()).toBe(404);
  await anonymous.close();
});
