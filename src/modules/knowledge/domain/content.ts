import { createHash } from "node:crypto";
import { InvalidMetadataError, InvalidTitleError, KnowledgeError, ValidationError } from "./errors";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type KnowledgeMetadata = { [key: string]: JsonValue };

export type ContentInput = {
  title: string;
  markdown: string;
  metadata: KnowledgeMetadata;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeValue(value: unknown, path: string): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new InvalidMetadataError(`Metadata contains a non-finite number at ${path}.`);
    return value;
  }
  if (Array.isArray(value)) {
    const result: JsonValue[] = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!(index in value)) throw new InvalidMetadataError(`Metadata contains a sparse array hole at ${path}[${index}].`);
      result.push(normalizeValue(value[index], `${path}[${index}]`));
    }
    return result;
  }
  if (isPlainObject(value)) {
    const result: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
    for (const key of Object.keys(value).sort()) {
      const item = value[key];
      if (typeof item === "undefined") throw new InvalidMetadataError(`Metadata contains undefined at ${path}.${key}.`);
      result[key] = normalizeValue(item, `${path}.${key}`);
    }
    return result;
  }
  throw new InvalidMetadataError(`Metadata contains a value that cannot be represented as JSON at ${path}.`);
}

export function normalizeContent(input: ContentInput): ContentInput {
  if (typeof input.title !== "string" || input.title.length === 0) {
    throw new InvalidTitleError();
  }
  if (typeof input.markdown !== "string") throw new ValidationError("Markdown must be a string.");
  if (!isPlainObject(input.metadata)) throw new InvalidMetadataError();
  return {
    title: input.title,
    markdown: input.markdown,
    metadata: normalizeValue(input.metadata, "metadata") as KnowledgeMetadata,
  };
}

export function canonicalContent(input: ContentInput): string {
  return JSON.stringify(normalizeContent(input));
}

export function contentFingerprint(input: ContentInput): string {
  return createHash("sha256").update(canonicalContent(input), "utf8").digest("hex");
}

export function sameContent(left: ContentInput, right: ContentInput): boolean {
  return canonicalContent(left) === canonicalContent(right);
}

// Phase 1 revision canonicalization (spec §13 / §13.1): revision content is
// exactly title + markdown + metadata. Historical rows keep their original
// bytes/hash; NOOP detection compares canonical payloads, never stored hash
// against new hash, via isSameRevisionContent.

export type RevisionContentInput = ContentInput;

export const REVISION_FINGERPRINT_PREFIX = "knowledge-revision:v1";

export function canonicalizeJsonObject(metadata: Record<string, unknown>): KnowledgeMetadata {
  if (!isPlainObject(metadata)) throw new InvalidMetadataError();
  return normalizeValue(metadata, "metadata") as KnowledgeMetadata;
}

// Candidate-only validator. Never pass a stored legacy row through this function.
export function normalizeRevisionContent(input: RevisionContentInput): RevisionContentInput {
  const title = input.title.trim();
  if (!title) throw new KnowledgeError("INVALID_TITLE");

  return {
    title,
    markdown: input.markdown.replace(/\r\n/g, "\n"),
    metadata: canonicalizeJsonObject(input.metadata),
  };
}

export type StoredRevisionContent = {
  title: string;
  markdown: string;
  metadata: Record<string, unknown>;
};

// Stored-side comparison normalizer (spec §13.1). Permits the empty trimmed
// legacy title that Phase 0 accepted; candidate-only normalization above
// retains the non-empty validation.
export function normalizeStoredRevisionContent(input: StoredRevisionContent): ContentInput {
  if (typeof input.title !== "string") throw new InvalidTitleError();
  if (typeof input.markdown !== "string") throw new ValidationError("Markdown must be a string.");
  return {
    title: input.title.trim(),
    markdown: input.markdown.replace(/\r\n/g, "\n"),
    metadata: canonicalizeJsonObject(input.metadata as Record<string, unknown>),
  };
}

export function canonicalJson(normalized: ContentInput): string {
  return JSON.stringify({ title: normalized.title, markdown: normalized.markdown, metadata: normalized.metadata });
}

export function revisionContentPayload(normalized: ContentInput): string {
  return `${REVISION_FINGERPRINT_PREFIX}\0${canonicalJson(normalized)}`;
}

export function revisionContentHash(normalized: ContentInput): string {
  return createHash("sha256").update(revisionContentPayload(normalized), "utf8").digest("hex");
}

export function fingerprintRevisionContent(input: RevisionContentInput): { normalized: RevisionContentInput; contentHash: string } {
  const normalized = normalizeRevisionContent(input);
  return { normalized, contentHash: revisionContentHash(normalized) };
}

// Spec §13.1 legacy comparator: normalize the stored row with the lenient
// stored-side normalizer and the candidate with the strict candidate-only
// validator, then compare canonical payloads. The stored contentHash is never
// consulted, so Phase 0 rows (unprefixed SHA-256) compare correctly.
export function isSameRevisionContent(stored: StoredRevisionContent, candidate: RevisionContentInput): boolean {
  const storedPayload = revisionContentPayload(normalizeStoredRevisionContent(stored));
  const candidatePayload = revisionContentPayload(normalizeRevisionContent(candidate));
  return storedPayload === candidatePayload;
}
