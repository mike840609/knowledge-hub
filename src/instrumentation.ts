/**
 * Runs once when the server starts: a misconfigured image store stops the
 * server, not the first upload.
 *
 * The condition must be written exactly this way. Next compiles this file for
 * the edge runtime as well, and only `NEXT_RUNTIME === "nodejs"` lets it drop
 * the import there. An early return on `!== "nodejs"` leaves the import in,
 * and `next dev` then fails on `node:crypto` and answers every request with 500.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await (await import("@/server/blob-store")).verifyBlobStore();
  }
}
