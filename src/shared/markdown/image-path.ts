// A Map, not an object: "constructor" must not look like a known extension.
const CONTENT_TYPES = new Map([
  ["png", "image/png"], ["jpg", "image/jpeg"], ["jpeg", "image/jpeg"], ["gif", "image/gif"],
  ["webp", "image/webp"], ["avif", "image/avif"], ["svg", "image/svg+xml"],
]);

/** The content type an image path is served with; null when the path is not an image we store. */
export function imageContentType(path: string): string | null {
  const match = /\.([a-z0-9]+)$/i.exec(path);
  return match ? CONTENT_TYPES.get(match[1].toLowerCase()) ?? null : null;
}

/**
 * Where an image `src`, as a document writes it, points inside the source.
 * A leading `/` is the source root. Null for a URL, and for a path that leaves the root.
 */
export function resolveImagePath(documentPath: string, src: string): string | null {
  const bare = src.trim().split(/[?#]/, 1)[0];
  if (!bare || /^[a-z][a-z0-9+.-]*:/i.test(bare) || bare.startsWith("//") || bare.includes("\\")) return null;
  let decoded: string;
  try { decoded = decodeURIComponent(bare); } catch { return null; }
  if (/[\u0000-\u001f\u007f]/u.test(decoded)) return null;
  const segments = decoded.startsWith("/") ? [] : documentPath.split("/").slice(0, -1);
  for (const segment of decoded.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") { if (segments.length === 0) return null; segments.pop(); continue; }
    segments.push(segment);
  }
  // "." names the document's folder, which is not a file.
  const namesFile = decoded.split("/").some((segment) => segment !== "" && segment !== "." && segment !== "..");
  return namesFile ? segments.join("/") : null;
}
