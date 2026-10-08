import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { S3BlobStore, S3RequestError, type S3Config } from "@/infrastructure/storage/s3-blob-store";
import { BlobMismatchError } from "@/modules/sources/ports/blob-store";

// Runs against a real S3-compatible store: `make test-integration` starts MinIO and sets these.
const endpoint = process.env.KM_TEST_S3_ENDPOINT;
const config = (overrides: Partial<S3Config> = {}): S3Config => ({
  endpoint: endpoint ?? "", bucket: process.env.KM_TEST_S3_BUCKET ?? "", region: "us-east-1",
  accessKey: process.env.KM_TEST_S3_ACCESS_KEY ?? "", secretKey: process.env.KM_TEST_S3_SECRET_KEY ?? "",
  // One folder per run, so runs never see each other's objects.
  prefix: `test-${randomUUID()}/`, ...overrides,
});
const bytes = new TextEncoder().encode("not really a png");
const sha = createHash("sha256").update(bytes).digest("hex");
const body = (data: Uint8Array = bytes) => new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(data); controller.close(); } });
const text = async (stream: ReadableStream<Uint8Array>) => new Response(stream).text();
const listed = async (store: S3BlobStore) => { const all = []; for await (const blob of store.list()) all.push(blob); return all; };

describe.skipIf(!endpoint)("S3 blob store against a real bucket", () => {
  it("stores bytes under their hash and reads them back", async () => {
    const store = new S3BlobStore(config());
    expect(await store.has(sha)).toBe(false);
    expect(await store.open(sha)).toBeNull();
    await store.put(sha, body(), bytes.byteLength);
    expect(await store.has(sha)).toBe(true);
    const opened = await store.open(sha);
    expect(opened!.size).toBe(bytes.byteLength);
    expect(await text(opened!.body)).toBe("not really a png");
  });
  it("accepts the same bytes twice", async () => {
    const store = new S3BlobStore(config());
    await store.put(sha, body(), bytes.byteLength);
    await store.put(sha, body(), bytes.byteLength);
    expect(await text((await store.open(sha))!.body)).toBe("not really a png");
  });
  it("rejects bytes that do not match the declared hash or size, and stores nothing", async () => {
    const store = new S3BlobStore(config());
    const other = new TextEncoder().encode("something else!!");
    await expect(store.put(sha, body(other), other.byteLength)).rejects.toBeInstanceOf(BlobMismatchError);
    await expect(store.put(sha, body(), bytes.byteLength + 1)).rejects.toBeInstanceOf(BlobMismatchError);
    await expect(store.put(sha, body(), bytes.byteLength - 1)).rejects.toBeInstanceOf(BlobMismatchError);
    expect(await store.has(sha)).toBe(false);
    expect(await listed(store)).toEqual([]);
  });
  it("refuses a key that is not a lowercase SHA-256", async () => {
    const store = new S3BlobStore(config());
    for (const key of ["../../etc/passwd", sha.toUpperCase(), sha.slice(1), ""]) {
      await expect(store.put(key, body(), bytes.byteLength)).rejects.toThrow("SHA-256");
      await expect(store.has(key)).rejects.toThrow("SHA-256");
    }
  });
  it("lists only its own prefix, with modification times, and removes", async () => {
    const store = new S3BlobStore(config());
    const neighbour = new S3BlobStore(config());
    await neighbour.put(sha, body(), bytes.byteLength);
    const before = Date.now() - 60_000;
    const hashes: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const data = new TextEncoder().encode(`blob ${index}`);
      hashes.push(createHash("sha256").update(data).digest("hex"));
      await store.put(hashes[index], body(data), data.byteLength);
    }
    const all = await listed(store);
    expect(all.map((blob) => blob.sha256).sort()).toEqual([...hashes].sort());
    for (const blob of all) expect(blob.modifiedAt.getTime()).toBeGreaterThan(before);
    await store.remove(hashes[0]);
    await store.remove(hashes[0]);
    expect(await store.has(hashes[0])).toBe(false);
    expect(await listed(store)).toHaveLength(2);
    expect(await neighbour.has(sha)).toBe(true);
  });
  it("stores a body that arrives in many chunks", async () => {
    const store = new S3BlobStore(config());
    const chunk = new Uint8Array(64 * 1024).fill(7), count = 48;
    const hash = createHash("sha256");
    for (let index = 0; index < count; index += 1) hash.update(chunk);
    const digest = hash.digest("hex");
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({ pull(controller) { if (sent++ < count) controller.enqueue(chunk); else controller.close(); } });
    await store.put(digest, stream, chunk.byteLength * count);
    expect((await store.open(digest))!.size).toBe(chunk.byteLength * count);
  });
  it("check passes for the bucket, and names the refusal for wrong keys or a missing bucket", async () => {
    await expect(new S3BlobStore(config()).check()).resolves.toBeUndefined();
    await expect(new S3BlobStore(config({ secretKey: "wrong" })).check()).rejects.toMatchObject({ name: "S3RequestError", status: 403 });
    const missing = await new S3BlobStore(config({ bucket: `absent-${randomUUID()}` })).check().catch((error: unknown) => error);
    expect(missing).toBeInstanceOf(S3RequestError);
    expect((missing as S3RequestError).status).toBe(404);
    expect((missing as S3RequestError).message).not.toContain(process.env.KM_TEST_S3_SECRET_KEY);
  });
  it("creating a bucket that exists is not an error", async () => {
    await expect(new S3BlobStore(config()).createBucket()).resolves.toBeUndefined();
  });
});
