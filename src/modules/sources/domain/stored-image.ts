import { imageContentType } from "@/shared/markdown/image-path";

/** An asset row whose bytes are in the blob store. */
export function isStoredImage(asset: { sourcePath: string; contentHash: string | null; metadata: Record<string, unknown> }): boolean {
  return asset.contentHash !== null && asset.metadata.stored === true && imageContentType(asset.sourcePath) !== null;
}

/**
 * Whether an import must send an image's bytes. Not when this same source
 * already stores that hash; an empty file is recorded but never stored.
 */
export function needsImageBytes(entry: { relativePath: string; size: number; contentHash: string }, storedHashes: ReadonlySet<string>): boolean {
  return entry.size > 0 && imageContentType(entry.relativePath) !== null && !storedHashes.has(entry.contentHash);
}
