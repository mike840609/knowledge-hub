import { createHash } from "node:crypto";
import { InvalidMetadataError, InvalidTitleError, ValidationError } from "./errors";

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
