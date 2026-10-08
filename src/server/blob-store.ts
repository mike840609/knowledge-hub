import { accessSync, constants, statSync } from "node:fs";
import { FilesystemBlobStore } from "@/infrastructure/storage/filesystem-blob-store";
import { S3BlobStore, S3RequestError, type S3Config } from "@/infrastructure/storage/s3-blob-store";
import type { BlobStore } from "@/modules/sources/ports/blob-store";

let store: BlobStore | null | undefined;

function s3Config(): S3Config | null {
  const bucket = process.env.KM_BLOB_S3_BUCKET;
  if (!bucket) return null;
  const required = (name: string): string => {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is required when KM_BLOB_S3_BUCKET is set.`);
    return value;
  };
  const endpoint = required("KM_BLOB_S3_ENDPOINT");
  if (!/^https?:\/\/[^/]/.test(endpoint)) throw new Error("KM_BLOB_S3_ENDPOINT must be an http(s) URL, for example https://minio.example.internal:9000.");
  const prefix = (process.env.KM_BLOB_S3_PREFIX ?? "").replace(/^\/+|\/+$/g, "");
  return {
    endpoint, bucket,
    accessKey: required("KM_BLOB_S3_ACCESS_KEY"),
    secretKey: required("KM_BLOB_S3_SECRET_KEY"),
    region: process.env.KM_BLOB_S3_REGION || "us-east-1",
    prefix: prefix ? `${prefix}/` : "",
  };
}

/**
 * The image store, or null when none is configured and images stay
 * reference-only. Two kinds, never both:
 *
 * - `KM_BLOB_S3_BUCKET` (with endpoint and keys): an S3-compatible bucket such as MinIO.
 * - `KM_BLOB_DIR`: a directory. It is never created here: a path that does not
 *   exist usually means the volume was not mounted, and creating it would put
 *   images in a container layer that the next deploy throws away.
 */
export function configuredBlobStore(): BlobStore | null {
  if (store !== undefined) return store;
  const s3 = s3Config();
  const dir = process.env.KM_BLOB_DIR;
  if (s3 && dir) throw new Error("Set KM_BLOB_S3_BUCKET or KM_BLOB_DIR, not both: images are stored in one place.");
  if (s3) return (store = new S3BlobStore(s3));
  if (!dir) return (store = null);
  try {
    if (!statSync(dir).isDirectory()) throw new Error("not a directory");
    accessSync(dir, constants.W_OK);
  } catch {
    throw new Error(`KM_BLOB_DIR (${dir}) must be an existing, writable directory. Mount the image volume there, or unset KM_BLOB_DIR to keep images as references only.`);
  }
  return (store = new FilesystemBlobStore(dir));
}

/**
 * Start-up check. A configuration error stops the server: bad settings, or a
 * bucket that answers and refuses (wrong keys, no such bucket). A bucket that
 * cannot be reached at all is only logged: an outage of the image store must
 * not keep the text of every document offline.
 */
export async function verifyBlobStore(): Promise<void> {
  const configured = configuredBlobStore();
  if (!(configured instanceof S3BlobStore)) return;
  try {
    await configured.check();
  } catch (error) {
    if (error instanceof S3RequestError) throw new Error(`${error.message} Check KM_BLOB_S3_BUCKET, KM_BLOB_S3_ACCESS_KEY and KM_BLOB_S3_SECRET_KEY.`);
    console.warn("Image storage (S3) is unreachable; images will not load until it is.", error instanceof Error ? error.name : "UnknownError");
  }
}
