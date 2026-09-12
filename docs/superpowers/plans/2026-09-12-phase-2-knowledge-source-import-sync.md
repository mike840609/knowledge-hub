# Phase 2 Knowledge Source Import & Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Phase 2 whole-folder Markdown import and re-sync flow from raw browser folder input through immutable Preview to one atomic `SOURCE_MANAGED` canonical Apply.

**Architecture:** Keep ingestion inside the existing Sources module. Browser input becomes a persisted staging snapshot, server-side parsing produces canonical entries, a pure reconciler produces a persisted deterministic `FolderImportPlan`, and `ApplyFolderImportService` executes that plan through the existing Phase 1 transaction-bound projection/mapping primitives inside one `READ COMMITTED` Source transaction. The Web layer remains an adapter: identity comes from the trusted provider, `/knowledge` launches import/sync, and `/knowledge/imports/[snapshotId]` renders the persisted Preview.

**Tech Stack:** Next.js 15.5, React 19, TypeScript 5.7 strict mode, MariaDB 10.11/native UUID, `mariadb`, Vitest, Playwright, npm/package-lock, `yaml`, `mdast-util-from-markdown`, `mdast-util-to-string`, existing shadcn/base-ui components and Tailwind.

**Spec:** `docs/superpowers/specs/2026-09-12-phase-2-knowledge-source-import-sync-design.md`

## Global Constraints

- Node engine remains `>=20.9.0 <25`; use npm and commit `package-lock.json`.
- MariaDB remains canonical storage and existing UUIDv7/application-generated IDs remain the stable-ID contract.
- Phase 2 only implements Knowledge Source Import & Sync; production SSO, Workspace administration, MCP, search/embedding, Agent Memory, watchers, bidirectional sync, merge editing, and binary storage remain out of scope.
- Source folder is authority for `SOURCE_MANAGED` content. Hub Preview never edits source-managed Markdown.
- Scanner/parser/finalizer may write staging only; canonical Knowledge mutations occur only in Apply.
- READY snapshots and their persisted plans are immutable. Apply never re-reads the local folder, reparses upload bytes, or re-runs reconciliation.
- Generic Markdown adapter never infers `external_id` from frontmatter `id`, `uuid`, `slug`, or similar fields.
- Markdown canonical content is `resolved title + body Markdown without frontmatter + canonical metadata`.
- Reconciliation fingerprint is `body Markdown + canonical metadata`, intentionally excluding resolved title.
- Identity matching order is external ID, exact normalized path, unique unmatched reconciliation fingerprint, then new identity. Ambiguity is never guessed.
- Generic folder identity is exact normalized folder path only. Empty directories are not preserved.
- Assets are current metadata/reference projection only; binary bytes are not stored and asset rename/move is not inferred by hash.
- Existing-source Apply locks snapshot then Source and keeps `READ COMMITTED`; no Redis/distributed lock or force apply is introduced.
- One successful Confirm, including an all-UNCHANGED no-op sync, advances `sync_version` exactly once and writes exactly one APPLIED SyncRun.
- Blocking diagnostics prevent Apply; warnings do not. Partial canonical success is forbidden.
- Snapshot access is creator-private and every mutating operation re-checks current Workspace membership.
- Default import limits are exactly: 20,000 manifest entries; 2 KiB normalized UTF-8 path; 5 MiB per Markdown file; 256 MiB total Markdown; 256 KiB parsed metadata per document; 20 files / 10 MiB per upload batch; 3 BUILDING snapshots/user; 10 READY snapshots/user.
- Default retention is exactly: BUILDING 2 hours; READY 30 minutes after finalize; STALE 24 hours; APPLIED 24 hours.
- Implementation follows TDD. Do not expose test-only fault injection through HTTP or UI.

---

## File Structure to Lock In Before Coding

Create or modify these responsibility-focused files. Do not collapse the import pipeline into `source-version-guard.ts` or a single route component.

```text
src/modules/sources/
├─ adapters/
│  └─ generic-markdown-folder-adapter.ts      # safe UTF-8/frontmatter/AST parsing
├─ domain/
│  ├─ import-errors.ts                        # stable Phase 2 domain error codes
│  ├─ import-diagnostic.ts                    # WARNING/BLOCKING diagnostic shape
│  ├─ import-limits.ts                        # exact defaults + limit type
│  ├─ import-path.ts                          # normalization, ignore rules, path hash
│  ├─ import-snapshot.ts                      # manifest/staging/preview domain types
│  ├─ import-plan.ts                          # persisted action-plan contract
│  ├─ import-reconciler.ts                    # pure deterministic reconciliation
│  ├─ import-title.ts                         # title resolution
│  └─ reconciliation-fingerprint.ts           # body+metadata identity fingerprint
├─ application/
│  ├─ create-folder-import.ts                 # initial/resync BUILDING session creation
│  ├─ upload-folder-import-entries.ts         # raw-byte idempotent Markdown upload
│  ├─ reconcile-import-snapshot.ts            # load canonical state + pure reconcile
│  ├─ finalize-folder-import.ts               # BUILDING -> READY
│  ├─ source-import-plan-executor.ts           # execute persisted plan in open UoW
│  ├─ apply-folder-import.ts                  # lock/version/SyncRun atomic orchestration
│  └─ cleanup-folder-imports.ts               # bounded staging cleanup
└─ ports/
   ├─ import-snapshot-repository.ts
   ├─ import-snapshot-entry-repository.ts
   ├─ import-canonical-state-repository.ts
   └─ existing ports

src/infrastructure/database/mariadb/
├─ migrations/
│  ├─ 006-phase-2-import-staging.ts
│  ├─ 007-phase-2-asset-projection.ts
│  └─ index.ts
├─ asset-projection-validation.ts
└─ repositories/
   ├─ import-snapshots.ts
   ├─ import-snapshot-entries.ts
   ├─ import-canonical-state.ts
   ├─ assets.ts
   └─ index.ts

src/server/
├─ import-config.ts
├─ source-imports.ts
├─ http-error-response.ts
└─ composition.ts

src/app/api/
├─ workspaces/[workspaceId]/source-imports/route.ts
├─ sources/[sourceId]/source-imports/route.ts
└─ source-imports/[snapshotId]/
   ├─ route.ts
   ├─ entries/route.ts
   ├─ finalize/route.ts
   └─ apply/route.ts

src/components/knowledge/
├─ source-import-launcher.tsx
├─ source-import-preview.tsx
└─ source-import-preview-actions.tsx

src/app/knowledge/
├─ page.tsx
└─ imports/[snapshotId]/page.tsx

scripts/db/cleanup-import-snapshots.ts

tests/
├─ unit/
│  ├─ phase2-import-parser.test.ts
│  ├─ phase2-reconciler.test.ts
│  └─ phase2-import-http.test.ts
├─ integration/
│  ├─ phase2-import-schema.test.ts
│  ├─ phase2-import-session.test.ts
│  ├─ phase2-import-finalize.test.ts
│  ├─ phase2-import-apply.test.ts
│  ├─ phase2-import-concurrency.test.ts
│  └─ phase2-import-cleanup.test.ts
├─ e2e/source-import.spec.ts
└─ fixtures/import/
   ├─ basic-v1/
   ├─ basic-v2/
   ├─ malformed-frontmatter/
   ├─ title-resolution/
   ├─ duplicate-content/
   └─ assets/
```

---

### Task 1: Generic Markdown Adapter and Pure Import Primitives

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/modules/sources/domain/import-errors.ts`
- Create: `src/modules/sources/domain/import-diagnostic.ts`
- Create: `src/modules/sources/domain/import-limits.ts`
- Create: `src/modules/sources/domain/import-path.ts`
- Create: `src/modules/sources/domain/import-snapshot.ts`
- Create: `src/modules/sources/domain/import-title.ts`
- Create: `src/modules/sources/domain/reconciliation-fingerprint.ts`
- Create: `src/modules/sources/adapters/generic-markdown-folder-adapter.ts`
- Test: `tests/unit/phase2-import-parser.test.ts`

**Interfaces:**
- Consumes: `KnowledgeMetadata`, `canonicalizeJsonObject()`, and `fingerprintRevisionContent()` from `src/modules/knowledge/domain/content.ts`.
- Produces:

```ts
export type ImportSeverity = "WARNING" | "BLOCKING";

export type ImportDiagnostic = {
  code: string;
  severity: ImportSeverity;
  sourcePath: string | null;
  message: string;
  details?: Record<string, unknown>;
};

export type ImportTitleSource = "FRONTMATTER" | "H1" | "FILENAME";

export type ParsedMarkdownEntry = {
  sourcePath: string;
  externalId: null;
  resolvedTitle: string;
  titleSource: ImportTitleSource;
  markdown: string;
  metadata: KnowledgeMetadata;
  revisionContentHash: string;
  reconciliationFingerprint: string;
  sourceFileHash: string;
  diagnostics: ImportDiagnostic[];
};

export function normalizeImportPath(rawPath: string): { sourcePath: string; sourcePathHash: string };
export function isIgnoredImportPath(sourcePath: string): boolean;
export function decodeUtf8Markdown(bytes: Uint8Array): string;
export function parseGenericMarkdownText(input: { sourcePath: string; text: string; sourceFileHash: string }): ParsedMarkdownEntry;
export function fingerprintReconciliationContent(input: { markdown: string; metadata: KnowledgeMetadata }): string;
```

- [ ] **Step 1: Install the parser dependencies and write the failing parser/path/fingerprint tests**

Run:

```bash
npm install yaml mdast-util-from-markdown mdast-util-to-string
```

Create `tests/unit/phase2-import-parser.test.ts` with focused tests that pin every parser contract before implementation:

```ts
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decodeUtf8Markdown, parseGenericMarkdownText } from "@/modules/sources/adapters/generic-markdown-folder-adapter";
import { normalizeImportPath, isIgnoredImportPath } from "@/modules/sources/domain/import-path";
import { fingerprintReconciliationContent } from "@/modules/sources/domain/reconciliation-fingerprint";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

describe("Phase 2 import path rules", () => {
  it("normalizes separators and dot segments but preserves case", () => {
    expect(normalizeImportPath("Docs\\./K8s/Ingress.MD").sourcePath).toBe("Docs/K8s/Ingress.MD");
  });

  it("rejects root escape, absolute paths, NUL, and control characters", () => {
    for (const path of ["../secret.md", "/etc/passwd", "C:\\secret.md", "a\u0000b.md", "a\u001fb.md", "a\u007fb.md"]) {
      expect(() => normalizeImportPath(path)).toThrowError(expect.objectContaining({ code: "INVALID_SOURCE_PATH" }));
    }
  });

  it("ignores fixed hidden/system paths", () => {
    for (const path of [".git/config", ".obsidian/app.json", "node_modules/a.md", "docs/.cache/a.md", ".DS_Store", "Thumbs.db"]) {
      expect(isIgnoredImportPath(path)).toBe(true);
    }
    expect(isIgnoredImportPath("docs/visible.md")).toBe(false);
  });
});

describe("Phase 2 Markdown parsing", () => {
  it("accepts UTF-8 BOM and rejects invalid UTF-8", () => {
    expect(decodeUtf8Markdown(new Uint8Array([0xef, 0xbb, 0xbf, 0x23, 0x20, 0x41]))).toBe("# A");
    expect(() => decodeUtf8Markdown(new Uint8Array([0xc3, 0x28]))).toThrowError(expect.objectContaining({ code: "INVALID_MARKDOWN_ENCODING" }));
  });

  it("uses frontmatter title, stores body separately, and warns on H1 conflict", () => {
    const text = "---\ntitle: Canonical\ntags: [b, a]\n---\n# Different\n\nBody\n";
    const parsed = parseGenericMarkdownText({ sourcePath: "docs/a.md", text, sourceFileHash: sha256(text) });
    expect(parsed.resolvedTitle).toBe("Canonical");
    expect(parsed.titleSource).toBe("FRONTMATTER");
    expect(parsed.markdown).toBe("# Different\n\nBody\n");
    expect(parsed.metadata).toEqual({ tags: ["b", "a"], title: "Canonical" });
    expect(parsed.diagnostics.map((item) => item.code)).toContain("TITLE_CONFLICT");
  });

  it("uses the first real H1 and ignores fenced-code pseudo headings", () => {
    const text = "```md\n# Fake\n```\n\n# Real Heading\n";
    const parsed = parseGenericMarkdownText({ sourcePath: "docs/a.md", text, sourceFileHash: sha256(text) });
    expect(parsed.resolvedTitle).toBe("Real Heading");
    expect(parsed.titleSource).toBe("H1");
  });

  it("falls back to the filename stem without prettifying", () => {
    const text = "No heading\n";
    const parsed = parseGenericMarkdownText({ sourcePath: "docs/k8s-ingress.md", text, sourceFileHash: sha256(text) });
    expect(parsed.resolvedTitle).toBe("k8s-ingress");
    expect(parsed.titleSource).toBe("FILENAME");
  });

  it("keeps reconciliation fingerprint stable across filename-derived title rename", () => {
    const left = parseGenericMarkdownText({ sourcePath: "foo.md", text: "body\n", sourceFileHash: sha256("body\n") });
    const right = parseGenericMarkdownText({ sourcePath: "bar.md", text: "body\n", sourceFileHash: sha256("body\n") });
    expect(left.reconciliationFingerprint).toBe(right.reconciliationFingerprint);
    expect(left.revisionContentHash).not.toBe(right.revisionContentHash);
    expect(fingerprintReconciliationContent({ markdown: left.markdown, metadata: left.metadata })).toBe(left.reconciliationFingerprint);
  });
});
```

- [ ] **Step 2: Run the tests and verify the new imports/functions do not exist yet**

Run:

```bash
npm run test:unit -- tests/unit/phase2-import-parser.test.ts
```

Expected: FAIL because the Phase 2 domain/adapter modules are not defined.

- [ ] **Step 3: Implement the pure import errors, limits, path rules, title resolution, fingerprints, and adapter**

Create `src/modules/sources/domain/import-errors.ts`:

```ts
import { DomainError } from "@/shared/domain/errors";

export class SourceImportError extends DomainError {
  constructor(code: string, message: string) {
    super(code, message);
    this.name = "SourceImportError";
  }
}

export function importError(code: string, message: string): SourceImportError {
  return new SourceImportError(code, message);
}
```

Create `src/modules/sources/domain/import-diagnostic.ts`:

```ts
export type ImportSeverity = "WARNING" | "BLOCKING";

export type ImportDiagnostic = {
  code: string;
  severity: ImportSeverity;
  sourcePath: string | null;
  message: string;
  details?: Record<string, unknown>;
};
```

Create `src/modules/sources/domain/import-limits.ts`:

```ts
export type ImportLimits = {
  maxManifestEntries: number;
  maxPathBytes: number;
  maxMarkdownFileBytes: number;
  maxMarkdownTotalBytes: number;
  maxMetadataBytes: number;
  maxUploadBatchFiles: number;
  maxUploadBatchBytes: number;
  maxBuildingSnapshotsPerUser: number;
  maxReadySnapshotsPerUser: number;
};

export const DEFAULT_IMPORT_LIMITS: ImportLimits = {
  maxManifestEntries: 20_000,
  maxPathBytes: 2 * 1024,
  maxMarkdownFileBytes: 5 * 1024 * 1024,
  maxMarkdownTotalBytes: 256 * 1024 * 1024,
  maxMetadataBytes: 256 * 1024,
  maxUploadBatchFiles: 20,
  maxUploadBatchBytes: 10 * 1024 * 1024,
  maxBuildingSnapshotsPerUser: 3,
  maxReadySnapshotsPerUser: 10,
};
```

Create `src/modules/sources/domain/import-path.ts` with a SHA-256 helper and strict normalization. The Windows-drive check must run before converting backslashes so `C:\\x` cannot become a relative-looking `C:/x`:

```ts
import { createHash } from "node:crypto";
import { importError } from "./import-errors";

const CONTROL = /[\u0000-\u001f\u007f]/u;
const WINDOWS_ABSOLUTE = /^[A-Za-z]:[\\/]/u;

export function normalizeImportPath(rawPath: string): { sourcePath: string; sourcePathHash: string } {
  if (!rawPath || CONTROL.test(rawPath) || rawPath.startsWith("/") || WINDOWS_ABSOLUTE.test(rawPath)) {
    throw importError("INVALID_SOURCE_PATH", "Source paths must be safe relative paths.");
  }
  const parts = rawPath.replace(/\\/g, "/").split("/");
  const normalized: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") throw importError("INVALID_SOURCE_PATH", "Source paths cannot escape the selected folder.");
    normalized.push(part);
  }
  if (normalized.length === 0) throw importError("INVALID_SOURCE_PATH", "Source path cannot be empty.");
  const sourcePath = normalized.join("/");
  return { sourcePath, sourcePathHash: createHash("sha256").update(sourcePath, "utf8").digest("hex") };
}

export function isIgnoredImportPath(sourcePath: string): boolean {
  const parts = sourcePath.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.some((part) => part.startsWith("."))) return true;
  if (parts.includes("node_modules")) return true;
  const leaf = parts.at(-1);
  return leaf === ".DS_Store" || leaf === "Thumbs.db";
}
```

Create `src/modules/sources/domain/reconciliation-fingerprint.ts`:

```ts
import { createHash } from "node:crypto";
import { canonicalizeJsonObject, type KnowledgeMetadata } from "@/modules/knowledge/domain/content";

const PREFIX = "knowledge-import-reconcile:v1";

export function fingerprintReconciliationContent(input: { markdown: string; metadata: KnowledgeMetadata }): string {
  const payload = JSON.stringify({
    markdown: input.markdown.replace(/\r\n/g, "\n"),
    metadata: canonicalizeJsonObject(input.metadata),
  });
  return createHash("sha256").update(`${PREFIX}\0${payload}`, "utf8").digest("hex");
}
```

Create `src/modules/sources/domain/import-title.ts` with the approved priority and warning semantics:

```ts
import type { ImportDiagnostic } from "./import-diagnostic";

export type ImportTitleSource = "FRONTMATTER" | "H1" | "FILENAME";

export function resolveImportTitle(input: {
  sourcePath: string;
  frontmatterTitle: unknown;
  firstH1: string | null;
}): { title: string; source: ImportTitleSource; diagnostics: ImportDiagnostic[] } {
  const diagnostics: ImportDiagnostic[] = [];
  const frontmatterTitle = typeof input.frontmatterTitle === "string" ? input.frontmatterTitle.trim() : "";
  if (input.frontmatterTitle !== undefined && !frontmatterTitle) {
    diagnostics.push({ code: "INVALID_FRONTMATTER_TITLE", severity: "WARNING", sourcePath: input.sourcePath, message: "frontmatter.title must be a non-empty string; falling back." });
  }
  const h1 = input.firstH1?.trim() || null;
  if (frontmatterTitle) {
    if (h1 && h1 !== frontmatterTitle) diagnostics.push({ code: "TITLE_CONFLICT", severity: "WARNING", sourcePath: input.sourcePath, message: "frontmatter.title differs from the first H1; frontmatter.title wins.", details: { frontmatterTitle, h1 } });
    return { title: frontmatterTitle, source: "FRONTMATTER", diagnostics };
  }
  if (h1) return { title: h1, source: "H1", diagnostics };
  const filename = input.sourcePath.split("/").at(-1) ?? "";
  const stem = filename.replace(/\.(?:md|markdown)$/iu, "").trim();
  if (!stem) throw importError("INVALID_TITLE", "Markdown file could not resolve a non-empty title.");
  return { title: stem, source: "FILENAME", diagnostics };
}

import { importError } from "./import-errors";
```

Create `src/modules/sources/domain/import-snapshot.ts` with the shared parser/staging types:

```ts
import type { KnowledgeMetadata } from "@/modules/knowledge/domain/content";
import type { ImportDiagnostic } from "./import-diagnostic";
import type { ImportTitleSource } from "./import-title";

export type ImportSnapshotState = "BUILDING" | "READY" | "APPLIED" | "STALE";
export type ImportEntryType = "DOCUMENT" | "ASSET";
export type ImportUploadStatus = "PENDING" | "RECEIVED";

export type ParsedMarkdownEntry = {
  sourcePath: string;
  externalId: null;
  resolvedTitle: string;
  titleSource: ImportTitleSource;
  markdown: string;
  metadata: KnowledgeMetadata;
  revisionContentHash: string;
  reconciliationFingerprint: string;
  sourceFileHash: string;
  diagnostics: ImportDiagnostic[];
};
```

Create `src/modules/sources/adapters/generic-markdown-folder-adapter.ts`. Split frontmatter only when the document begins with a `---` delimiter, parse YAML to a plain JSON-compatible object, use Markdown AST for H1, and never resolve links or includes:

```ts
import { createHash } from "node:crypto";
import { fromMarkdown } from "mdast-util-from-markdown";
import { toString } from "mdast-util-to-string";
import { parseDocument } from "yaml";
import { canonicalizeJsonObject, fingerprintRevisionContent, type KnowledgeMetadata } from "@/modules/knowledge/domain/content";
import { importError } from "@/modules/sources/domain/import-errors";
import { resolveImportTitle } from "@/modules/sources/domain/import-title";
import { fingerprintReconciliationContent } from "@/modules/sources/domain/reconciliation-fingerprint";
import type { ParsedMarkdownEntry } from "@/modules/sources/domain/import-snapshot";

export function decodeUtf8Markdown(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\ufeff/u, "");
  } catch {
    throw importError("INVALID_MARKDOWN_ENCODING", "Markdown must be valid UTF-8 or UTF-8 with BOM.");
  }
}

function splitFrontmatter(text: string): { body: string; metadata: KnowledgeMetadata } {
  if (!text.startsWith("---\n") && !text.startsWith("---\r\n")) return { body: text, metadata: {} };
  const normalized = text.replace(/\r\n/g, "\n");
  const closing = normalized.indexOf("\n---\n", 4);
  if (closing < 0) throw importError("INVALID_FRONTMATTER", "Frontmatter opening delimiter is missing a closing delimiter.");
  const yamlText = normalized.slice(4, closing);
  const document = parseDocument(yamlText, { prettyErrors: false, strict: true, uniqueKeys: true });
  if (document.errors.length > 0) throw importError("INVALID_FRONTMATTER", document.errors[0].message);
  const value = document.toJS({ maxAliasCount: 50 });
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw importError("FRONTMATTER_NOT_OBJECT", "Frontmatter root must be an object.");
  return { body: normalized.slice(closing + 5), metadata: canonicalizeJsonObject(value as Record<string, unknown>) };
}

function firstH1(markdown: string): string | null {
  const root = fromMarkdown(markdown);
  for (const node of root.children) {
    if (node.type === "heading" && node.depth === 1) {
      const text = toString(node).trim();
      if (text) return text;
    }
  }
  return null;
}

export function parseGenericMarkdownText(input: { sourcePath: string; text: string; sourceFileHash: string }): ParsedMarkdownEntry {
  const { body, metadata } = splitFrontmatter(input.text);
  const title = resolveImportTitle({ sourcePath: input.sourcePath, frontmatterTitle: metadata.title, firstH1: firstH1(body) });
  const content = fingerprintRevisionContent({ title: title.title, markdown: body, metadata });
  return {
    sourcePath: input.sourcePath,
    externalId: null,
    resolvedTitle: content.normalized.title,
    titleSource: title.source,
    markdown: content.normalized.markdown,
    metadata: content.normalized.metadata,
    revisionContentHash: content.contentHash,
    reconciliationFingerprint: fingerprintReconciliationContent({ markdown: content.normalized.markdown, metadata: content.normalized.metadata }),
    sourceFileHash: input.sourceFileHash,
    diagnostics: title.diagnostics,
  };
}

export function sourceFileHash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
```

- [ ] **Step 4: Run parser unit tests, full unit tests, typecheck, and lint**

Run:

```bash
npm run test:unit -- tests/unit/phase2-import-parser.test.ts
npm run test:unit
npm run typecheck
npm run lint
```

Expected: all PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add package.json package-lock.json src/modules/sources/domain src/modules/sources/adapters tests/unit/phase2-import-parser.test.ts
git commit -m "feat: add phase 2 import parser primitives"
```

---

### Task 2: Pure Deterministic Reconciler and Persisted Action-Plan Contract

**Files:**
- Create: `src/modules/sources/domain/import-plan.ts`
- Create: `src/modules/sources/domain/import-reconciler.ts`
- Test: `tests/unit/phase2-reconciler.test.ts`

**Interfaces:**
- Consumes: normalized READY snapshot entries from Task 1.
- Produces:

```ts
export type CanonicalImportState = {
  documents: CanonicalDocumentState[];
  folders: CanonicalFolderState[];
  assets: CanonicalAssetState[];
};

export type ReadyImportContent = {
  documents: ReadyImportDocument[];
  assets: ReadyImportAsset[];
};

export type FolderImportPlan = {
  planVersion: "phase2:v1";
  sourceBinding: { workspaceId: string; sourceId: string | null; basedOnVersion: number | null };
  folders: { create: CreateFolderAction[]; restore: RestoreFolderAction[]; archive: ArchiveFolderAction[] };
  documents: {
    create: CreateDocumentAction[];
    restore: RestoreDocumentAction[];
    move: MoveDocumentAction[];
    revise: ReviseDocumentAction[];
    archive: ArchiveDocumentAction[];
    updateLocator: UpdateLocatorAction[];
  };
  assets: { upsert: UpsertAssetAction[]; remove: RemoveAssetAction[] };
  preview: ImportPreviewChange[];
  summary: ImportDiffSummary;
};

export function reconcileFolderImport(snapshot: ReadyImportContent, current: CanonicalImportState): FolderImportPlan;
```

New entity UUIDs are deliberately absent from `FolderImportPlan`; only stable existing IDs may appear.

- [ ] **Step 1: Write the failing decision-table and determinism tests**

Create `tests/unit/phase2-reconciler.test.ts` using small object builders. Pin same-path update, unique-fingerprint rename/move, ambiguity, archive/restore, folder path-only identity, asset path-only identity, and deterministic output:

```ts
import { describe, expect, it } from "vitest";
import { reconcileFolderImport } from "@/modules/sources/domain/import-reconciler";
import type { CanonicalImportState, ReadyImportContent } from "@/modules/sources/domain/import-plan";

const binding = { workspaceId: "0199f500-0000-7000-8000-000000000001", sourceId: "0199f500-0000-7000-8000-000000000002", basedOnVersion: 7 };

function snapshotDocument(path: string, fingerprint: string, contentHash = fingerprint) {
  return { sourcePath: path, externalId: null, title: path.split("/").at(-1)!.replace(/\.md$/u, ""), markdown: "body", metadata: {}, revisionContentHash: contentHash, reconciliationFingerprint: fingerprint, diagnostics: [] as const };
}

function currentDocument(path: string, fingerprint: string, status: "ACTIVE" | "ARCHIVED" = "ACTIVE") {
  return {
    entryId: `entry-${path}`,
    documentId: `doc-${path}`,
    treeNodeId: `node-${path}`,
    externalId: null,
    sourcePath: path,
    status,
    currentRevision: { id: `rev-${path}`, title: path, markdown: "body", metadata: {}, contentHash: fingerprint },
    reconciliationFingerprint: fingerprint,
  };
}

function reconcile(documents: ReadyImportContent["documents"], currentDocuments: CanonicalImportState["documents"]) {
  return reconcileFolderImport({ sourceBinding: binding, documents, assets: [] }, { documents: currentDocuments, folders: [], assets: [] });
}

describe("Phase 2 reconciler", () => {
  it("matches exact path before fingerprint and emits UPDATE only for changed canonical content", () => {
    const plan = reconcile([snapshotDocument("docs/a.md", "fp-a", "new-hash")], [currentDocument("docs/a.md", "old-fp")]);
    expect(plan.documents.create).toHaveLength(0);
    expect(plan.documents.revise).toHaveLength(1);
  });

  it("preserves identity for one unmatched fingerprint rename", () => {
    const plan = reconcile([snapshotDocument("guide/a.md", "same")], [currentDocument("docs/a.md", "same")]);
    expect(plan.documents.create).toHaveLength(0);
    expect(plan.documents.move).toEqual([expect.objectContaining({ fromPath: "docs/a.md", toPath: "guide/a.md" })]);
  });

  it("does not guess when two unmatched candidates share the fingerprint", () => {
    const plan = reconcile([snapshotDocument("guide/c.md", "same")], [currentDocument("a.md", "same"), currentDocument("b.md", "same")]);
    expect(plan.documents.create).toHaveLength(1);
    expect(plan.documents.archive).toHaveLength(2);
    expect(plan.preview.flatMap((item) => item.diagnostics).map((item) => item.code)).toContain("AMBIGUOUS_IDENTITY");
  });

  it("restores the same IDs when an archived exact-path document reappears", () => {
    const plan = reconcile([snapshotDocument("docs/a.md", "same")], [currentDocument("docs/a.md", "same", "ARCHIVED")]);
    expect(plan.documents.restore).toEqual([expect.objectContaining({ documentId: "doc-docs/a.md", entryId: "entry-docs/a.md" })]);
  });

  it("is deterministic", () => {
    const input = [snapshotDocument("z.md", "z"), snapshotDocument("a.md", "a")];
    const state = [currentDocument("z.md", "z"), currentDocument("old.md", "old")];
    expect(reconcile(input, state)).toEqual(reconcile(input, state));
  });
});
```

- [ ] **Step 2: Run the reconciler tests and verify failure**

Run:

```bash
npm run test:unit -- tests/unit/phase2-reconciler.test.ts
```

Expected: FAIL because plan/reconciler modules are missing.

- [ ] **Step 3: Define the action-plan types and implement four-pass matching with O(n) lookup maps**

Create `src/modules/sources/domain/import-plan.ts`. Use serializable data only; use `parentPath` and `desiredPosition` so the executor can resolve newly created folders without preallocating IDs:

```ts
import type { KnowledgeMetadata } from "@/modules/knowledge/domain/content";
import type { ImportDiagnostic } from "./import-diagnostic";

export type RevisionPayload = { title: string; markdown: string; metadata: KnowledgeMetadata; contentHash: string };

export type ReadyImportDocument = {
  sourcePath: string;
  externalId: string | null;
  title: string;
  markdown: string;
  metadata: KnowledgeMetadata;
  revisionContentHash: string;
  reconciliationFingerprint: string;
  diagnostics: ImportDiagnostic[];
};

export type ReadyImportAsset = {
  sourcePath: string;
  sourcePathHash: string;
  contentHash: string | null;
  mimeType: string | null;
  metadata: Record<string, unknown>;
  diagnostics: ImportDiagnostic[];
};

export type ReadyImportContent = {
  sourceBinding: { workspaceId: string; sourceId: string | null; basedOnVersion: number | null };
  documents: ReadyImportDocument[];
  assets: ReadyImportAsset[];
};

export type CanonicalDocumentState = {
  entryId: string;
  documentId: string;
  treeNodeId: string;
  externalId: string | null;
  sourcePath: string;
  status: "ACTIVE" | "ARCHIVED";
  currentRevision: { id: string; title: string; markdown: string; metadata: KnowledgeMetadata; contentHash: string };
  reconciliationFingerprint: string;
};

export type CanonicalFolderState = { entryId: string; treeNodeId: string; sourcePath: string; status: "ACTIVE" | "ARCHIVED" };
export type CanonicalAssetState = { id: string; sourcePath: string; sourcePathHash: string; contentHash: string | null; mimeType: string | null; metadata: Record<string, unknown> };
export type CanonicalImportState = { documents: CanonicalDocumentState[]; folders: CanonicalFolderState[]; assets: CanonicalAssetState[] };

export type ImportPreviewChange = {
  kind: "DOCUMENT" | "FOLDER" | "ASSET";
  sourcePath: string;
  previousPath: string | null;
  labels: ("ADDED" | "UPDATED" | "MOVED" | "RENAMED" | "ARCHIVED" | "RESTORED" | "UNCHANGED")[];
  diagnostics: ImportDiagnostic[];
};

export type ImportDiffSummary = {
  documents: Record<"added" | "updated" | "moved" | "renamed" | "archived" | "restored" | "unchanged", number>;
  folders: Record<"added" | "archived" | "restored", number>;
  assets: Record<"added" | "updated" | "removed" | "unchanged", number>;
  warnings: number;
  blockers: number;
  affectedDocuments: number;
  changed: boolean;
};

export type FolderImportPlan = {
  planVersion: "phase2:v1";
  sourceBinding: ReadyImportContent["sourceBinding"];
  folders: {
    create: { sourcePath: string; parentPath: string | null; name: string; desiredPosition: number }[];
    restore: { entryId: string; treeNodeId: string; sourcePath: string }[];
    archive: { entryId: string; treeNodeId: string; sourcePath: string }[];
  };
  documents: {
    create: { sourcePath: string; parentPath: string | null; desiredPosition: number; externalId: string | null; content: RevisionPayload }[];
    restore: { entryId: string; documentId: string; treeNodeId: string }[];
    move: { entryId: string; treeNodeId: string; fromPath: string; toPath: string; parentPath: string | null; desiredPosition: number }[];
    revise: { entryId: string; documentId: string; expectedCurrentRevisionId: string; content: RevisionPayload }[];
    archive: { entryId: string; documentId: string; treeNodeId: string; sourcePath: string }[];
    updateLocator: { entryId: string; sourcePath: string; contentHash: string }[];
  };
  assets: {
    upsert: { sourcePath: string; sourcePathHash: string; mimeType: string | null; contentHash: string | null; metadata: Record<string, unknown> }[];
    remove: { assetId: string; sourcePath: string }[];
  };
  preview: ImportPreviewChange[];
  summary: ImportDiffSummary;
};
```

Create `src/modules/sources/domain/import-reconciler.ts` with these algorithmic rules:

```ts
import { isSameRevisionContent } from "@/modules/knowledge/domain/content";
import type { CanonicalDocumentState, CanonicalImportState, FolderImportPlan, ReadyImportContent, ReadyImportDocument } from "./import-plan";

function parentPath(path: string): string | null {
  const at = path.lastIndexOf("/");
  return at < 0 ? null : path.slice(0, at);
}

function basename(path: string): string {
  return path.split("/").at(-1)!;
}

function deriveFolders(snapshot: ReadyImportContent): string[] {
  const folders = new Set<string>();
  for (const entry of [...snapshot.documents, ...snapshot.assets]) {
    const parts = entry.sourcePath.split("/");
    parts.pop();
    let cursor = "";
    for (const part of parts) {
      cursor = cursor ? `${cursor}/${part}` : part;
      folders.add(cursor);
    }
  }
  return [...folders].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "variant" }));
}

function sameRevision(current: CanonicalDocumentState, incoming: ReadyImportDocument): boolean {
  return isSameRevisionContent(current.currentRevision, { title: incoming.title, markdown: incoming.markdown, metadata: incoming.metadata });
}

export function reconcileFolderImport(snapshot: ReadyImportContent, current: CanonicalImportState): FolderImportPlan {
  const byExternalId = new Map(current.documents.filter((item) => item.externalId !== null).map((item) => [item.externalId!, item]));
  const byPath = new Map(current.documents.map((item) => [item.sourcePath, item]));
  const byFingerprint = new Map<string, CanonicalDocumentState[]>();
  for (const item of current.documents) {
    const candidates = byFingerprint.get(item.reconciliationFingerprint) ?? [];
    candidates.push(item);
    byFingerprint.set(item.reconciliationFingerprint, candidates);
  }
  const matched = new Set<string>();
  const ambiguous = new Map<string, string[]>();
  const match = (incoming: ReadyImportDocument): CanonicalDocumentState | null => {
    if (incoming.externalId !== null) {
      const external = byExternalId.get(incoming.externalId);
      const path = byPath.get(incoming.sourcePath);
      if (external && path && external.entryId !== path.entryId) throw new Error("IDENTITY_CONFLICT");
      if (external && !matched.has(external.entryId)) return external;
    }
    const exact = byPath.get(incoming.sourcePath);
    if (exact && !matched.has(exact.entryId)) return exact;
    const candidates = (byFingerprint.get(incoming.reconciliationFingerprint) ?? []).filter((item) => !matched.has(item.entryId));
    if (candidates.length === 1) return candidates[0];
    if (candidates.length > 1) ambiguous.set(incoming.sourcePath, candidates.map((item) => item.sourcePath).sort());
    return null;
  };

  const plan = emptyPlan(snapshot.sourceBinding);
  const desiredFolders = deriveFolders(snapshot);
  reconcileFolders(plan, desiredFolders, current.folders);
  for (const incoming of [...snapshot.documents].sort((a, b) => a.sourcePath.localeCompare(b.sourcePath))) {
    const existing = match(incoming);
    reconcileDocument(plan, incoming, existing, matched, ambiguous.get(incoming.sourcePath) ?? [], sameRevision);
  }
  archiveUnmatchedDocuments(plan, current.documents, matched);
  reconcileAssets(plan, snapshot.assets, current.assets);
  finalizePreviewSummary(plan);
  return plan;
}
```

Implement `emptyPlan`, `reconcileFolders`, `reconcileDocument`, `archiveUnmatchedDocuments`, `reconcileAssets`, and `finalizePreviewSummary` in the same file with no time/random/DB access. `reconcileDocument` must mark an existing `entryId` immediately when matched, emit restore before revise for archived entries, and derive MOVED vs RENAMED from parent/basename changes. `reconcileFolders` must only match exact path and archive obsolete folders deepest-first. `reconcileAssets` must match path only.

- [ ] **Step 4: Run reconciler tests plus all unit tests**

Run:

```bash
npm run test:unit -- tests/unit/phase2-reconciler.test.ts
npm run test:unit
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/modules/sources/domain/import-plan.ts src/modules/sources/domain/import-reconciler.ts tests/unit/phase2-reconciler.test.ts
git commit -m "feat: add deterministic folder import reconciler"
```

---

### Task 3: MariaDB Staging Schema, Asset Projection Schema, and Repository Ports

**Files:**
- Create: `src/infrastructure/database/mariadb/migrations/006-phase-2-import-staging.ts`
- Create: `src/infrastructure/database/mariadb/migrations/007-phase-2-asset-projection.ts`
- Create: `src/infrastructure/database/mariadb/asset-projection-validation.ts`
- Modify: `src/infrastructure/database/mariadb/migrations/index.ts`
- Create: `src/modules/sources/ports/import-snapshot-repository.ts`
- Create: `src/modules/sources/ports/import-snapshot-entry-repository.ts`
- Create: `src/modules/sources/ports/import-canonical-state-repository.ts`
- Modify: `src/modules/sources/ports/asset-repository.ts`
- Modify: `src/modules/sources/ports/unit-of-work.ts`
- Modify: `src/modules/sources/domain/asset.ts`
- Create: `src/infrastructure/database/mariadb/repositories/import-snapshots.ts`
- Create: `src/infrastructure/database/mariadb/repositories/import-snapshot-entries.ts`
- Create: `src/infrastructure/database/mariadb/repositories/import-canonical-state.ts`
- Modify: `src/infrastructure/database/mariadb/repositories/assets.ts`
- Modify: `src/infrastructure/database/mariadb/repositories/index.ts`
- Test: `tests/integration/phase2-import-schema.test.ts`

**Interfaces:**
- Consumes: Task 2 `CanonicalImportState` and `FolderImportPlan`.
- Produces repository contracts used by all later application services:

```ts
export interface ImportSnapshotRepository {
  insert(snapshot: ImportSnapshot): Promise<void>;
  findById(snapshotId: string): Promise<ImportSnapshot | null>;
  lockById(snapshotId: string): Promise<ImportSnapshot | null>;
  countByCreatorAndState(creatorId: string, state: "BUILDING" | "READY"): Promise<number>;
  markReady(input: MarkImportSnapshotReadyInput): Promise<void>;
  markApplied(input: { snapshotId: string; sourceId: string; resultVersion: number; appliedAt: Date }): Promise<void>;
  markStale(input: { snapshotId: string; staleAt: Date }): Promise<void>;
  listCleanupCandidates(now: Date, limit: number): Promise<string[]>;
  deleteById(snapshotId: string): Promise<void>;
}

export interface ImportSnapshotEntryRepository {
  insertMany(entries: ImportSnapshotEntry[]): Promise<void>;
  listBySnapshotId(snapshotId: string): Promise<ImportSnapshotEntry[]>;
  findByUploadKey(snapshotId: string, uploadKey: string): Promise<ImportSnapshotEntry | null>;
  markMarkdownReceived(input: { entryId: string; rawMarkdown: string | null; sourceFileHash: string; diagnostics: ImportDiagnostic[] }): Promise<void>;
  replaceFinalizedEntries(snapshotId: string, entries: FinalizedImportSnapshotEntry[]): Promise<void>;
}

export interface ImportCanonicalStateRepository {
  load(sourceId: string): Promise<CanonicalImportState>;
}
```

- [ ] **Step 1: Write failing migration/repository integration tests**

Create `tests/integration/phase2-import-schema.test.ts`. Provision an isolated DB exactly like existing Phase 1 integration tests, run migrations, and assert the staging tables/checks/indexes plus asset upsert semantics:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { runMigrations } from "../../scripts/db/migrate";
import { disposeIsolatedDatabase, provisionIsolatedDatabase } from "../../scripts/db/test-database";

let pool: Pool;
let handle: Awaited<ReturnType<typeof provisionIsolatedDatabase>>;

beforeAll(async () => {
  handle = await provisionIsolatedDatabase("test");
  process.env.KM_TEST_DB_NAME = handle.databaseName;
  pool = createDatabasePool(databaseConfig("test"));
  await runMigrations(pool);
});

afterAll(async () => {
  await pool.end();
  await disposeIsolatedDatabase(handle);
});

describe("Phase 2 schema", () => {
  it("applies migrations 006 and 007", async () => {
    const rows = await pool.query<{ version: number; state: string }[]>("SELECT version, state FROM schema_migrations WHERE version IN (6,7) ORDER BY version");
    expect(rows.map((row) => [Number(row.version), row.state])).toEqual([[6, "APPLIED"], [7, "APPLIED"]]);
  });

  it("enforces snapshot binding and one normalized path per snapshot", async () => {
    const columns = await pool.query<{ COLUMN_NAME: string }[]>("SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'source_import_snapshots'");
    expect(columns.map((row) => row.COLUMN_NAME)).toContain("plan_hash");
    const indexes = await pool.query<{ INDEX_NAME: string }[]>("SHOW INDEX FROM source_import_snapshot_entries");
    expect(indexes.map((row) => row.INDEX_NAME)).toContain("uq_import_entries_snapshot_path_hash");
  });

  it("supports source-scoped asset projection upsert and removal", async () => {
    const unitOfWork = new MariaDbUnitOfWork(pool);
    expect(typeof unitOfWork.run).toBe("function");
  });
});
```

Add a second test that creates a user/workspace/source, inserts a `knowledge_assets` row through the upgraded `AssetRepository`, calls `upsertByPath`, verifies the same ID remains while hash/metadata update, then calls `deleteById`.

- [ ] **Step 2: Run the schema test and verify migrations/repositories are missing**

Run:

```bash
npx vitest run --config vitest.integration.config.ts tests/integration/phase2-import-schema.test.ts
```

Expected: FAIL before migration 006 and repository methods exist.

- [ ] **Step 3: Add migration 006 and the staging domain/repository contracts**

Define the staging domain models in `src/modules/sources/domain/import-snapshot.ts` by extending the Task 1 file:

```ts
import type { FolderImportPlan, ImportDiffSummary } from "./import-plan";

export type ImportSnapshot = {
  id: string;
  workspaceId: string;
  sourceId: string | null;
  basedOnVersion: number | null;
  createdBy: string;
  rootName: string;
  proposedSourceName: string | null;
  adapterType: "GENERIC_MARKDOWN_FOLDER";
  adapterVersion: "phase2:v1";
  planVersion: "phase2:v1";
  state: ImportSnapshotState;
  manifestHash: string;
  snapshotHash: string | null;
  planHash: string | null;
  hasBlockers: boolean;
  summary: ImportDiffSummary | null;
  plan: FolderImportPlan | null;
  createdAt: Date;
  finalizedAt: Date | null;
  expiresAt: Date;
  appliedAt: Date | null;
  staleAt: Date | null;
  resultSourceId: string | null;
  resultVersion: number | null;
};

export type ImportSnapshotEntry = {
  id: string;
  snapshotId: string;
  uploadKey: string;
  clientRelativePath: string;
  sourcePath: string | null;
  sourcePathHash: string | null;
  entryType: ImportEntryType;
  uploadStatus: ImportUploadStatus;
  declaredSize: number;
  sourceFileHash: string | null;
  rawMarkdown: string | null;
  resolvedTitle: string | null;
  titleSource: ImportTitleSource | null;
  markdown: string | null;
  metadata: KnowledgeMetadata | null;
  revisionContentHash: string | null;
  reconciliationFingerprint: string | null;
  mimeType: string | null;
  assetContentHash: string | null;
  assetSize: number | null;
  assetLastModified: Date | null;
  diagnostics: ImportDiagnostic[];
  previewChange: Record<string, unknown> | null;
};

export type FinalizedImportSnapshotEntry = ImportSnapshotEntry & { uploadStatus: "RECEIVED"; rawMarkdown: null };
export type MarkImportSnapshotReadyInput = {
  snapshotId: string;
  snapshotHash: string;
  planHash: string;
  summary: ImportDiffSummary;
  plan: FolderImportPlan;
  hasBlockers: boolean;
  finalizedAt: Date;
  expiresAt: Date;
};
```

Create migration `006-phase-2-import-staging.ts` with two InnoDB tables. Use native `UUID`, binary collation for paths/hashes, JSON validity checks, and the approved binding/state checks. The migration must include these named constraints/indexes so tests can assert them:

```ts
import type { Migration } from "./types";

export const phase2ImportStagingMigration: Migration = {
  version: 6,
  name: "phase-2-import-staging",
  statements: [
    `CREATE TABLE source_import_snapshots (
      id UUID NOT NULL,
      workspace_id UUID NOT NULL,
      source_id UUID NULL,
      based_on_version INT UNSIGNED NULL,
      created_by UUID NOT NULL,
      root_name VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
      proposed_source_name VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
      adapter_type VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      adapter_version VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      plan_version VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      state VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      manifest_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      snapshot_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
      plan_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
      has_blockers BOOLEAN NOT NULL DEFAULT FALSE,
      summary JSON NULL,
      plan JSON NULL,
      created_at DATETIME(6) NOT NULL,
      finalized_at DATETIME(6) NULL,
      expires_at DATETIME(6) NOT NULL,
      applied_at DATETIME(6) NULL,
      stale_at DATETIME(6) NULL,
      result_source_id UUID NULL,
      result_version INT UNSIGNED NULL,
      PRIMARY KEY (id),
      CONSTRAINT fk_import_snapshot_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT fk_import_snapshot_source FOREIGN KEY (source_id) REFERENCES knowledge_sources(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT fk_import_snapshot_creator FOREIGN KEY (created_by) REFERENCES users(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT fk_import_snapshot_result_source FOREIGN KEY (result_source_id) REFERENCES knowledge_sources(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ck_import_snapshot_state CHECK (state IN ('BUILDING','READY','APPLIED','STALE')),
      CONSTRAINT ck_import_snapshot_binding CHECK ((source_id IS NULL AND based_on_version IS NULL AND proposed_source_name IS NOT NULL) OR (source_id IS NOT NULL AND based_on_version IS NOT NULL AND proposed_source_name IS NULL)),
      CONSTRAINT ck_import_snapshot_json CHECK ((summary IS NULL OR JSON_VALID(summary)) AND (plan IS NULL OR JSON_VALID(plan))),
      KEY idx_import_snapshots_creator_state (created_by, state),
      KEY idx_import_snapshots_source_created (source_id, created_at),
      KEY idx_import_snapshots_workspace_created (workspace_id, created_at),
      KEY idx_import_snapshots_state_expires (state, expires_at)
    ) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE source_import_snapshot_entries (
      id UUID NOT NULL,
      snapshot_id UUID NOT NULL,
      upload_key VARCHAR(256) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
      client_relative_path TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
      source_path TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
      source_path_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
      entry_type VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      upload_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      declared_size BIGINT UNSIGNED NOT NULL,
      source_file_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
      raw_markdown LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
      resolved_title VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
      title_source VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
      markdown LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
      metadata JSON NULL,
      revision_content_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
      reconciliation_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
      mime_type VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
      asset_content_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
      asset_size BIGINT UNSIGNED NULL,
      asset_last_modified DATETIME(6) NULL,
      diagnostics JSON NOT NULL,
      preview_change JSON NULL,
      PRIMARY KEY (id),
      CONSTRAINT fk_import_entry_snapshot FOREIGN KEY (snapshot_id) REFERENCES source_import_snapshots(id) ON UPDATE RESTRICT ON DELETE CASCADE,
      CONSTRAINT ck_import_entry_type CHECK (entry_type IN ('DOCUMENT','ASSET')),
      CONSTRAINT ck_import_entry_upload_status CHECK (upload_status IN ('PENDING','RECEIVED')),
      CONSTRAINT ck_import_entry_json CHECK (JSON_VALID(diagnostics) AND (metadata IS NULL OR JSON_VALID(metadata)) AND (preview_change IS NULL OR JSON_VALID(preview_change))),
      CONSTRAINT uq_import_entries_snapshot_upload UNIQUE (snapshot_id, upload_key),
      CONSTRAINT uq_import_entries_snapshot_path_hash UNIQUE (snapshot_id, source_path_hash),
      KEY idx_import_entries_snapshot_upload (snapshot_id, upload_status)
    ) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ],
};
```

Create the three repository interfaces with the signatures in this task header, add them to `SourceRepositories`, implement MariaDB mappers using `asDate`, `asNumber`, and `asJsonObject`, and register them in `createRepositories()`.

`MariaDbImportCanonicalStateRepository.load(sourceId)` must use bounded queries, not per-document N+1 calls: one SourceEntry/Document/Revision/Tree join for document+folder mappings and one asset query, then compute each current document reconciliation fingerprint in memory using Task 1.

- [ ] **Step 4: Add migration 007 and upgrade AssetRepository to current-projection operations**

Add fields to `KnowledgeAsset`:

```ts
export type KnowledgeAsset = {
  id: string;
  sourceId: string;
  sourcePath: string;
  sourcePathHash: string;
  mimeType: string | null;
  contentHash: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};
```

Change the port to:

```ts
export interface AssetRepository {
  insert(asset: KnowledgeAsset): Promise<void>;
  findById(assetId: string): Promise<KnowledgeAsset | null>;
  listBySourceId(sourceId: string): Promise<KnowledgeAsset[]>;
  upsertByPath(asset: KnowledgeAsset): Promise<void>;
  deleteById(assetId: string): Promise<void>;
}
```

Create `asset-projection-validation.ts` so migration 007 refuses populated upgrades containing a non-canonical or duplicate normalized asset path:

```ts
import type { MigrationReadConnection } from "./migrations/types";
import { normalizeImportPath } from "@/modules/sources/domain/import-path";

export async function checkAssetProjectionReadiness(connection: MigrationReadConnection): Promise<void> {
  const rows = await connection.query<{ id: string; source_id: string; source_path: string }[]>("SELECT id, source_id, source_path FROM knowledge_assets ORDER BY source_id, id");
  const seen = new Set<string>();
  for (const row of rows) {
    const normalized = normalizeImportPath(row.source_path).sourcePath;
    if (normalized !== row.source_path) throw new Error(`Asset ${row.id} has a non-canonical source_path; repair it before migration 007.`);
    const key = `${row.source_id}\0${normalized}`;
    if (seen.has(key)) throw new Error(`Duplicate asset source_path in source ${row.source_id}; repair it before migration 007.`);
    seen.add(key);
  }
}
```

Migration 007 then performs a fixed backfill and uniqueness constraint:

```ts
import type { Migration } from "./types";
import { checkAssetProjectionReadiness } from "../asset-projection-validation";

export const phase2AssetProjectionMigration: Migration = {
  version: 7,
  name: "phase-2-asset-projection",
  statements: [
    "ALTER TABLE knowledge_assets ADD COLUMN source_path_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL",
    "ALTER TABLE knowledge_assets ADD COLUMN updated_at DATETIME(6) NULL",
    "UPDATE knowledge_assets SET source_path_hash = LOWER(SHA2(source_path, 256)), updated_at = created_at WHERE source_path_hash IS NULL OR updated_at IS NULL",
    "ALTER TABLE knowledge_assets MODIFY source_path_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL",
    "ALTER TABLE knowledge_assets MODIFY updated_at DATETIME(6) NOT NULL",
    "ALTER TABLE knowledge_assets ADD CONSTRAINT uq_assets_source_path_hash UNIQUE (source_id, source_path_hash)",
  ],
  beforeApply: checkAssetProjectionReadiness,
};
```

Append migrations 6 and 7 to `migrations/index.ts` in version order. Implement `upsertByPath` using `INSERT ... ON DUPLICATE KEY UPDATE` while preserving the existing row ID with `id = id` and updating path/hash/mime/content/metadata/updated_at.

- [ ] **Step 5: Run schema integration test, all integration tests, and commit**

Run:

```bash
npx vitest run --config vitest.integration.config.ts tests/integration/phase2-import-schema.test.ts
npm run test:integration
npm run typecheck
npm run lint
```

Expected: PASS.

Commit:

```bash
git add src/infrastructure/database/mariadb src/modules/sources/domain/asset.ts src/modules/sources/domain/import-snapshot.ts src/modules/sources/ports tests/integration/phase2-import-schema.test.ts
git commit -m "feat: add phase 2 import staging persistence"
```

---

### Task 4: BUILDING Import Sessions, Manifest Validation, Limits, and Raw-Byte Upload

**Files:**
- Create: `src/server/import-config.ts`
- Modify: `.env.example`
- Create: `src/modules/sources/application/create-folder-import.ts`
- Create: `src/modules/sources/application/upload-folder-import-entries.ts`
- Test: `tests/integration/phase2-import-session.test.ts`

**Interfaces:**
- Consumes: Task 3 staging repositories and Task 1 byte decoder/path/limit types.
- Produces:

```ts
export type ImportManifestEntry =
  | { uploadKey: string; relativePath: string; kind: "MARKDOWN"; size: number }
  | { uploadKey: string; relativePath: string; kind: "ASSET"; size: number; contentHash: string | null; mimeType: string | null; lastModified: Date | null };

export class CreateFolderImportService {
  createInitial(caller: CallerContext, input: { workspaceId: string; sourceName: string; rootName: string; manifest: ImportManifestEntry[] }): Promise<{ snapshotId: string; state: "BUILDING"; expiresAt: Date }>;
  createResync(caller: CallerContext, input: { sourceId: string; rootName: string; manifest: ImportManifestEntry[] }): Promise<{ snapshotId: string; state: "BUILDING"; expiresAt: Date }>;
}

export class UploadFolderImportEntriesService {
  upload(caller: CallerContext, input: { snapshotId: string; entries: { uploadKey: string; bytes: Uint8Array }[] }): Promise<{ accepted: number; idempotent: number; diagnostics: ImportDiagnostic[] }>;
}
```

- [ ] **Step 1: Write failing integration tests for authorization, session limits, manifest shape, and upload idempotency**

Create `tests/integration/phase2-import-session.test.ts` using the existing isolated MariaDB style. Cover these exact cases:

```ts
it("creates an initial BUILDING snapshot bound to a workspace without creating a Source", async () => {
  const result = await service.createInitial(caller, {
    workspaceId,
    sourceName: "Team Wiki",
    rootName: "team-wiki",
    manifest: [{ uploadKey: "f1", relativePath: "README.md", kind: "MARKDOWN", size: 4 }],
  });
  expect(result.state).toBe("BUILDING");
  expect(await countSources(pool, workspaceId)).toBe(0);
});

it("creates resync snapshot from server-derived workspace/version and rejects HUB_MANAGED source", async () => {
  const result = await service.createResync(caller, { sourceId: managedSourceId, rootName: "wiki", manifest: [] });
  const snapshot = await readSnapshot(pool, result.snapshotId);
  expect(snapshot.workspace_id).toBe(workspaceId);
  expect(Number(snapshot.based_on_version)).toBe(7);
  await expect(service.createResync(caller, { sourceId: hubSourceId, rootName: "wiki", manifest: [] })).rejects.toMatchObject({ code: "SOURCE_NOT_SOURCE_MANAGED" });
});

it("retries identical Markdown bytes idempotently and rejects different bytes for the same uploadKey", async () => {
  const bytes = new TextEncoder().encode("# A\n");
  expect((await uploader.upload(caller, { snapshotId, entries: [{ uploadKey: "f1", bytes }] })).accepted).toBe(1);
  expect((await uploader.upload(caller, { snapshotId, entries: [{ uploadKey: "f1", bytes }] })).idempotent).toBe(1);
  await expect(uploader.upload(caller, { snapshotId, entries: [{ uploadKey: "f1", bytes: new TextEncoder().encode("# B\n") }] })).rejects.toMatchObject({ code: "UPLOAD_ENTRY_CONFLICT" });
});

it("records invalid UTF-8 as a blocking diagnostic without persisting invalid text", async () => {
  const result = await uploader.upload(caller, { snapshotId, entries: [{ uploadKey: "f1", bytes: new Uint8Array([0xc3, 0x28]) }] });
  expect(result.diagnostics).toEqual([expect.objectContaining({ code: "INVALID_MARKDOWN_ENCODING", severity: "BLOCKING" })]);
});
```

Also test: non-member cannot create/read/upload; other user cannot upload to creator snapshot; >3 BUILDING sessions rejects with `IMPORT_SESSION_LIMIT`; manifest >20,000 entries rejects; file/total/request size limits reject before storing bytes.

- [ ] **Step 2: Run the session test and verify failure**

Run:

```bash
npx vitest run --config vitest.integration.config.ts tests/integration/phase2-import-session.test.ts
```

Expected: FAIL because application services/config are missing.

- [ ] **Step 3: Implement import config, deterministic manifest hashing, session creation, and upload**

Create `src/server/import-config.ts` with exact defaults and optional integer overrides:

```ts
import { DEFAULT_IMPORT_LIMITS, type ImportLimits } from "@/modules/sources/domain/import-limits";

function positiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer.`);
  return value;
}

export function importLimits(): ImportLimits {
  return {
    maxManifestEntries: positiveInt("KM_IMPORT_MAX_MANIFEST_ENTRIES", DEFAULT_IMPORT_LIMITS.maxManifestEntries),
    maxPathBytes: positiveInt("KM_IMPORT_MAX_PATH_BYTES", DEFAULT_IMPORT_LIMITS.maxPathBytes),
    maxMarkdownFileBytes: positiveInt("KM_IMPORT_MAX_MARKDOWN_FILE_BYTES", DEFAULT_IMPORT_LIMITS.maxMarkdownFileBytes),
    maxMarkdownTotalBytes: positiveInt("KM_IMPORT_MAX_MARKDOWN_TOTAL_BYTES", DEFAULT_IMPORT_LIMITS.maxMarkdownTotalBytes),
    maxMetadataBytes: positiveInt("KM_IMPORT_MAX_METADATA_BYTES", DEFAULT_IMPORT_LIMITS.maxMetadataBytes),
    maxUploadBatchFiles: positiveInt("KM_IMPORT_MAX_UPLOAD_BATCH_FILES", DEFAULT_IMPORT_LIMITS.maxUploadBatchFiles),
    maxUploadBatchBytes: positiveInt("KM_IMPORT_MAX_UPLOAD_BATCH_BYTES", DEFAULT_IMPORT_LIMITS.maxUploadBatchBytes),
    maxBuildingSnapshotsPerUser: positiveInt("KM_IMPORT_MAX_BUILDING_PER_USER", DEFAULT_IMPORT_LIMITS.maxBuildingSnapshotsPerUser),
    maxReadySnapshotsPerUser: positiveInt("KM_IMPORT_MAX_READY_PER_USER", DEFAULT_IMPORT_LIMITS.maxReadySnapshotsPerUser),
  };
}
```

Document the nine variables in `.env.example` using the exact numeric defaults.

Create `CreateFolderImportService`. Both methods must:

```ts
const now = new Date();
const expiresAt = new Date(now.getTime() + 2 * 60 * 60 * 1000);
```

Then upsert caller identity, check current Workspace membership, enforce creator BUILDING/READY quotas, validate manifest entry uniqueness/limits, sort manifest by `relativePath` then `uploadKey`, hash the canonical JSON, insert one BUILDING snapshot, and insert manifest entries. Asset rows start as `RECEIVED`; Markdown rows start as `PENDING`. `createResync` must load Source server-side and reject non-ACTIVE/non-`SOURCE_MANAGED`/non-`FOLDER_SYNC` without accepting a workspace/version parameter.

Create `UploadFolderImportEntriesService`. Before reading/storing entries, load snapshot, require creator equality, current Workspace membership, `BUILDING`, non-expired state, and batch file/byte limits. For each upload key:

```ts
const hash = sourceFileHash(input.bytes);
if (existing.uploadStatus === "RECEIVED") {
  if (existing.sourceFileHash === hash) return "IDEMPOTENT";
  throw importError("UPLOAD_ENTRY_CONFLICT", "The same uploadKey was retried with different bytes.");
}
try {
  const rawMarkdown = decodeUtf8Markdown(input.bytes);
  await repositories.importSnapshotEntries.markMarkdownReceived({ entryId: existing.id, rawMarkdown, sourceFileHash: hash, diagnostics: [] });
} catch (error) {
  if (error instanceof SourceImportError && error.code === "INVALID_MARKDOWN_ENCODING") {
    const diagnostic = { code: error.code, severity: "BLOCKING" as const, sourcePath: existing.clientRelativePath, message: error.message };
    await repositories.importSnapshotEntries.markMarkdownReceived({ entryId: existing.id, rawMarkdown: null, sourceFileHash: hash, diagnostics: [diagnostic] });
    return "ACCEPTED_WITH_BLOCKER";
  }
  throw error;
}
```

- [ ] **Step 4: Run focused/full integration tests and static checks**

Run:

```bash
npx vitest run --config vitest.integration.config.ts tests/integration/phase2-import-session.test.ts
npm run test:integration
npm run typecheck
npm run lint
```

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

```bash
git add .env.example src/server/import-config.ts src/modules/sources/application/create-folder-import.ts src/modules/sources/application/upload-folder-import-entries.ts tests/integration/phase2-import-session.test.ts
git commit -m "feat: add staged folder import sessions"
```

---

### Task 5: Finalize BUILDING Snapshot into Immutable READY Preview

**Files:**
- Create: `src/modules/sources/application/reconcile-import-snapshot.ts`
- Create: `src/modules/sources/application/finalize-folder-import.ts`
- Test: `tests/integration/phase2-import-finalize.test.ts`

**Interfaces:**
- Consumes: Task 4 BUILDING snapshot rows; Task 1 parser; Task 2 reconciler; Task 3 canonical-state repository.
- Produces:

```ts
export type ImportPreview = {
  snapshotId: string;
  state: "READY" | "APPLIED" | "STALE";
  workspaceId: string;
  sourceId: string | null;
  proposedSourceName: string | null;
  basedOnVersion: number | null;
  expiresAt: Date;
  hasBlockers: boolean;
  summary: ImportDiffSummary;
  changes: ImportPreviewChange[];
};

export class FinalizeFolderImportService {
  finalize(caller: CallerContext, snapshotId: string): Promise<ImportPreview>;
}
```

- [ ] **Step 1: Write failing finalize integration tests**

Create `tests/integration/phase2-import-finalize.test.ts`. Cover:

```ts
it("finalizes a complete upload into READY with persisted plan/hash and clears raw Markdown", async () => {
  const preview = await finalizer.finalize(caller, snapshotId);
  expect(preview.state).toBe("READY");
  expect(preview.hasBlockers).toBe(false);
  const persisted = await readSnapshot(pool, snapshotId);
  expect(persisted.snapshot_hash).toMatch(/^[0-9a-f]{64}$/u);
  expect(persisted.plan_hash).toMatch(/^[0-9a-f]{64}$/u);
  expect(persisted.plan).not.toBeNull();
  expect((await readEntries(pool, snapshotId)).every((entry) => entry.raw_markdown === null)).toBe(true);
});

it("keeps malformed frontmatter as READY with blocker and disables future Apply", async () => {
  const preview = await finalizer.finalize(caller, malformedSnapshotId);
  expect(preview.state).toBe("READY");
  expect(preview.hasBlockers).toBe(true);
  expect(preview.changes.flatMap((item) => item.diagnostics).map((item) => item.code)).toContain("INVALID_FRONTMATTER");
});

it("blocks normalized path collision", async () => {
  const preview = await finalizer.finalize(caller, collisionSnapshotId);
  expect(preview.hasBlockers).toBe(true);
  expect(preview.changes.flatMap((item) => item.diagnostics).map((item) => item.code)).toContain("PATH_COLLISION");
});
```

Also cover incomplete upload = `UPLOAD_INCOMPLETE` while remaining BUILDING; title conflict = warning only; ignored paths excluded; no empty folder nodes in plan; existing source Preview correctly emits move/archive/restore; finalizing READY again returns the persisted Preview without mutating it.

- [ ] **Step 2: Run finalize tests and verify failure**

Run:

```bash
npx vitest run --config vitest.integration.config.ts tests/integration/phase2-import-finalize.test.ts
```

Expected: FAIL because finalization services are missing.

- [ ] **Step 3: Implement canonical finalization, diagnostics, snapshot hash, plan hash, and READY transition**

Create `reconcile-import-snapshot.ts` as the only application helper allowed to load canonical reconciliation state:

```ts
import type { SourceRepositories } from "../ports/unit-of-work";
import type { ReadyImportContent } from "../domain/import-plan";
import { reconcileFolderImport } from "../domain/import-reconciler";

export async function reconcileImportSnapshot(repositories: SourceRepositories, content: ReadyImportContent) {
  const current = content.sourceBinding.sourceId === null
    ? { documents: [], folders: [], assets: [] }
    : await repositories.importCanonicalState.load(content.sourceBinding.sourceId);
  return reconcileFolderImport(content, current);
}
```

Create `FinalizeFolderImportService.finalize()`. Inside one short staging UoW:

1. lock snapshot and verify creator, membership, BUILDING, unexpired;
2. load all manifest entries;
3. require all Markdown rows `RECEIVED` (invalid UTF-8 rows count as RECEIVED with blocker diagnostic);
4. normalize all nonignored paths and reject duplicate normalized hashes as `PATH_COLLISION` diagnostics;
5. parse valid Markdown rows with `parseGenericMarkdownText`; catch parser/title errors and convert them to BLOCKING diagnostics instead of failing the whole Preview;
6. validate `JSON.stringify(metadata)` byte length against 256 KiB;
7. canonicalize Asset rows with normalized path and source-provided metadata;
8. build `ReadyImportContent`, load current state once, and reconcile;
9. merge parser/path/reconciler diagnostics into preview changes and summary;
10. compute deterministic hashes from canonical JSON sorted by path;
11. replace finalized entry rows, setting `rawMarkdown: null`;
12. mark snapshot READY with `expiresAt = finalizedAt + 30 minutes`.

Use one helper for deterministic SHA-256:

```ts
import { createHash } from "node:crypto";

function canonicalHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}
```

Snapshot hash input must be exactly:

```ts
const snapshotHashInput = {
  adapterType: snapshot.adapterType,
  adapterVersion: snapshot.adapterVersion,
  workspaceId: snapshot.workspaceId,
  sourceId: snapshot.sourceId,
  basedOnVersion: snapshot.basedOnVersion,
  proposedSourceName: snapshot.proposedSourceName,
  entries: finalizedEntries
    .filter((entry) => entry.sourcePath !== null)
    .sort((left, right) => left.sourcePath!.localeCompare(right.sourcePath!))
    .map((entry) => ({
      sourcePath: entry.sourcePath,
      entryType: entry.entryType,
      revisionContentHash: entry.revisionContentHash,
      reconciliationFingerprint: entry.reconciliationFingerprint,
      assetContentHash: entry.assetContentHash,
      resolvedTitle: entry.resolvedTitle,
      metadata: entry.metadata,
    })),
};
```

`planHash = canonicalHash(plan)`. READY rows must never be reparsed or overwritten.

- [ ] **Step 4: Run finalize, parser, reconciler, and full integration suites**

Run:

```bash
npx vitest run --config vitest.integration.config.ts tests/integration/phase2-import-finalize.test.ts
npm run test:unit -- tests/unit/phase2-import-parser.test.ts tests/unit/phase2-reconciler.test.ts
npm run test:integration
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit Task 5**

```bash
git add src/modules/sources/application/reconcile-import-snapshot.ts src/modules/sources/application/finalize-folder-import.ts tests/integration/phase2-import-finalize.test.ts
git commit -m "feat: finalize immutable import previews"
```

---

### Task 6: Atomic Whole-Snapshot Apply, Stable Identity, Rollback, and Concurrency

**Files:**
- Create: `src/modules/sources/application/source-import-plan-executor.ts`
- Create: `src/modules/sources/application/apply-folder-import.ts`
- Modify: `src/modules/sources/application/source-knowledge-projection-service.ts`
- Test: `tests/integration/phase2-import-apply.test.ts`
- Test: `tests/integration/phase2-import-concurrency.test.ts`

**Interfaces:**
- Consumes: persisted `FolderImportPlan`, Task 3 UoW, existing `bindSourceProjection()`, SourceEntry mapping primitives.
- Produces:

```ts
export type ApplyFolderImportResult =
  | { kind: "APPLIED"; sourceId: string; resultVersion: number; runId: string; alreadyApplied: boolean }
  | { kind: "VERSION_CONFLICT"; sourceId: string; currentVersion: number };

export class ApplyFolderImportService {
  apply(caller: CallerContext, snapshotId: string): Promise<ApplyFolderImportResult>;
}
```

`source-import-plan-executor.ts` exports:

```ts
export async function executeFolderImportPlan(
  repositories: SourceRepositories,
  caller: CallerContext,
  source: KnowledgeSource,
  plan: FolderImportPlan,
  options?: { failurePoint?: "folders" | "documents" | "revisions" | "assets" | "before-run" },
): Promise<void>;
```

The optional failure point is only accepted by direct application-service tests; it is never wired into server/HTTP functions.

- [ ] **Step 1: Write failing apply/rollback/stable-ID tests**

Create `tests/integration/phase2-import-apply.test.ts`. Cover first import, existing sync, no-op, archive/restore, assets, and rollback:

```ts
it("creates Source only on first Confirm and commits version 1 with one APPLIED run", async () => {
  const result = await apply.apply(caller, readyInitialSnapshotId);
  expect(result).toMatchObject({ kind: "APPLIED", resultVersion: 1, alreadyApplied: false });
  expect(await countSources(pool, workspaceId)).toBe(1);
  expect(await countAppliedRuns(pool, result.kind === "APPLIED" ? result.sourceId : "")).toBe(1);
});

it("advances version exactly once for a many-document sync", async () => {
  const result = await apply.apply(caller, readyExistingSnapshotId);
  expect(result).toMatchObject({ kind: "APPLIED", resultVersion: 8 });
  expect(await sourceVersion(pool, sourceId)).toBe(8);
  expect(await countAppliedRuns(pool, sourceId)).toBe(1);
});

it("advances version on all-UNCHANGED no-op without creating revisions", async () => {
  const before = await countRevisions(pool, sourceId);
  const result = await apply.apply(caller, readyNoopSnapshotId);
  expect(result).toMatchObject({ kind: "APPLIED", resultVersion: 8 });
  expect(await countRevisions(pool, sourceId)).toBe(before);
});

it("archives then restores the same SourceEntry/Document/TreeNode IDs", async () => {
  const original = await idsForPath(pool, sourceId, "docs/a.md");
  await apply.apply(caller, snapshotWithoutA);
  await apply.apply(caller, snapshotWithARestored);
  expect(await idsForPath(pool, sourceId, "docs/a.md")).toEqual(original);
});
```

Add parameterized failure-point tests. For each `folders`, `documents`, `revisions`, `assets`, `before-run`, capture canonical table counts/version before Apply, expect rejection, then assert Source/Document/Revision/Tree/SourceEntry/Asset/version state is identical to before. For initial import failure, assert Source count is still zero.

- [ ] **Step 2: Write failing concurrency tests for stale previews and double Apply**

Create `tests/integration/phase2-import-concurrency.test.ts`:

```ts
it("commits STALE plus FAILED SyncRun on expected version conflict without canonical mutation", async () => {
  const first = await apply.apply(caller, snapshotA);
  expect(first.kind).toBe("APPLIED");
  const before = await canonicalFingerprint(pool, sourceId);
  const second = await apply.apply(caller, snapshotB);
  expect(second).toMatchObject({ kind: "VERSION_CONFLICT", currentVersion: 8 });
  expect(await snapshotState(pool, snapshotB)).toBe("STALE");
  expect(await latestRunStatus(pool, sourceId)).toBe("FAILED");
  expect(await canonicalFingerprint(pool, sourceId)).toBe(before);
});

it("serializes double Apply and returns idempotent success on the second request", async () => {
  const [left, right] = await Promise.all([apply.apply(caller, snapshotId), apply.apply(caller, snapshotId)]);
  expect([left, right].filter((item) => item.kind === "APPLIED")).toHaveLength(2);
  expect([left, right].filter((item) => item.kind === "APPLIED" && item.alreadyApplied === false)).toHaveLength(1);
  expect(await sourceVersion(pool, sourceId)).toBe(8);
  expect(await countAppliedRuns(pool, sourceId)).toBe(1);
});
```

- [ ] **Step 3: Run both suites and verify failure**

Run:

```bash
npx vitest run --config vitest.integration.config.ts tests/integration/phase2-import-apply.test.ts tests/integration/phase2-import-concurrency.test.ts
```

Expected: FAIL because batch Apply does not exist.

- [ ] **Step 4: Add one Source-managed batch ordering primitive and implement plan execution**

Extend `SourceKnowledgeProjectionService` with one focused batch ordering primitive instead of letting the orchestrator update tree rows directly:

```ts
normalizeProjectedOrdering(
  caller: CallerContext,
  input: { nodeId: string; parentId: string | null; position: number }[],
): Promise<void>;
```

Implementation must call `requireBoundSource()` once, verify every listed node belongs to the bound Source and has the expected parent, then call `repositories.tree.updatePosition()` only for changed positions. This keeps canonical tree writes behind Source projection authority while avoiding N calls to `moveProjectedNode()` just for ordering.

Implement `executeFolderImportPlan()` in deterministic order:

```ts
const projection = bindSourceProjection(repositories, { id: source.id, workspaceId: source.workspaceId });
const nodes = await repositories.tree.listBySource(source.id);
const folderIdByPath = new Map<string, string>();
for (const folder of plan.folders.restore) folderIdByPath.set(folder.sourcePath, folder.treeNodeId);
for (const folder of plan.folders.create) {
  const parentId = folder.parentPath === null ? null : folderIdByPath.get(folder.parentPath) ?? null;
  const created = await projection.projectFolder(caller, {
    sourceId: source.id,
    parentId,
    name: folder.name,
    position: folder.desiredPosition,
    mapping: { sourceEntryId: uuidv7(), externalId: null, sourcePath: folder.sourcePath },
  });
  folderIdByPath.set(folder.sourcePath, created.treeNodeId);
}
```

Before the loop, seed `folderIdByPath` with all current exact-path folder mappings from `repositories.importCanonicalState.load(source.id)`, then restore folders top-down. Continue with create docs, restore docs, moves, revisions, locator updates, assets, document archives, asset removals, folder archives deepest-first, and `normalizeProjectedOrdering` last. Use the current revision ID from the plan for optimistic revision creation. For new docs, use `uuidv7()` only for `sourceEntryId`; `projectDocument` generates Document/Revision/Tree IDs itself.

Assets must use `upsertByPath` with a newly generated UUID only for truly new paths; if `find/list` shows an existing path, pass its existing ID so row identity remains stable.

- [ ] **Step 5: Implement `ApplyFolderImportService` with snapshot->Source lock ordering and expected-conflict commit semantics**

The existing-source path must return `VERSION_CONFLICT` from inside the UoW instead of throwing before STALE/FAILED commit:

```ts
const result = await this.unitOfWork.run(async (repositories) => {
  await repositories.users.upsertIdentity(caller.identity);
  const snapshot = await repositories.importSnapshots.lockById(snapshotId);
  requireApplyableSnapshot(snapshot, caller);
  if (snapshot.state === "APPLIED") {
    return { kind: "APPLIED" as const, sourceId: snapshot.resultSourceId!, resultVersion: snapshot.resultVersion!, runId: "", alreadyApplied: true };
  }
  if (snapshot.sourceId !== null) {
    const source = await repositories.sources.lockById(snapshot.sourceId);
    if (!source) throw importError("IMPORT_SNAPSHOT_NOT_FOUND", "Import snapshot target is unavailable.");
    await repositories.workspaceAccess.requireMembership(caller, source.workspaceId);
    if (source.status !== "ACTIVE") throw importError("SOURCE_NOT_ACTIVE", "Source is not active.");
    if (source.ownership !== "SOURCE_MANAGED" || source.sourceType !== "FOLDER_SYNC") throw importError("SOURCE_NOT_SOURCE_MANAGED", "Folder sync requires an active SOURCE_MANAGED FOLDER_SYNC source.");
    if (source.syncVersion !== snapshot.basedOnVersion) {
      const now = new Date();
      await repositories.importSnapshots.markStale({ snapshotId, staleAt: now });
      await repositories.syncRuns.insert({ id: uuidv7(), sourceId: source.id, triggeredBy: caller.identity.id, basedOnVersion: snapshot.basedOnVersion!, resultVersion: null, status: "FAILED", summary: { snapshotId, snapshotHash: snapshot.snapshotHash, failureCode: "SOURCE_VERSION_CONFLICT" }, startedAt: now, completedAt: now });
      return { kind: "VERSION_CONFLICT" as const, sourceId: source.id, currentVersion: source.syncVersion };
    }
    const resultVersion = await repositories.sources.guardAndAdvanceVersion(source.id, snapshot.basedOnVersion!, caller.identity.id);
    if (resultVersion === null) throw new Error("Locked source version guard unexpectedly failed.");
    await executeFolderImportPlan(repositories, caller, source, snapshot.plan!, this.testOptions);
    const runId = uuidv7();
    const now = new Date();
    await repositories.syncRuns.insert({ id: runId, sourceId: source.id, triggeredBy: caller.identity.id, basedOnVersion: snapshot.basedOnVersion!, resultVersion, status: "APPLIED", summary: { snapshotId, snapshotHash: snapshot.snapshotHash, counts: snapshot.summary, changed: snapshot.summary!.changed }, startedAt: now, completedAt: now });
    await repositories.importSnapshots.markApplied({ snapshotId, sourceId: source.id, resultVersion, appliedAt: now });
    return { kind: "APPLIED" as const, sourceId: source.id, resultVersion, runId, alreadyApplied: false };
  }
  return this.applyInitialInTransaction(repositories, caller, snapshot);
});
```

`applyInitialInTransaction()` must re-check Workspace membership, create one `FOLDER_SYNC/SOURCE_MANAGED/ACTIVE` Source at version 0 using `proposedSourceName`, execute the plan, call `guardAndAdvanceVersion(sourceId, 0, actor)` to produce version 1, insert APPLIED SyncRun, and mark snapshot APPLIED in the same transaction.

Outside the UoW, catch unexpected failures. Only if the snapshot targeted an already-existing Source, open a separate UoW and insert one FAILED run with `failureCode: "IMPORT_APPLY_FAILED"`; do not change snapshot READY state. Do not write a FAILED run for failed initial import.

- [ ] **Step 6: Run focused tests, full integration suite, and commit**

Run:

```bash
npx vitest run --config vitest.integration.config.ts tests/integration/phase2-import-apply.test.ts tests/integration/phase2-import-concurrency.test.ts
npm run test:integration
npm run test:unit
npm run typecheck
npm run lint
```

Expected: PASS.

Commit:

```bash
git add src/modules/sources/application/source-import-plan-executor.ts src/modules/sources/application/apply-folder-import.ts src/modules/sources/application/source-knowledge-projection-service.ts tests/integration/phase2-import-apply.test.ts tests/integration/phase2-import-concurrency.test.ts
git commit -m "feat: apply folder imports atomically"
```

---

### Task 7: Staging Cleanup and Retention Safety

**Files:**
- Create: `src/modules/sources/application/cleanup-folder-imports.ts`
- Create: `scripts/db/cleanup-import-snapshots.ts`
- Test: `tests/integration/phase2-import-cleanup.test.ts`

**Interfaces:**
- Consumes: `ImportSnapshotRepository.listCleanupCandidates()` and creator-independent infrastructure execution.
- Produces:

```ts
export class CleanupFolderImportsService {
  cleanup(input?: { now?: Date; batchSize?: number }): Promise<{ deleted: number }>;
}
```

- [ ] **Step 1: Write the failing cleanup lifecycle test**

Create snapshots representing expired BUILDING, expired READY, STALE older than 24h, APPLIED older than 24h, and fresh READY. Create child staging entries for each. The test must assert only eligible snapshots/children disappear while canonical Source/Revision/SyncRun rows remain unchanged.

```ts
it("physically deletes only expired staging rows and cascades entries", async () => {
  const result = await cleanup.cleanup({ now, batchSize: 100 });
  expect(result.deleted).toBe(4);
  expect(await stagingExists(pool, freshReadyId)).toBe(true);
  expect(await stagingEntryCount(pool, expiredReadyId)).toBe(0);
  expect(await canonicalCounts(pool)).toEqual(beforeCanonicalCounts);
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
npx vitest run --config vitest.integration.config.ts tests/integration/phase2-import-cleanup.test.ts
```

Expected: FAIL because cleanup service/script are missing.

- [ ] **Step 3: Implement bounded conditional cleanup**

`ImportSnapshotRepository.listCleanupCandidates(now, limit)` must select only:

```text
BUILDING or READY with expires_at <= now
STALE with stale_at <= now - 24h
APPLIED with applied_at <= now - 24h
```

Return at most `limit` IDs. `deleteById()` must be a conditional DELETE that repeats the same eligibility rule under the transaction, so an Apply that row-locks/updates a snapshot cannot be deleted between selection and mutation.

Implement service:

```ts
export class CleanupFolderImportsService {
  constructor(private readonly unitOfWork: SourceUnitOfWork) {}

  async cleanup(input: { now?: Date; batchSize?: number } = {}): Promise<{ deleted: number }> {
    const now = input.now ?? new Date();
    const batchSize = Math.min(Math.max(input.batchSize ?? 200, 1), 500);
    return this.unitOfWork.run(async (repositories) => {
      const ids = await repositories.importSnapshots.listCleanupCandidates(now, batchSize);
      let deleted = 0;
      for (const id of ids) {
        deleted += await repositories.importSnapshots.deleteIfCleanupEligible(id, now) ? 1 : 0;
      }
      return { deleted };
    });
  }
}
```

Add `deleteIfCleanupEligible(snapshotId, now): Promise<boolean>` to the port rather than exposing unsafe unconditional cleanup deletion.

Create `scripts/db/cleanup-import-snapshots.ts` to instantiate the dev pool/UoW, run one bounded cleanup batch, print only the deleted count, and close the pool in `finally`.

- [ ] **Step 4: Run cleanup/full integration tests and commit**

Run:

```bash
npx vitest run --config vitest.integration.config.ts tests/integration/phase2-import-cleanup.test.ts
npm run test:integration
npm run typecheck
```

Expected: PASS.

Commit:

```bash
git add src/modules/sources/application/cleanup-folder-imports.ts scripts/db/cleanup-import-snapshots.ts tests/integration/phase2-import-cleanup.test.ts src/modules/sources/ports/import-snapshot-repository.ts src/infrastructure/database/mariadb/repositories/import-snapshots.ts
git commit -m "feat: add import staging cleanup"
```

---

### Task 8: Trusted Server Adapter and Next.js Import APIs

**Files:**
- Modify: `src/server/composition.ts`
- Create: `src/server/source-imports.ts`
- Create: `src/server/http-error-response.ts`
- Create: `src/app/api/workspaces/[workspaceId]/source-imports/route.ts`
- Create: `src/app/api/sources/[sourceId]/source-imports/route.ts`
- Create: `src/app/api/source-imports/[snapshotId]/route.ts`
- Create: `src/app/api/source-imports/[snapshotId]/entries/route.ts`
- Create: `src/app/api/source-imports/[snapshotId]/finalize/route.ts`
- Create: `src/app/api/source-imports/[snapshotId]/apply/route.ts`
- Test: `tests/unit/phase2-import-http.test.ts`

**Interfaces:**
- Consumes: Task 4/5/6 application services and the existing trusted `IdentityProvider`.
- Produces JSON API contracts from the approved spec. HTTP never accepts actor IDs, Workspace overrides for resync, Source overrides for snapshot Apply, diff plans, or version overrides.

- [ ] **Step 1: Write failing HTTP error-mapping and request-shape unit tests**

Create `tests/unit/phase2-import-http.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DomainError } from "@/shared/domain/errors";
import { toHttpError } from "@/server/http-error-response";

it("maps hidden access/not-found errors to non-enumerating 404", () => {
  for (const code of ["WORKSPACE_ACCESS_DENIED", "WORKSPACE_NOT_FOUND", "SOURCE_NOT_FOUND", "IMPORT_SNAPSHOT_NOT_FOUND"]) {
    expect(toHttpError(new DomainError(code, "hidden")).status).toBe(404);
  }
});

it("maps stale/version conflict to 409 and retryable database activity to 409", () => {
  expect(toHttpError(new DomainError("SOURCE_VERSION_CONFLICT", "stale")).status).toBe(409);
  expect(toHttpError(new DomainError("IMPORT_APPLY_RETRYABLE", "retry")).status).toBe(409);
});

it("maps validation/import-limit errors to 400", () => {
  expect(toHttpError(new DomainError("UPLOAD_INCOMPLETE", "incomplete")).status).toBe(400);
  expect(toHttpError(new DomainError("IMPORT_SESSION_LIMIT", "limit")).status).toBe(400);
});
```

- [ ] **Step 2: Run unit test and verify failure**

Run:

```bash
npm run test:unit -- tests/unit/phase2-import-http.test.ts
```

Expected: FAIL because HTTP adapter does not exist.

- [ ] **Step 3: Wire services through composition and implement trusted server functions**

Extend `buildServices()`:

```ts
const importLimitsConfig = importLimits();
const importSessions = new CreateFolderImportService(unitOfWork, importLimitsConfig);
const importUploads = new UploadFolderImportEntriesService(unitOfWork, importLimitsConfig);
const importFinalize = new FinalizeFolderImportService(unitOfWork, importLimitsConfig);
const importApply = new ApplyFolderImportService(unitOfWork);
const importCleanup = new CleanupFolderImportsService(unitOfWork);
return { identityProvider, unitOfWork, hub, queries, sources, workspaces, importSessions, importUploads, importFinalize, importApply, importCleanup };
```

Create `src/server/source-imports.ts` using the same trusted identity pattern as `knowledge-read.ts`:

```ts
import { getCurrentIdentity } from "@/modules/identity/application/get-current-identity";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import { applicationServices } from "./composition";

async function caller() {
  const services = applicationServices();
  return callerFromIdentity(await getCurrentIdentity(services.identityProvider));
}

export async function createInitialSourceImport(workspaceId: string, input: InitialImportRequest) {
  const services = applicationServices();
  return services.importSessions.createInitial(await caller(), { workspaceId, ...input });
}

export async function createSourceResync(sourceId: string, input: ResyncRequest) {
  const services = applicationServices();
  return services.importSessions.createResync(await caller(), { sourceId, ...input });
}
```

Add corresponding `uploadSourceImportEntries`, `finalizeSourceImport`, `getSourceImportPreview`, and `applySourceImport` functions. `getSourceImportPreview` must call an application read method that enforces creator equality + current Workspace membership before returning the persisted READY/APPLIED/STALE preview.

Create `http-error-response.ts`:

```ts
import { DomainError } from "@/shared/domain/errors";

export function toHttpError(error: unknown): { status: number; body: { error: { code: string; message: string; details?: Record<string, unknown> } } } {
  if (!(error instanceof DomainError)) return { status: 500, body: { error: { code: "INTERNAL_ERROR", message: "The request could not be completed." } } };
  const hidden = new Set(["WORKSPACE_ACCESS_DENIED", "WORKSPACE_NOT_FOUND", "SOURCE_NOT_FOUND", "IMPORT_SNAPSHOT_NOT_FOUND"]);
  if (hidden.has(error.code)) return { status: 404, body: { error: { code: "NOT_FOUND", message: "The requested resource was not found." } } };
  const conflict = new Set(["SOURCE_VERSION_CONFLICT", "IMPORT_SNAPSHOT_STALE", "IMPORT_APPLY_RETRYABLE"]);
  const status = conflict.has(error.code) ? 409 : error.code.endsWith("NOT_FOUND") ? 404 : 400;
  return { status, body: { error: { code: error.code, message: error.message } } };
}
```

- [ ] **Step 4: Implement six route handlers with bounded JSON/multipart parsing**

For Next.js 15 dynamic route handlers use Promise params:

```ts
export async function POST(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  try {
    const body = await request.json() as InitialImportRequest;
    return Response.json(await createInitialSourceImport(workspaceId, body), { status: 201 });
  } catch (error) {
    const mapped = toHttpError(error);
    return Response.json(mapped.body, { status: mapped.status });
  }
}
```

The upload endpoint accepts `multipart/form-data` with one JSON field named `entries`:

```json
[{"uploadKey":"f1","field":"file-0"},{"uploadKey":"f2","field":"file-1"}]
```

and matching `File` parts `file-0`, `file-1`. Convert each `File.arrayBuffer()` to `Uint8Array`, then call the upload application service. Reject duplicate/missing field names before calling application code.

`POST /apply` converts an application `{ kind: "VERSION_CONFLICT" }` result into:

```ts
return Response.json({ error: { code: "SOURCE_VERSION_CONFLICT", message: "The source changed after this preview was created.", details: { currentVersion: result.currentVersion } } }, { status: 409 });
```

APPLIED and idempotent APPLIED both return 200.

- [ ] **Step 5: Run HTTP/unit/static/full integration checks and commit**

Run:

```bash
npm run test:unit -- tests/unit/phase2-import-http.test.ts
npm run test:unit
npm run test:integration
npm run typecheck
npm run lint
```

Expected: PASS.

Commit:

```bash
git add src/server src/app/api tests/unit/phase2-import-http.test.ts
git commit -m "feat: expose source import APIs"
```

---

### Task 9: Knowledge Browser Import/Sync Launcher and Preview UX

**Files:**
- Modify: `src/modules/knowledge/application/knowledge-query-service.ts`
- Modify: `src/app/knowledge/page.tsx`
- Create: `src/components/knowledge/source-import-launcher.tsx`
- Create: `src/components/knowledge/source-import-preview.tsx`
- Create: `src/components/knowledge/source-import-preview-actions.tsx`
- Create: `src/app/knowledge/imports/[snapshotId]/page.tsx`
- Modify: `src/server/source-imports.ts`

**Interfaces:**
- Consumes: Task 8 APIs and existing `/knowledge` Workspace/Source browser model.
- Produces one human flow: choose folder -> uploading/analyzing -> review persisted Preview -> Apply -> return to Source tree.

Extend `SourceView` so the launcher can decide whether Sync is allowed and display current version:

```ts
export type SourceView = {
  id: string;
  workspaceId: string;
  name: string;
  sourceType: "FOLDER_SYNC" | "FILE_UPLOAD" | "HUB";
  ownership: "SOURCE_MANAGED" | "HUB_MANAGED";
  status: "ACTIVE" | "ARCHIVED";
  syncVersion: number;
};
```

- [ ] **Step 1: Add SourceView fields and verify existing browser tests still pass**

Modify `toSourceView()` to return `sourceType` and `syncVersion`. Run:

```bash
npm run test:unit
npx vitest run --config vitest.integration.config.ts tests/integration/phase1-query.test.ts
```

Expected: PASS; no behavior regression.

- [ ] **Step 2: Implement a client launcher with an explicit discriminated-union state machine**

Create `source-import-launcher.tsx` as a client component. Use this state shape rather than boolean flags:

```ts
type ImportUiState =
  | { kind: "IDLE" }
  | { kind: "PREPARING" }
  | { kind: "UPLOADING"; uploaded: number; total: number }
  | { kind: "FINALIZING" }
  | { kind: "ERROR"; code: string; message: string };
```

Props:

```ts
type SourceImportLauncherProps = {
  workspaceId: string;
  workspaceName: string;
  selectedSource: SourceView | null;
};
```

Render `Import folder` for any selected Workspace and `Sync folder` only when the selected Source is active `SOURCE_MANAGED/FOLDER_SYNC`. The folder input is `multiple` and gets `webkitdirectory` using a ref effect:

```ts
const inputRef = useRef<HTMLInputElement>(null);
useEffect(() => {
  inputRef.current?.setAttribute("webkitdirectory", "");
}, []);
```

When files are selected, sort by `webkitRelativePath || name`. Derive root name from the first path segment. Classify `.md`/`.markdown` case-insensitively as Markdown; all other files are Asset manifest rows. Hash Asset bytes client-side only for asset metadata:

```ts
async function browserSha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
```

Create session first, then upload only Markdown in batches of at most 20 files and at most 10 MiB. Each batch sends the Task 8 multipart mapping. Finalize and `router.push(`/knowledge/imports/${snapshotId}`)` only after all batches succeed. Source name defaults to root folder and is editable only before session creation.

- [ ] **Step 3: Integrate launcher into `/knowledge` without changing existing navigation semantics**

In `page.tsx`, derive the selected source from `model.sources` and render the launcher next to the current Workspace controls only when a Workspace is selected:

```tsx
{model.selectedWorkspaceId ? (
  <SourceImportLauncher
    workspaceId={model.selectedWorkspaceId}
    workspaceName={model.workspaces.find((item) => item.id === model.selectedWorkspaceId)?.name ?? "Workspace"}
    selectedSource={model.sources.find((item) => item.id === model.selectedSourceId) ?? null}
  />
) : null}
```

Do not add actor/employee/org inputs.

- [ ] **Step 4: Implement the persisted Preview page and Apply actions**

Create server `getSourceImportPreviewModel(snapshotId)` in `source-imports.ts` using trusted identity. Create `src/app/knowledge/imports/[snapshotId]/page.tsx`:

```tsx
export const dynamic = "force-dynamic";

export default async function ImportPreviewPage({ params }: { params: Promise<{ snapshotId: string }> }) {
  const { snapshotId } = await params;
  const preview = await getSourceImportPreviewModel(snapshotId);
  return <SourceImportPreview preview={preview} />;
}
```

`SourceImportPreview` renders target Workspace/Source/new Source, based-on version, expiry, Document/Folder/Asset counters, warning/blocker counts, and changed entries. Use simple filter buttons: `Changed`, `Added`, `Updated`, `Moved`, `Archived`, `Warnings`, `All`. Unchanged entries are only shown under All.

`SourceImportPreviewActions` is a client component. Disable Apply when `hasBlockers`, expired, STALE, or APPLIED. On Apply:

```ts
const response = await fetch(`/api/source-imports/${snapshotId}/apply`, { method: "POST" });
const payload = await response.json();
if (response.status === 409 && payload.error?.code === "SOURCE_VERSION_CONFLICT") {
  setState({ kind: "STALE" });
  router.refresh();
  return;
}
if (!response.ok) {
  setState({ kind: "ERROR", message: payload.error?.message ?? "Sync failed." });
  return;
}
router.push(`/knowledge?workspaceId=${workspaceId}&sourceId=${payload.sourceId}`);
router.refresh();
```

Show `Choose folder again` for blockers/expired/stale. Do not render Force Apply or edit controls for source-managed content.

- [ ] **Step 5: Build and manually verify the compile-time Web boundary**

Run:

```bash
npm run typecheck
npm run lint
npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit Task 9**

```bash
git add src/modules/knowledge/application/knowledge-query-service.ts src/app/knowledge src/components/knowledge src/server/source-imports.ts
git commit -m "feat: add folder import preview workflow"
```

---

### Task 10: End-to-End Fixtures, Performance Smoke, Documentation, and Full Regression Gate

**Files:**
- Create: `tests/fixtures/import/basic-v1/README.md`
- Create: `tests/fixtures/import/basic-v1/docs/architecture.md`
- Create: `tests/fixtures/import/basic-v1/docs/runbook.md`
- Create: `tests/fixtures/import/basic-v1/images/diagram.txt`
- Create: `tests/fixtures/import/basic-v2/README.md`
- Create: `tests/fixtures/import/basic-v2/platform/architecture.md`
- Create: `tests/fixtures/import/basic-v2/docs/new-guide.md`
- Create: `tests/fixtures/import/basic-v2/images/diagram.txt`
- Create: `tests/fixtures/import/malformed-frontmatter/broken.md`
- Create: `tests/fixtures/import/title-resolution/frontmatter.md`
- Create: `tests/fixtures/import/title-resolution/h1.md`
- Create: `tests/fixtures/import/title-resolution/filename-only.md`
- Create: `tests/fixtures/import/duplicate-content/a.md`
- Create: `tests/fixtures/import/duplicate-content/b.md`
- Create: `tests/fixtures/import/assets/notes.md`
- Create: `tests/fixtures/import/assets/diagram.txt`
- Create: `tests/e2e/source-import.spec.ts`
- Modify: `tests/unit/phase2-reconciler.test.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: the complete Phase 2 UI/API/application stack.
- Produces: executable acceptance evidence for the approved spec and a 1,000-document in-memory reconciler smoke test.

- [ ] **Step 1: Add deterministic semantic fixtures**

Use these exact fixture semantics:

`basic-v1/README.md`:

```md
---
title: Team Wiki
---
# Team Wiki

Welcome to the team wiki.
```

`basic-v1/docs/architecture.md`:

```md
# Architecture

Architecture v1.
```

`basic-v1/docs/runbook.md`:

```md
# Runbook

Operational runbook.
```

`basic-v2/README.md` keeps identical content. Move `docs/architecture.md` to `platform/architecture.md` and change body to `Architecture v2.` so Preview must show MOVED + UPDATED. Omit `docs/runbook.md` so it becomes ARCHIVED. Add `docs/new-guide.md` so it becomes ADDED. Change `images/diagram.txt` content so Asset is UPDATED.

`malformed-frontmatter/broken.md`:

```md
---
title: [broken
---
# Broken
```

`duplicate-content/a.md` and `b.md` must contain exactly the same body and metadata so reconciliation ambiguity can be tested without relying on filename title in the fingerprint.

- [ ] **Step 2: Write the failing Playwright acceptance scenarios**

Create `tests/e2e/source-import.spec.ts`. Use directory upload against the `webkitdirectory` input. Cover four approved flows:

```ts
import { expect, test } from "@playwright/test";
import path from "node:path";

const fixtures = path.resolve(process.cwd(), "tests/fixtures/import");

test("imports a new folder through Preview and opens the created source", async ({ page }) => {
  await page.goto("/knowledge");
  await page.getByLabel("Choose a workspace").selectOption({ label: "Query Master" });
  await page.getByRole("button", { name: "Apply" }).click();
  await page.getByRole("button", { name: "Import folder" }).click();
  await page.getByLabel("Knowledge folder").setInputFiles(path.join(fixtures, "basic-v1"));
  await page.getByRole("button", { name: "Scan & Preview" }).click();
  await expect(page).toHaveURL(/\/knowledge\/imports\/[0-9a-f-]+$/u);
  await expect(page.getByText("Added", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Apply changes" }).click();
  await expect(page).toHaveURL(/\/knowledge\?workspaceId=.*sourceId=/u);
  await expect(page.getByRole("heading", { name: "Team Wiki" })).toBeVisible();
});

test("resyncs v1 to v2 with move, update, add, archive, and asset update", async ({ page }) => {
  await importFixtureAsNewSource(page, "basic-v1", "Query Master");
  await page.getByRole("button", { name: "Sync folder" }).click();
  await page.getByLabel("Knowledge folder").setInputFiles(path.join(fixtures, "basic-v2"));
  await page.getByRole("button", { name: "Scan & Preview" }).click();
  await expect(page.getByText("Moved", { exact: false })).toBeVisible();
  await expect(page.getByText("Updated", { exact: false })).toBeVisible();
  await expect(page.getByText("Archived", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Apply changes" }).click();
  await expect(page.getByRole("link", { name: "Architecture" })).toBeVisible();
  await expect(page.getByRole("link", { name: "New Guide" })).toBeVisible();
});

test("shows malformed frontmatter blocker and disables Apply", async ({ page }) => {
  await openInitialImport(page, "malformed-frontmatter", "Query Master");
  await expect(page.getByText("INVALID_FRONTMATTER", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply changes" })).toBeDisabled();
});

test("shows stale preview after another snapshot wins", async ({ page, request }) => {
  const snapshotId = await createReadyPreviewFromUi(page, "basic-v1", "Query Master");
  await advanceSameSourceWithSecondPreview(request, page, "basic-v2");
  await page.goto(`/knowledge/imports/${snapshotId}`);
  await page.getByRole("button", { name: "Apply changes" }).click();
  await expect(page.getByText("source changed", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Force apply" })).toHaveCount(0);
});
```

Implement the named helpers in the same test file with explicit UI/API calls; do not create a second test framework.

- [ ] **Step 3: Add the 1,000-document pure reconciler smoke test**

Append to `tests/unit/phase2-reconciler.test.ts`:

```ts
it("reconciles 1,000 documents with lookup-map semantics", () => {
  const documents = Array.from({ length: 1000 }, (_, index) => snapshotDocument(`docs/${String(index).padStart(4, "0")}.md`, `fp-${index}`));
  const current: CanonicalImportState = { documents: [], folders: [], assets: [] };
  const plan = reconcileFolderImport({ sourceBinding: binding, documents, assets: [] }, current);
  expect(plan.documents.create).toHaveLength(1000);
  expect(plan.summary.documents.added).toBe(1000);
});
```

Do not add a brittle millisecond threshold; the existing unit-test timeout is the smoke bound. The implementation must continue using Map-based external/path/fingerprint lookups rather than nested full scans.

- [ ] **Step 4: Update README with Phase 2 usage and boundaries**

Add one concise Phase 2 section explaining:

```text
1. Open /knowledge and choose a Workspace.
2. Import folder for a new SOURCE_MANAGED source, or select an existing SOURCE_MANAGED/FOLDER_SYNC source and choose Sync folder.
3. Review the immutable Preview; warnings may proceed, blockers require fixing the local source and rescanning.
4. Apply atomically. The Source folder remains authoritative; Hub does not edit source-managed Markdown.
5. Assets are metadata-only in Phase 2; binary storage is not included.
```

Also list the optional `KM_IMPORT_*` environment overrides already documented in `.env.example`, and state that cleanup can run with:

```bash
npx tsx scripts/db/cleanup-import-snapshots.ts
```

- [ ] **Step 5: Run the complete acceptance/regression gate**

Run in this order:

```bash
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run build
npm run test:e2e
```

Expected: every command exits 0. Do not claim Phase 2 complete if any command is skipped or failing.

- [ ] **Step 6: Commit the acceptance fixtures/tests/docs**

```bash
git add tests/fixtures/import tests/e2e/source-import.spec.ts tests/unit/phase2-reconciler.test.ts README.md
git commit -m "test: cover phase 2 source import workflow"
```

---

## Final Implementation Review Checklist

Before opening/merging the Phase 2 implementation PR, verify all of these directly against the approved spec:

- [ ] Initial Preview does not create a Source; first successful Confirm creates Source and version 1 atomically.
- [ ] Existing resync receives only Source scope; Workspace/version are server-derived.
- [ ] Browser sends raw Markdown File bytes; server performs fatal UTF-8 validation.
- [ ] YAML frontmatter is metadata, not part of canonical `Revision.markdown`.
- [ ] H1 extraction uses Markdown AST, not regex.
- [ ] Generic adapter always emits `externalId: null`.
- [ ] Revision fingerprint includes title; reconciliation fingerprint excludes title.
- [ ] Reconciler matching order and ambiguous-identity behavior match the spec exactly.
- [ ] Folder rename is old Archived + new Added; no subtree inference exists.
- [ ] Asset projection has no lifecycle/revision/history and stores no binary.
- [ ] Finalize persists immutable READY snapshot + server plan + hashes and clears raw staging Markdown.
- [ ] Apply executes persisted plan only and never reparses/reconciles.
- [ ] Snapshot lock precedes Source lock in every Apply path.
- [ ] Successful no-op sync advances `sync_version` once and writes one APPLIED run with `changed=false`.
- [ ] Version conflict commits STALE + FAILED run and returns HTTP 409 without Knowledge mutation.
- [ ] Double Apply produces one real mutation/run/version advance and one idempotent success.
- [ ] Unexpected existing-source failure rolls back canonical data and leaves snapshot retryable READY.
- [ ] Unexpected initial-import failure leaves no Source and no phantom SyncRun.
- [ ] Creator-private snapshot access and current Workspace membership are enforced at upload/finalize/read/apply time.
- [ ] No Force Apply, actor override, Workspace transfer, filesystem include, outbound fetch, or shell/file-path execution surface exists.
- [ ] Cleanup only physically deletes staging rows; canonical history remains intact.
- [ ] Full lint/typecheck/unit/integration/build/E2E gate passes.
