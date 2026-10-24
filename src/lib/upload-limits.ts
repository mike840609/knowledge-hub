// Vercel caps a Function request body at 4.5 MB. Keep 4 MiB of file bytes plus
// multipart framing comfortably below it. The middleware body is skipped in
// vercel.json (it never reads bodies), so this cap is the function cap only.
export const MAX_UPLOAD_BATCH_BYTES = 4 * 1024 * 1024;
