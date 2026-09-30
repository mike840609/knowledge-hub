import { parseGenericMarkdownText, sourceFileHash } from "@/modules/sources/adapters/generic-markdown-folder-adapter";
import { SourceImportError } from "@/modules/sources/domain/import-errors";
import { DomainError } from "@/shared/domain/errors";
import type { KnowledgeMetadata } from "@/modules/knowledge/domain/content";
import { MAX_FOLDER_NAME_LENGTH, normalizeFolderName } from "@/modules/knowledge/domain/tree-rules";
import { isUuid } from "@/shared/ids/uuidv7";

export const MAX_TITLE_LENGTH = 512;
export { MAX_FOLDER_NAME_LENGTH };
export const MAX_MARKDOWN_BYTES = 5 * 1024 * 1024;

function invalid(message: string): never {
  throw new DomainError("INVALID_REQUEST", message);
}

function readObject(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) invalid("Provide a JSON object.");
  return body as Record<string, unknown>;
}

function readString(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== "string") invalid(`Provide ${field} as a string.`);
  return value;
}

function readMarkdown(record: Record<string, unknown>): string {
  const markdown = readString(record, "markdown");
  if (Buffer.byteLength(markdown, "utf8") > MAX_MARKDOWN_BYTES) invalid("Markdown is too large.");
  return markdown;
}

function checkedTitle(raw: string): string {
  const title = raw.trim();
  if (!title) invalid("Provide a non-empty title.");
  if (title.length > MAX_TITLE_LENGTH) invalid("Title is too long.");
  return title;
}

/** An ID that names a row. Anything else would reach the database as a malformed UUID and come back as a 500. */
function readId(record: Record<string, unknown>, field: string): string {
  const value = readString(record, field);
  if (!isUuid(value)) invalid(`Provide ${field} as an ID.`);
  return value;
}

/** `null` and an omitted field both mean the top level; anything else must be an ID. */
function readOptionalParentId(record: Record<string, unknown>): string | null {
  const value = record.parentId;
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !isUuid(value)) invalid("Provide parentId as an ID, or null for the top level.");
  return value;
}

function checkedFolderName(raw: string): string {
  // The domain's rule: trimmed, and not empty. Its error is a ValidationError, which is a 400 like the rest.
  const name = normalizeFolderName(raw);
  if (name.length > MAX_FOLDER_NAME_LENGTH) invalid("Folder name is too long.");
  return name;
}

/** The ID in a route's path is not shaped by the caller's body, so it is checked the same way: a malformed one is a 400, not a database error. */
export function requireRouteId(value: string, what: string): string {
  if (!isUuid(value)) invalid(`Provide ${what} as an ID.`);
  return value;
}

export function parseCreateFolderInput(body: unknown): { sourceId: string | null; parentId: string | null; name: string } {
  const record = readObject(body);
  return {
    sourceId: record.sourceId === undefined || record.sourceId === null ? null : readId(record, "sourceId"),
    parentId: readOptionalParentId(record),
    name: checkedFolderName(readString(record, "name")),
  };
}

export function parseRenameFolderInput(body: unknown): { name: string } {
  return { name: checkedFolderName(readString(readObject(body), "name")) };
}

export function parseCreateDocumentInput(body: unknown): { title: string; markdown: string; metadata: KnowledgeMetadata; parentId: string | null } {
  const record = readObject(body);
  const parentId = readOptionalParentId(record);
  const hasTitle = record.title !== undefined;
  const hasFilename = record.filename !== undefined;
  if (hasTitle === hasFilename) invalid("Provide exactly one of title or filename.");
  const markdown = readMarkdown(record);
  if (hasTitle) return { title: checkedTitle(readString(record, "title")), markdown, metadata: {}, parentId };

  // Upload path: the same frontmatter → H1 → filename precedence folder import uses,
  // and the same frontmatter-stripped body / frontmatter-as-metadata storage
  // (spec §6.2) — matching finalize-folder-import.ts so the same .md file
  // produces the same stored content whether it arrives by import or upload.
  const filename = readString(record, "filename");
  try {
    const hash = sourceFileHash(new TextEncoder().encode(markdown));
    const parsed = parseGenericMarkdownText({
      sourcePath: filename,
      text: markdown,
      sourceFileHash: hash,
    });
    return { title: checkedTitle(parsed.resolvedTitle), markdown: parsed.markdown, metadata: parsed.metadata, parentId };
  } catch (error) {
    if (error instanceof SourceImportError) {
      invalid(error.message);
    }
    throw error;
  }
}

export function parseUpdateDocumentInput(body: unknown): {
  title: string;
  markdown: string;
  expectedCurrentRevisionId: string;
} {
  const record = readObject(body);
  return {
    title: checkedTitle(readString(record, "title")),
    markdown: readMarkdown(record),
    expectedCurrentRevisionId: readString(record, "expectedCurrentRevisionId"),
  };
}
