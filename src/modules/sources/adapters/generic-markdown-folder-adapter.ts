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
import type { ImportDiagnostic } from "@/modules/sources/domain/import-diagnostic";
import { resolveImportTitle } from "@/modules/sources/domain/import-title";

import { splitMarkdownSourceIdentity } from "@/modules/sources/domain/markdown-source-identity";

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

/**
 * Parses a fenced frontmatter block. Throws INVALID_FRONTMATTER / FRONTMATTER_NOT_OBJECT,
 * which splitFrontmatter reports as warnings rather than letting one file block a folder.
 */
function parseFrontmatterYaml(yamlText: string): KnowledgeMetadata {
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
    // An explicit `null`/`~` literal is not: the author wrote a root value, and it
    // is a scalar, so it lands in the non-object branch below.
    if (document.contents === null) return {};

    const value = document.toJS({ maxAliasCount: 50 });
    if (!isPlainObject(value)) {
      throw importError("FRONTMATTER_NOT_OBJECT", "Frontmatter root must be an object.");
    }
    return canonicalizeJsonObject(value);
  } catch (error) {
    if (error instanceof SourceImportError) throw error;
    throw importError("INVALID_FRONTMATTER", error instanceof Error ? error.message : "Frontmatter could not be parsed.");
  }
}

/**
 * What to do with frontmatter that cannot be read. A folder sync warns (spec §7.2,
 * amended 2026-10-07): the note imports with its body and no properties, so one
 * mistyped title (`title: Git: tips`) no longer stops a whole folder from syncing, now
 * or on every later sync, and a document whose established `knowledge_id` can no longer
 * be read is still refused by reconciliation (IDENTITY_CONFLICT). A single file a person
 * uploads is rejected instead, the default: they are there to fix it, and silently
 * dropping its properties would store something other than what they gave.
 */
export type UnreadableFrontmatter = "warn" | "reject";

function splitFrontmatter(text: string, sourcePath: string, unreadable: UnreadableFrontmatter): { body: string; metadata: KnowledgeMetadata; diagnostics: ImportDiagnostic[] } {
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (lines[0] !== "---") return { body: normalized, metadata: {}, diagnostics: [] };

  const closingIndex = lines.findIndex((line, index) => index > 0 && line === "---");
  if (closingIndex < 0) {
    if (unreadable === "reject") throw importError("INVALID_FRONTMATTER", "Frontmatter opening delimiter is missing a closing delimiter.");
    // No closing fence: nothing marks where properties end, so the whole file is body.
    return {
      body: normalized,
      metadata: {},
      diagnostics: [unreadableFrontmatter("INVALID_FRONTMATTER", sourcePath, "The opening --- has no closing ---")],
    };
  }

  const body = lines.slice(closingIndex + 1).join("\n");
  try {
    return { body, metadata: parseFrontmatterYaml(lines.slice(1, closingIndex).join("\n")), diagnostics: [] };
  } catch (error) {
    if (unreadable === "reject" || !(error instanceof SourceImportError) || (error.code !== "INVALID_FRONTMATTER" && error.code !== "FRONTMATTER_NOT_OBJECT")) throw error;
    return { body, metadata: {}, diagnostics: [unreadableFrontmatter(error.code, sourcePath, error.message)] };
  }
}

function unreadableFrontmatter(code: "INVALID_FRONTMATTER" | "FRONTMATTER_NOT_OBJECT", sourcePath: string, reason: string): ImportDiagnostic {
  return {
    code,
    severity: "WARNING",
    sourcePath,
    message: `Frontmatter could not be read (${reason.trim().replace(/[.\s]+$/u, "")}). The note was imported without its properties; fix the YAML in the file and sync again to bring them in.`,
  };
}

function h1In(markdown: string): string | null {
  for (const node of fromMarkdown(markdown).children) {
    if (node.type !== "heading" || node.depth !== 1) continue;
    const text = toString(node).trim();
    if (text) return text;
  }
  return null;
}

/** A line that can make an H1: an ATX "# " heading or a setext "===" underline. */
// `$` under the m flag also ends a line before "\r", so CRLF notes match too.
const H1_CANDIDATE = /^ {0,3}(?:#(?:[ \t]|$)|=+[ \t]*$)/m;

/**
 * Parsing a whole note just to find its H1 was most of finalize's time. CommonMark settles a
 * line's block structure from the lines before it, so the text up to the first candidate line
 * parses there exactly as the whole note does. A heading containing "[" may hold a reference
 * link whose definition comes later, and a candidate that is no top-level H1 (in a code block,
 * a list) leaves the answer further on; both read the whole note.
 */
function firstH1(markdown: string): string | null {
  const candidate = H1_CANDIDATE.exec(markdown);
  if (!candidate) return null;
  const lineEnd = markdown.indexOf("\n", candidate.index);
  if (lineEnd === -1) return h1In(markdown);
  const early = h1In(markdown.slice(0, lineEnd));
  return early !== null && !early.includes("[") ? early : h1In(markdown);
}

export function parseGenericMarkdownText(input: {
  sourcePath: string;
  text: string;
  sourceFileHash: string;
  unreadableFrontmatter?: UnreadableFrontmatter;
}): ParsedMarkdownEntry {
  const parsedFrontmatter = splitFrontmatter(input.text, input.sourcePath, input.unreadableFrontmatter ?? "reject");
  const { externalId, metadata } = splitMarkdownSourceIdentity(parsedFrontmatter.metadata);
  const body = parsedFrontmatter.body;
  const title = resolveImportTitle({
    sourcePath: input.sourcePath,
    frontmatterTitle: metadata.title,
    firstH1: firstH1(body),
  });
  const revision = fingerprintRevisionContent({ title: title.title, markdown: body, metadata });

  return {
    sourcePath: input.sourcePath,
    externalId,
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
    diagnostics: [...parsedFrontmatter.diagnostics, ...title.diagnostics],
  };
}

export function sourceFileHash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
