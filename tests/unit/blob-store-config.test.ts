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
