import { createServer, type RequestListener, type Server } from "node:http";
import { createHash } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { S3BlobStore } from "@/infrastructure/storage/s3-blob-store";
import { toImportErrorResponse, toWorkspaceErrorResponse } from "@/server/http-error-response";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }));
});
async function store(handler: RequestListener) {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return new S3BlobStore({ endpoint: `http://127.0.0.1:${(server.address() as { port: number }).port}`, bucket: "images", accessKey: "key", secretKey: "secret", region: "us-east-1", prefix: "", timeoutMs: 60 });
}
const bytes = new TextEncoder().encode("image bytes");
const hash = createHash("sha256").update(bytes).digest("hex");
const timeout = { name: "BlobStorageUnavailableError" };

it("bounds a connection that accepts a request but never responds", async () => {
  const blobs = await store(() => {});
  await expect(blobs.check()).rejects.toMatchObject(timeout);
});
it("bounds a stalled upload and cancels its input", async () => {
  const blobs = await store(() => {});
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
  await expect(blobs.put(hash, body, bytes.length)).rejects.toMatchObject(timeout);
  expect(cancelled).toBe(true);
});
it("bounds waiting for an upload response after all bytes have been sent", async () => {
  const blobs = await store((request) => { request.resume(); });
  await expect(blobs.put(hash, new Blob([bytes]).stream(), bytes.length)).rejects.toMatchObject(timeout);
});
it("keeps the deadline active while reading an incomplete response body", async () => {
  const blobs = await store((_request, response) => { response.writeHead(200); response.write("<ListBucketResult>"); });
  await expect(blobs.check()).rejects.toMatchObject(timeout);
});
it("bounds a slowly streaming image even after headers have arrived", async () => {
  const blobs = await store((_request, response) => { response.writeHead(200, { "Content-Length": "100" }); response.write("a"); });
  const image = await blobs.open(hash);
  await expect(new Response(image!.body).text()).rejects.toMatchObject(timeout);
});
it("reports a storage outage as a retryable 503 without internal details", async () => {
  const blobs = await store((_request, response) => { response.writeHead(503); response.end("<Code>InternalSensitiveDetail</Code>"); });
  const error = await blobs.put(hash, new Blob([bytes]).stream(), bytes.length).catch((error: unknown) => error);
  for (const map of [toImportErrorResponse, toWorkspaceErrorResponse]) {
    const result = map(error);
    expect(result.status).toBe(503);
    expect(result.body.error.code).toBe("IMAGE_STORAGE_UNAVAILABLE");
    expect(result.body.error.message).toMatch(/retry/i);
    expect(result.body.error.message).not.toContain("InternalSensitiveDetail");
  }
});
it("recovers on the next operation without recreating the store", async () => {
  let unavailable = true;
  const blobs = await store((_request, response) => { response.writeHead(unavailable ? 503 : 200); response.end(); });
  await expect(blobs.check()).rejects.toThrow();
  unavailable = false;
  await expect(blobs.check()).resolves.toBeUndefined();
});

it("does not extend the deadline when the server trickles response bytes", async () => {
  const blobs = await store((_request, response) => {
    response.writeHead(200);
    const timer = setInterval(() => response.write(" "), 10);
    response.on("close", () => clearInterval(timer));
  });
  await expect(blobs.check()).rejects.toMatchObject(timeout);
});
it("still bounds an unfinished upload when the server answers early", async () => {
  const blobs = await store((_request, response) => { response.writeHead(200); response.end(); });
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes.slice(0, 1)); }, cancel() { cancelled = true; } });
  await expect(blobs.put(hash, body, bytes.length)).rejects.toMatchObject(timeout);
  expect(cancelled).toBe(true);
});
