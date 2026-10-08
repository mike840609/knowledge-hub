/** Runs once when the server starts: a misconfigured image volume stops the server, not the first upload. */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  (await import("@/server/blob-store")).configuredBlobStore();
}
