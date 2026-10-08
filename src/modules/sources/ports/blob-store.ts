export type BlobBody = ReadableStream<Uint8Array>;

/** Bytes did not match the hash or size they were declared with. */
export class BlobMismatchError extends Error {
  constructor() { super("Blob bytes do not match the declared hash and size."); this.name = "BlobMismatchError"; }
}

/**
 * Content-addressed storage for image bytes. The key is the lowercase hex
 * SHA-256 of the content, so content under a key never changes.
 */
export interface BlobStore {
  /** Always reads and verifies `body`, even when the key exists: possession is the caller's to prove. */
  put(sha256: string, body: BlobBody, expectedSize: number): Promise<void>;
  open(sha256: string): Promise<{ body: BlobBody; size: number } | null>;
  has(sha256: string): Promise<boolean>;
  remove(sha256: string): Promise<void>;
  list(): AsyncIterable<{ sha256: string; modifiedAt: Date }>;
}
