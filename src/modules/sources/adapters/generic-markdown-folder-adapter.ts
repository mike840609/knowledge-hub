import { createHash } from "node:crypto";
import { fromMarkdown } from "mdast-util-from-markdown";
import { toString } from "mdast-util-to-string";
import { parseDocument } from "yaml";
import {
  canonicalizeJsonObject,
  fingerprintRevisionContent,
  type KnowledgeMetadata,
} from "@/modules/knowledge/domain/content";
import { importError, SourceImportError } from "@/modules/sources/domain/import-errors";
import { fingerprintReconciliationContent } from "@/modules/sources/domain/reconciliation-fingerprint";
import type { ParsedMarkdownEntry } from "@/modules/sources/domain/import-snapshot";
import { resolveImportTitle } from "@/modules/sources/domain/import-title";

export function decodeUtf8Markdown(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\ufeff/u, "");
  } catch {
    throw importError("INVALID_MARKDOWN_ENCODING", "Markdown must be valid UTF-8 or UTF-8 with BOM.");
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function splitFrontmatter(text: string): { body: string; metadata: KnowledgeMetadata } {
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (lines[0] !== "---") return { body: normalized, metadata: {} };

  const closingIndex = lines.findIndex((line, index) => index > 0 && line === "---");
  if (closingIndex < 0) {
    throw importError("INVALID_FRONTMATTER", "Frontmatter opening delimiter is missing a closing delimiter.");
  }

  const yamlText = lines.slice(1, closingIndex).join("\n");
  const body = lines.slice(closingIndex + 1).join("\n");

  try {
    const document = parseDocument(yamlText, {
      prettyErrors: false,
      strict: true,
      uniqueKeys: true,
      version: "1.2",
    });
    if (document.errors.length > 0) {
      throw importError("INVALID_FRONTMATTER", document.errors[0].message);
    }
    if (document.warnings.length > 0) {
      throw importError("INVALID_FRONTMATTER", document.warnings[0].message);
    }

    // An empty fence (blank lines or comments only) carries no root node at all,
    // and yaml reports that as `contents === null`. Spec §7.3 maps frontmatter to
    // Revision.metadata, so "no properties written" is empty metadata, not an error.
    // An explicit `null`/`~` literal stays blocking: the author wrote a root value,
    // and it is a scalar, so it lands in the non-object branch below.
    if (document.contents === null) {
      return { body, metadata: {} };
    }

    const value = document.toJS({ maxAliasCount: 50 });
    if (!isPlainObject(value)) {
      throw importError("FRONTMATTER_NOT_OBJECT", "Frontmatter root must be an object.");
    }
    return { body, metadata: canonicalizeJsonObject(value) };
  } catch (error) {
    if (error instanceof SourceImportError) throw error;
    throw importError("INVALID_FRONTMATTER", error instanceof Error ? error.message : "Frontmatter could not be parsed.");
  }
}

function firstH1(markdown: string): string | null {
  const tree = fromMarkdown(markdown);
  for (const node of tree.children) {
    if (node.type !== "heading" || node.depth !== 1) continue;
    const text = toString(node).trim();
    if (text) return text;
  }
  return null;
}

export function parseGenericMarkdownText(input: {
  sourcePath: string;
  text: string;
  sourceFileHash: string;
}): ParsedMarkdownEntry {
  const { body, metadata } = splitFrontmatter(input.text);
  const title = resolveImportTitle({
    sourcePath: input.sourcePath,
    frontmatterTitle: metadata.title,
    firstH1: firstH1(body),
  });
  const revision = fingerprintRevisionContent({ title: title.title, markdown: body, metadata });

  return {
    sourcePath: input.sourcePath,
    externalId: null,
    resolvedTitle: revision.normalized.title,
    titleSource: title.source,
    markdown: revision.normalized.markdown,
    metadata: revision.normalized.metadata,
    revisionContentHash: revision.contentHash,
    reconciliationFingerprint: fingerprintReconciliationContent({
      markdown: revision.normalized.markdown,
      metadata: revision.normalized.metadata,
    }),
    sourceFileHash: input.sourceFileHash,
    diagnostics: title.diagnostics,
  };
}

export function sourceFileHash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
