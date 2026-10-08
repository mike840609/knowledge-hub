import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { FilesystemBlobStore } from "@/infrastructure/storage/filesystem-blob-store";
import { BlobMismatchError } from "@/modules/sources/ports/blob-store";

const bytes = new TextEncoder().encode("not really a png");
const sha = createHash("sha256").update(bytes).digest("hex");
const body = (data: Uint8Array = bytes) => new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(data); controller.close(); } });
const text = async (stream: ReadableStream<Uint8Array>) => new Response(stream).text();
let root: string, store: FilesystemBlobStore;
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), "km-blob-")); store = new FilesystemBlobStore(root); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

it("stores bytes under their hash and reads them back", async () => {
  expect(await store.has(sha)).toBe(false);
  expect(await store.open(sha)).toBeNull();
  await store.put(sha, body(), bytes.byteLength);
  expect(await store.has(sha)).toBe(true);
  const opened = await store.open(sha);
  expect(opened!.size).toBe(bytes.byteLength);
  expect(await text(opened!.body)).toBe("not really a png");
  expect(await readdir(path.join(root, "sha256", sha.slice(0, 2), sha.slice(2, 4)))).toEqual([sha]);
});
it("accepts the same bytes twice", async () => {
  await store.put(sha, body(), bytes.byteLength);
  await store.put(sha, body(), bytes.byteLength);
  expect(await text((await store.open(sha))!.body)).toBe("not really a png");
});
it("rejects bytes that do not match the declared hash or size, and leaves nothing behind", async () => {
  const other = new TextEncoder().encode("something else!!");
  await expect(store.put(sha, body(other), other.byteLength)).rejects.toBeInstanceOf(BlobMismatchError);
  await expect(store.put(sha, body(), bytes.byteLength + 1)).rejects.toBeInstanceOf(BlobMismatchError);
  await expect(store.put(sha, body(), bytes.byteLength - 1)).rejects.toBeInstanceOf(BlobMismatchError);
  expect(await store.has(sha)).toBe(false);
  expect(await readdir(path.join(root, "tmp"))).toEqual([]);
});
it("refuses a key that is not a lowercase SHA-256", async () => {
  for (const key of ["../../etc/passwd", sha.toUpperCase(), sha.slice(1), ""]) {
    await expect(store.put(key, body(), bytes.byteLength)).rejects.toThrow("SHA-256");
    await expect(store.has(key)).rejects.toThrow("SHA-256");
  }
});
it("lists what it holds with modification times, and removes", async () => {
  await store.put(sha, body(), bytes.byteLength);
  const old = new Date("2026-01-01T00:00:00Z");
  await utimes(path.join(root, "sha256", sha.slice(0, 2), sha.slice(2, 4), sha), old, old);
  const listed = [];
  for await (const blob of store.list()) listed.push(blob);
  expect(listed).toEqual([{ sha256: sha, modifiedAt: old }]);
  await store.remove(sha);
  await store.remove(sha);
  expect(await store.has(sha)).toBe(false);
});
it("lists nothing from an empty root", async () => {
  const listed = [];
  for await (const blob of store.list()) listed.push(blob);
  expect(listed).toEqual([]);
});
