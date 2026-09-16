import { parseGenericMarkdownText, sourceFileHash } from "@/modules/sources/adapters/generic-markdown-folder-adapter";
import { SourceImportError } from "@/modules/sources/domain/import-errors";
import { DomainError } from "@/shared/domain/errors";

export const MAX_TITLE_LENGTH = 512;
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

export function parseCreateDocumentInput(body: unknown): { title: string; markdown: string } {
  const record = readObject(body);
  const hasTitle = record.title !== undefined;
  const hasFilename = record.filename !== undefined;
  if (hasTitle === hasFilename) invalid("Provide exactly one of title or filename.");
  const markdown = readMarkdown(record);
  if (hasTitle) return { title: checkedTitle(readString(record, "title")), markdown };

  // Upload path: the same frontmatter → H1 → filename precedence folder import uses.
  const filename = readString(record, "filename");
  try {
    const hash = sourceFileHash(new TextEncoder().encode(markdown));
    const parsed = parseGenericMarkdownText({
      sourcePath: filename,
      text: markdown,
      sourceFileHash: hash,
    });
    return { title: checkedTitle(parsed.resolvedTitle), markdown };
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
