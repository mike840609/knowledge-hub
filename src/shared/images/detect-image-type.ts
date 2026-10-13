export type UploadedImageType = "png" | "jpg" | "gif" | "webp" | "avif";

const starts = (bytes: Uint8Array, signature: readonly number[], at = 0) => signature.every((byte, index) => bytes[at + index] === byte);
const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));

/**
 * What an uploaded image is, read from its leading bytes: the name and the
 * browser's content type are the uploader's claims. SVG is deliberately not
 * here; it is text, and nothing in its first bytes sets it apart from any
 * other markup.
 */
export function detectImageType(bytes: Uint8Array): UploadedImageType | null {
  if (starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (starts(bytes, [0xff, 0xd8, 0xff])) return "jpg";
  if (starts(bytes, ascii("GIF87a")) || starts(bytes, ascii("GIF89a"))) return "gif";
  if (starts(bytes, ascii("RIFF")) && starts(bytes, ascii("WEBP"), 8)) return "webp";
  if (starts(bytes, ascii("ftyp"), 4) && (starts(bytes, ascii("avif"), 8) || starts(bytes, ascii("avis"), 8))) return "avif";
  return null;
}
