import { expect, it } from "vitest";
import { imageResponse } from "@/server/document-images";
import type { BlobStore } from "@/modules/sources/ports/blob-store";

const hash = "b".repeat(64);
const image = { contentHash: hash, contentType: "image/svg+xml", sourcePath: "a.svg", documentPath: "a.md" };
const blobs = (present: boolean) => ({ open: async () => present ? { body: new Blob(["<svg/>"]).stream(), size: 6 } : null }) as unknown as BlobStore;
const get = (headers: Record<string, string> = {}) => new Request("http://hub.test/x", { headers });

it("serves the bytes with the type from the path and headers that keep an SVG inert", async () => {
  const response = await imageResponse(get(), image, blobs(true));
  expect(response.status).toBe(200);
  expect(await response.text()).toBe("<svg/>");
  expect(Object.fromEntries(response.headers)).toMatchObject({
    "content-type": "image/svg+xml", "content-length": "6", etag: `"${hash}"`,
    "x-content-type-options": "nosniff", "content-disposition": "inline", "cache-control": "private, no-cache",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  });
});
it("answers 304 to a matching ETag without opening the blob", async () => {
  const response = await imageResponse(get({ "if-none-match": `"${hash}"` }), image, { open: async () => { throw new Error("opened"); } } as unknown as BlobStore);
  expect(response.status).toBe(304);
  expect(response.headers.get("etag")).toBe(`"${hash}"`);
});
it("is one 404 for no image, no store and a missing blob", async () => {
  for (const response of [await imageResponse(get(), null, blobs(true)), await imageResponse(get(), image, null), await imageResponse(get(), image, blobs(false))]) {
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  }
});
