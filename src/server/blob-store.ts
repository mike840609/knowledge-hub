import { accessSync, constants, statSync } from "node:fs";
import { FilesystemBlobStore } from "@/infrastructure/storage/filesystem-blob-store";
import type { BlobStore } from "@/modules/sources/ports/blob-store";

let store: BlobStore | null | undefined;

/**
 * The image store, or null when `KM_BLOB_DIR` is unset and images stay
 * reference-only. The directory is never created here: a path that does not
 * exist usually means the volume was not mounted, and creating it would put
 * images in a container layer that the next deploy throws away.
 */
export function configuredBlobStore(): BlobStore | null {
  if (store !== undefined) return store;
  const dir = process.env.KM_BLOB_DIR;
  if (!dir) return (store = null);
  try {
    if (!statSync(dir).isDirectory()) throw new Error("not a directory");
    accessSync(dir, constants.W_OK);
  } catch {
    throw new Error(`KM_BLOB_DIR (${dir}) must be an existing, writable directory. Mount the image volume there, or unset KM_BLOB_DIR to keep images as references only.`);
  }
  return (store = new FilesystemBlobStore(dir));
}
