import type { KnowledgeMetadata } from "@/modules/knowledge/domain/content";
import { importError } from "./import-errors";

export const MARKDOWN_SOURCE_IDENTITY_FIELD = "knowledge_id";
export const MAX_SOURCE_EXTERNAL_ID_CHARS = 512;

export function splitMarkdownSourceIdentity(metadata: KnowledgeMetadata): {
  externalId: string | null;
  metadata: KnowledgeMetadata;
} {
  if (!Object.prototype.hasOwnProperty.call(metadata, MARKDOWN_SOURCE_IDENTITY_FIELD)) {
    return { externalId: null, metadata };
  }
  const raw = metadata[MARKDOWN_SOURCE_IDENTITY_FIELD];
  if (typeof raw !== "string") {
    throw importError("INVALID_KNOWLEDGE_ID", "knowledge_id must be a string.");
  }
  const externalId = raw.trim();
  if (externalId.length === 0 || Array.from(externalId).length > MAX_SOURCE_EXTERNAL_ID_CHARS) {
    throw importError("INVALID_KNOWLEDGE_ID", "knowledge_id must contain 1 to 512 characters after trimming.");
  }
  return { externalId, metadata: stripLegacyMarkdownSourceIdentity(metadata) };
}

export function stripLegacyMarkdownSourceIdentity(metadata: KnowledgeMetadata): KnowledgeMetadata {
  if (!Object.prototype.hasOwnProperty.call(metadata, MARKDOWN_SOURCE_IDENTITY_FIELD)) return metadata;
  const contentMetadata = { ...metadata };
  delete contentMetadata[MARKDOWN_SOURCE_IDENTITY_FIELD];
  return contentMetadata;
}
