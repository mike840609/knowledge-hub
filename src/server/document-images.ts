import type { StoredImage } from "@/modules/knowledge/domain/source-policy";
import type { BlobStore } from "@/modules/sources/ports/blob-store";

/**
 * On every image response. `nosniff` and the sandboxing policy are what make
 * an SVG safe to serve from the app's own origin: opened directly it runs no
 * script. `no-cache` makes the browser re-ask each time, so authorization is
 * re-checked and an unchanged image costs a 304.
 */
export const IMAGE_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  "Content-Disposition": "inline",
  "Cache-Control": "private, no-cache",
} as const;

export async function imageResponse(request: Request, image: StoredImage | null, blobs: BlobStore | null): Promise<Response> {
  const notFound = () => new Response(null, { status: 404, headers: IMAGE_HEADERS });
  if (!image || !blobs) return notFound();
  const etag = `"${image.contentHash}"`;
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { ...IMAGE_HEADERS, ETag: etag } });
  const blob = await blobs.open(image.contentHash);
  if (!blob) return notFound();
  return new Response(blob.body, { headers: { ...IMAGE_HEADERS, ETag: etag, "Content-Type": image.contentType, "Content-Length": String(blob.size) } });
}
