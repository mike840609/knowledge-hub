import { createHash } from "node:crypto";
import { canonicalizeJsonObject, type KnowledgeMetadata } from "@/modules/knowledge/domain/content";

const RECONCILIATION_FINGERPRINT_PREFIX = "knowledge-import-reconcile:v1";

export function fingerprintReconciliationContent(input: {
  markdown: string;
  metadata: KnowledgeMetadata;
}): string {
  const payload = JSON.stringify({
    markdown: input.markdown.replace(/\r\n/g, "\n"),
    metadata: canonicalizeJsonObject(input.metadata),
  });
  return createHash("sha256")
    .update(`${RECONCILIATION_FINGERPRINT_PREFIX}\0${payload}`, "utf8")
    .digest("hex");
}
