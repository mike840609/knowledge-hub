import { createHash, randomBytes } from "node:crypto";

/** `khx_` marks a Knowledge Hub export token, so a secret scan can recognise one. */
export const EXPORT_TOKEN_PREFIX = "khx_";

export function issueExportToken(): string {
  return `${EXPORT_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

/** Only this hash is stored; the plaintext token is shown once and never persisted. */
export function hashExportToken(token: string): Uint8Array {
  return createHash("sha256").update(token, "utf8").digest();
}
