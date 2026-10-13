import isSvg from "is-svg";

export type UploadedImageType = "png" | "jpg" | "gif" | "webp" | "avif" | "svg";

const starts = (bytes: Uint8Array, signature: readonly number[], at = 0) => signature.every((byte, index) => bytes[at + index] === byte);
const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));

/**
 * What an uploaded image is, read from its content: the name and the browser's
 * content type are the uploader's claims. The raster types are told by their
 * leading bytes. SVG is text with no such mark, so it is parsed: well-formed
 * XML whose root is `svg`, and nothing else.
 *
 * This says what a file *is*, not that it is harmless. An SVG may carry script;
 * what keeps it inert is how it is served (`IMAGE_HEADERS`) and drawn (`<img>`).
 *
 * Server only: it brings an XML parser.
 */
/**
 * Parsing is synchronous and takes about 35 ms per MiB, during which the server answers nothing
 * else. A drawing is rarely near this; the raster types, told from a few bytes, have no such cost.
 */
export const MAX_SVG_BYTES = 2 * 1024 * 1024;

export function detectImageType(bytes: Uint8Array): UploadedImageType | null {
  if (starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (starts(bytes, [0xff, 0xd8, 0xff])) return "jpg";
  if (starts(bytes, ascii("GIF87a")) || starts(bytes, ascii("GIF89a"))) return "gif";
  if (starts(bytes, ascii("RIFF")) && starts(bytes, ascii("WEBP"), 8)) return "webp";
  if (starts(bytes, ascii("ftyp"), 4) && (starts(bytes, ascii("avif"), 8) || starts(bytes, ascii("avis"), 8))) return "avif";
  return bytes.byteLength <= MAX_SVG_BYTES && isSvgDocument(bytes) ? "svg" : null;
}

function isSvgDocument(bytes: Uint8Array): boolean {
  let text: string;
  try {
    // Markup that is not valid UTF-8 is not something a browser would draw as this SVG either.
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return false;
  }
  return isSvg(text);
}
