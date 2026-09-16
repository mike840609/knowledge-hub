import { fromMarkdown } from "mdast-util-from-markdown";
import { toString } from "mdast-util-to-string";
import { parseDocument } from "yaml";
import { resolveImportTitle } from "@/modules/sources/domain/import-title";
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

function extractFrontmatterTitle(markdown: string): unknown {
  const normalized = markdown.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (lines[0] !== "---") return undefined;

  const closingIndex = lines.findIndex((line, index) => index > 0 && line === "---");
  if (closingIndex < 0) return undefined;

  const yamlText = lines.slice(1, closingIndex).join("\n");
  try {
    const document = parseDocument(yamlText, {
      prettyErrors: false,
      strict: false,
    });
    const metadata = document.toJS({ maxAliasCount: 50 }) as Record<string, unknown> | null;
    return metadata?.title;
  } catch {
    return undefined;
  }
}

function extractFirstH1(markdown: string): string | null {
  try {
    const tree = fromMarkdown(markdown);
    for (const node of tree.children) {
      if (node.type !== "heading" || node.depth !== 1) continue;
      const text = toString(node).trim();
      if (text) return text;
    }
  } catch {
    // If markdown parsing fails, just return null
  }
  return null;
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
  const frontmatterTitle = extractFrontmatterTitle(markdown);
  const firstH1 = extractFirstH1(markdown);
  const resolved = resolveImportTitle({
    sourcePath: filename,
    frontmatterTitle,
    firstH1,
  });
  return { title: checkedTitle(resolved.title), markdown };
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
