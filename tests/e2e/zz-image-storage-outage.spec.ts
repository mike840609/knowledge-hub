import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * What still works when the image store cannot be reached.
 *
 * The server is started with KM_BLOB_S3_ENDPOINT pointing at a relay this file
 * owns (KM_TEST_S3_ENDPOINT), which forwards to the real MinIO
 * (KM_TEST_S3_UPSTREAM) and can be switched to refuse connections or to accept
 * them and never answer. Skipped unless both are set: `make test-e2e-outage`.
 */
const upstream = process.env.KM_TEST_S3_UPSTREAM ? new URL(process.env.KM_TEST_S3_UPSTREAM) : null;
const relayPort = process.env.KM_TEST_S3_ENDPOINT ? Number(new URL(process.env.KM_TEST_S3_ENDPOINT).port) : 0;
const deadlineMs = Number(process.env.KM_BLOB_S3_TIMEOUT_MS ?? 30_000);

type Mode = "up" | "refuse" | "hang";
let server: net.Server | null = null;
const sockets = new Set<net.Socket>();
async function storage(mode: Mode): Promise<void> {
  for (const socket of sockets) socket.destroy();
  sockets.clear();
  if (server) { const closing = server; server = null; await new Promise((done) => closing.close(done)); }
  if (mode === "refuse") return;
  server = net.createServer((client) => {
    sockets.add(client);
    client.on("close", () => sockets.delete(client));
    client.on("error", () => {});
    // "hang": the connection is accepted and nothing is ever sent back.
    if (mode === "hang") return;
    const target = net.connect(Number(upstream!.port), upstream!.hostname);
    sockets.add(target);
    target.on("close", () => { sockets.delete(target); client.destroy(); });
    target.on("error", () => client.destroy());
    client.on("close", () => target.destroy());
    client.pipe(target);
    target.pipe(client);
  });
  await new Promise<void>((done) => server!.listen(relayPort, "127.0.0.1", () => done()));
}

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const image = (seed: string) => Buffer.concat([PNG, Buffer.from(seed)]);
const asset = (documentId: string) => `/api/documents/${documentId}/asset?src=${encodeURIComponent("img/pixel.png")}`;
const timed = async <T>(work: () => Promise<T>): Promise<{ value: T; ms: number }> => { const started = Date.now(); const value = await work(); return { value, ms: Date.now() - started }; };

/** Stages a folder of one document and one image. Returns what the server said at each step. */
async function stage(request: APIRequestContext, target: { workspaceId: string } | { sourceId: string }, name: string, picture: Buffer) {
  const markdown = Buffer.from(`# ${name}\n\nBody text of ${name}.\n\n![pixel](img/pixel.png)\n`);
  const manifest = [
    { uploadKey: "m0", relativePath: "guide.md", kind: "MARKDOWN", size: markdown.length },
    { uploadKey: "a1", relativePath: "img/pixel.png", kind: "ASSET", size: picture.length, contentHash: sha(picture), mimeType: null, lastModified: null },
  ];
  const created = await request.post("workspaceId" in target ? `/api/workspaces/${target.workspaceId}/source-imports` : `/api/sources/${target.sourceId}/source-imports`, { data: { sourceName: name, rootName: "outage", manifest } });
  expect(created.ok(), "create import").toBe(true);
  const { snapshotId, assetUploads } = await created.json();
  expect((await request.post(`/api/source-imports/${snapshotId}/entries`, { multipart: { entries: JSON.stringify([{ uploadKey: "m0", field: "file-0" }]), "file-0": { name: "guide.md", mimeType: "text/markdown", buffer: markdown } } })).ok(), "upload Markdown").toBe(true);
  const upload = assetUploads.length ? await timed(() => request.put(`/api/source-imports/${snapshotId}/asset?uploadKey=a1`, { data: picture, headers: { "Content-Type": "application/octet-stream" } })) : null;
  return { snapshotId, assetUploads: assetUploads as string[], upload };
}
async function finalizeAndApply(request: APIRequestContext, snapshotId: string): Promise<string> {
  expect((await request.post(`/api/source-imports/${snapshotId}/finalize`, { data: {} })).ok(), "finalize").toBe(true);
  const applied = await request.post(`/api/source-imports/${snapshotId}/apply`, { data: {} });
  expect(applied.ok(), "apply").toBe(true);
  return (await applied.json()).sourceId as string;
}
async function formImport(page: Page, ws: string, name: string, withImage: boolean): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "km-outage-"));
  await writeFile(path.join(root, "note.md"), `# ${name}\n\nBody text of ${name}.\n${withImage ? "\n![pixel](img/pixel.png)\n" : ""}`);
  if (withImage) { await mkdir(path.join(root, "img")); await writeFile(path.join(root, "img", "pixel.png"), image(name)); }
  await page.goto(`/w/${ws}/sources/import`);
  await page.getByLabel("Source name", { exact: true }).fill(name);
  await page.locator("#import-folder").setInputFiles(root);
  return root;
}

test.describe.configure({ mode: "serial" });
test.describe("the image store is unreachable", () => {
  test.skip(!upstream || !relayPort, "needs KM_TEST_S3_ENDPOINT (relay) and KM_TEST_S3_UPSTREAM (MinIO)");
  test.setTimeout(180_000);
  let ws = "", sourceId = "", documentId = "", documentUrl = "", token = "";

  test.afterAll(async () => { await storage("refuse"); });

  test("baseline: with the store up, an image is imported, shown and shared", async ({ page, request }) => {
    // The server was started before this relay listened, so it has already come up with the store refusing connections.
    await storage("up");
    ws = (await (await request.get("/api/workspaces")).json()).items.find((workspace: { type: string }) => workspace.type === "PERSONAL").id;
    const staged = await stage(request, { workspaceId: ws }, "Outage guide", image("baseline"));
    expect(staged.upload!.value.status()).toBe(200);
    sourceId = await finalizeAndApply(request, staged.snapshotId);
    await page.goto(`/w/${ws}/knowledge/${sourceId}`);
    await expect(page.getByRole("heading", { name: "Outage guide", level: 1 })).toBeVisible();
    documentUrl = page.url();
    documentId = documentUrl.split("/").pop()!.split("?")[0];
    expect((await request.get(asset(documentId))).status()).toBe(200);
    const { link } = await (await request.post(`/api/documents/${documentId}/share-links`, { data: { label: "Outage" } })).json();
    token = String(link.path).split("/").pop()!;
  });

  for (const mode of ["refuse", "hang"] as const) {
    test(`store ${mode === "refuse" ? "refuses connections" : "accepts and never answers"}: reading, search and text-only sync still work`, async ({ page, request, browser }) => {
      await storage(mode);
      // A refused connection fails at once; a silent one fails at the configured deadline, not later.
      const limit = mode === "refuse" ? 3_000 : deadlineMs + 3_000;

      // Reading a document: the text is there at normal speed, the image is a placeholder.
      const opened = await timed(async () => { await page.goto(documentUrl); await expect(page.getByText("Body text of Outage guide.").first()).toBeVisible(); });
      expect.soft(opened.ms, "document text does not wait for the image store").toBeLessThan(5_000);
      await expect.soft(page.getByRole("img", { name: "Image unavailable: pixel" }).first()).toBeVisible({ timeout: limit + 5_000 });

      // The image request itself: a prompt 503, not a hang and not a 500.
      const fetched = await timed(() => request.get(asset(documentId)));
      expect.soft(fetched.value.status(), "image request status").toBe(503);
      expect.soft(fetched.ms, "image request duration").toBeLessThan(limit);

      // The shared page, signed out.
      const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } });
      const visitor = await anonymous.newPage();
      await visitor.goto(`/s/${token}`);
      await expect.soft(visitor.getByText("Body text of Outage guide.").first()).toBeVisible();
      const sharedImage = await timed(() => anonymous.request.get(`/s/${token}/asset?src=${encodeURIComponent("img/pixel.png")}`));
      expect.soft(sharedImage.value.status(), "shared image status").toBe(503);
      expect.soft(sharedImage.ms, "shared image duration").toBeLessThan(limit);
      await anonymous.close();

      // The rest of the application.
      for (const route of ["home", "knowledge", "search", "sources", "profile", "graph", "shares"]) {
        const response = await page.goto(`/w/${ws}/${route}`);
        expect.soft(response?.status(), `/${route}`).toBeLessThan(400);
        await expect.soft(page.getByText("Application error"), `/${route}`).toHaveCount(0);
      }
      expect.soft((await request.post(`/api/workspaces/${ws}/documents`, { data: { title: `Note during ${mode}`, markdown: "Written while the image store was down." } })).status(), "create a note").toBe(201);

      // Syncing a folder with no images, through the real form.
      const textOnly = await formImport(page, ws, `Text only during ${mode}`, false);
      await expect(page).toHaveURL(/\/sources\/imports\//);
      await page.getByRole("button", { name: "Apply changes" }).click();
      await expect.soft(page).toHaveURL(/\/runs\//);
      await rm(textOnly, { recursive: true, force: true });

      // Re-syncing the folder whose image is already stored: nothing to upload, so it goes through.
      const unchanged = await stage(request, { sourceId }, "Outage guide", image("baseline"));
      expect.soft(unchanged.assetUploads, "an already stored image is not asked for again").toEqual([]);
      expect.soft((await request.post(`/api/source-imports/${unchanged.snapshotId}/finalize`, { data: {} })).ok(), "finalize an unchanged re-sync").toBe(true);

      // Syncing a new image: refused clearly and promptly, and nothing is applied.
      const blocked = await stage(request, { workspaceId: ws }, `New image during ${mode}`, image(`new-${mode}`));
      expect.soft(blocked.upload!.value.status(), "image upload status").toBe(503);
      expect.soft((await blocked.upload!.value.json().catch(() => null))?.error?.code, "image upload error code").toBe("IMAGE_STORAGE_UNAVAILABLE");
      expect.soft(blocked.upload!.ms, "image upload duration").toBeLessThan(limit);
      expect.soft((await request.post(`/api/source-imports/${blocked.snapshotId}/finalize`, { data: {} })).ok(), "finalize without the image").toBe(false);
      expect.soft((await (await request.delete(`/api/source-imports/${blocked.snapshotId}`)).json()).abandoned, "abandon the blocked import").toBe(true);

      // The same through the form: the reader is told, and stays on the import page.
      const withImage = await formImport(page, ws, `Form image during ${mode}`, true);
      await expect.soft(page.getByText(/Image storage is unavailable/)).toBeVisible({ timeout: 4 * limit + 30_000 });
      expect.soft(page.url(), "the form does not move on to a preview").toContain("/sources/import");
      await rm(withImage, { recursive: true, force: true });
      await page.goto(`/w/${ws}/sources`);
      await expect.soft(page.getByText(`Text only during ${mode}`).first(), "the text-only folder is listed").toBeVisible();
      await expect.soft(page.getByText(new RegExp(`image during ${mode}`)), "no source was created by the blocked imports").toHaveCount(0);
    });
  }

  test("recovery: when the store returns, images load and the blocked sync succeeds without a restart", async ({ page, request }) => {
    await storage("up");
    expect((await request.get(asset(documentId))).status()).toBe(200);
    await page.goto(documentUrl);
    await expect.poll(() => page.getByRole("img", { name: "pixel" }).evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(1);
    const staged = await stage(request, { workspaceId: ws }, "After recovery", image("recovered"));
    expect(staged.upload!.value.status()).toBe(200);
    await finalizeAndApply(request, staged.snapshotId);
  });
});
