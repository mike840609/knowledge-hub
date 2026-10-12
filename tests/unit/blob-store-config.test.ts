import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
const load = async () => (await import("@/server/blob-store")).configuredBlobStore;

it("is off when KM_BLOB_DIR is unset or empty", async () => {
  vi.stubEnv("KM_BLOB_DIR", "");
  expect((await load())()).toBeNull();
});
it("returns one store for a writable directory", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "km-blob-config-"));
  vi.stubEnv("KM_BLOB_DIR", dir);
  const configured = await load();
  expect(configured()).not.toBeNull();
  expect(configured()).toBe(configured());
  await rm(dir, { recursive: true, force: true });
});
it("refuses a path that is missing or is a file, naming it", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "km-blob-config-"));
  vi.stubEnv("KM_BLOB_DIR", path.join(dir, "absent"));
  await expect(load().then((configured) => configured())).rejects.toThrow(/KM_BLOB_DIR.*absent/);
  vi.resetModules();
  await writeFile(path.join(dir, "file"), "x");
  vi.stubEnv("KM_BLOB_DIR", path.join(dir, "file"));
  await expect(load().then((configured) => configured())).rejects.toThrow(/KM_BLOB_DIR/);
  await rm(dir, { recursive: true, force: true });
});

const s3 = { KM_BLOB_S3_BUCKET: "images", KM_BLOB_S3_ENDPOINT: "http://minio.test:9000", KM_BLOB_S3_ACCESS_KEY: "key", KM_BLOB_S3_SECRET_KEY: "secret" };
const stub = (values: Record<string, string>) => { for (const [name, value] of Object.entries(values)) vi.stubEnv(name, value); };

it("builds an S3 store from the four S3 settings, without touching the network", async () => {
  stub(s3);
  const configured = await load();
  expect(configured()?.constructor.name).toBe("S3BlobStore");
});
it("names the missing S3 setting", async () => {
  for (const name of ["KM_BLOB_S3_ENDPOINT", "KM_BLOB_S3_ACCESS_KEY", "KM_BLOB_S3_SECRET_KEY"]) {
    vi.resetModules();
    stub({ ...s3, [name]: "" });
    await expect(load().then((configured) => configured())).rejects.toThrow(name);
  }
});
it("refuses an endpoint that is not an http(s) URL", async () => {
  stub({ ...s3, KM_BLOB_S3_ENDPOINT: "minio.test:9000" });
  await expect(load().then((configured) => configured())).rejects.toThrow("KM_BLOB_S3_ENDPOINT");
});
it("refuses a bucket and a directory together", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "km-blob-config-"));
  stub({ ...s3, KM_BLOB_DIR: dir });
  await expect(load().then((configured) => configured())).rejects.toThrow("not both");
  await rm(dir, { recursive: true, force: true });
});
it("at start-up, a bucket that refuses stops the server and one that cannot be reached only warns", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  // Nothing listens on this port: unreachable, so the server still starts.
  stub({ ...s3, KM_BLOB_S3_ENDPOINT: "http://127.0.0.1:9" });
  await expect((await import("@/server/blob-store")).verifyBlobStore()).resolves.toBeUndefined();
  expect(warn).toHaveBeenCalledOnce();
  warn.mockRestore();
});

for (const status of [408, 429, 500, 502, 503, 504]) {
  it(`starts with a warning when image storage returns HTTP ${status}`, async () => {
    const server = createServer((_request, response) => { response.writeHead(status); response.end(); });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as { port: number };
    stub({ ...s3, KM_BLOB_S3_ENDPOINT: `http://127.0.0.1:${address.port}` });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await expect((await import("@/server/blob-store")).verifyBlobStore()).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledOnce();
    } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
}
for (const status of [400, 401, 403, 404]) {
  it(`still rejects configuration errors (HTTP ${status})`, async () => {
    const server = createServer((_request, response) => { response.writeHead(status); response.end(); });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    stub({ ...s3, KM_BLOB_S3_ENDPOINT: `http://127.0.0.1:${(server.address() as { port: number }).port}` });
    try { await expect((await import("@/server/blob-store")).verifyBlobStore()).rejects.toThrow(`HTTP ${status}`); }
    finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
}
it("rejects invalid S3 request deadlines", async () => {
  for (const value of ["0", "-1", "abc", "1.5", "300001"]) {
    vi.resetModules();
    stub({ ...s3, KM_BLOB_S3_TIMEOUT_MS: value });
    await expect(load().then((configured) => configured())).rejects.toThrow("KM_BLOB_S3_TIMEOUT_MS");
  }
});
