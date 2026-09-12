# Phase 2 Knowledge Source Import & Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Phase 2 whole-folder Markdown import and re-sync flow from raw browser folder input through immutable Preview to one atomic `SOURCE_MANAGED` canonical Apply.

**Architecture:** Keep ingestion inside the existing Sources module. Browser input becomes a persisted staging snapshot; server-side parsing creates canonical staging entries; a pure reconciler produces a persisted deterministic `FolderImportPlan`; `ApplyFolderImportService` executes only that persisted plan through existing Phase 1 transaction-bound projection/mapping primitives inside one `READ COMMITTED` Source transaction. The Web layer remains an adapter: identity comes from the trusted provider, `/knowledge` launches import/sync, and `/knowledge/imports/[snapshotId]` renders persisted Preview state.

**Tech Stack:** Next.js 15.5, React 19, TypeScript 5.7 strict mode, MariaDB/native UUID, `mariadb`, Vitest, Playwright, npm/package-lock, `yaml`, `mdast-util-from-markdown`, `mdast-util-to-string`, existing Base UI/shadcn-style components and Tailwind.

**Spec:** `docs/superpowers/specs/2026-09-12-phase-2-knowledge-source-import-sync-design.md`

## Global Constraints

- Node engine remains `>=20.9.0 <25`; use npm and commit `package-lock.json`.
- MariaDB remains canonical storage and stable entity IDs remain application-generated UUIDv7 stored in MariaDB native `UUID`.
- Phase 2 only implements Knowledge Source Import & Sync. Production SSO, Workspace administration, MCP, search/embedding, Agent Memory, watchers, bidirectional sync, merge editing, and binary storage remain out of scope.
- Source folder is authority for `SOURCE_MANAGED` content. Hub Preview never edits source-managed Markdown.
- Scanner/parser/finalizer may write staging only; canonical Knowledge mutations occur only in Apply.
- READY snapshots and their persisted plans are immutable. Apply never re-reads the local folder, reparses upload bytes, or re-runs reconciliation.
- Generic Markdown adapter never infers `external_id` from frontmatter `id`, `uuid`, `slug`, or similar fields.
- Canonical Markdown content is `resolved title + body Markdown without YAML frontmatter + canonical metadata`.
- Reconciliation fingerprint is `body Markdown + canonical metadata`, intentionally excluding resolved title.
- Document identity matching order is external ID, exact normalized path, unique unmatched reconciliation fingerprint, then new identity. Ambiguity is never guessed.
- Generic folder identity is exact normalized folder path only. Empty directories are not preserved.
- Assets are current metadata/reference projection only; binary bytes are not stored and asset rename/move is not inferred by hash.
- Existing-source Apply locks snapshot then Source and keeps `READ COMMITTED`; no Redis/distributed lock or Force Apply is introduced.
- One successful Confirm, including an all-UNCHANGED no-op sync, advances `sync_version` exactly once and writes exactly one APPLIED SyncRun.
- Blocking diagnostics prevent Apply; warnings do not. Partial canonical success is forbidden.
- Snapshot access is creator-private and every read/upload/finalize/apply re-checks current Workspace membership.
- Default import limits are exactly: 20,000 manifest entries; 2 KiB normalized UTF-8 path; 5 MiB per Markdown file; 256 MiB total Markdown; 256 KiB parsed metadata per document; 20 files / 10 MiB per upload batch; 3 active BUILDING snapshots/user; 10 active READY snapshots/user.
- Default retention is exactly: BUILDING 2 hours; READY 30 minutes after finalize; STALE 24 hours; APPLIED 24 hours.
- Implementation follows TDD. Test-only fault injection must never be reachable from server/HTTP/UI code.

---

## File Structure

```text
src/modules/sources/
├─ adapters/
│  └─ generic-markdown-folder-adapter.ts
├─ domain/
│  ├─ import-errors.ts
│  ├─ import-diagnostic.ts
│  ├─ import-limits.ts
│  ├─ import-path.ts
│  ├─ import-snapshot.ts
│  ├─ import-title.ts
│  ├─ reconciliation-fingerprint.ts
│  ├─ import-plan.ts
│  └─ import-reconciler.ts
├─ application/
│  ├─ create-folder-import.ts
│  ├─ upload-folder-import-entries.ts
│  ├─ reconcile-import-snapshot.ts
│  ├─ finalize-folder-import.ts
│  ├─ get-folder-import-preview.ts
│  ├─ source-import-plan-executor.ts
│  ├─ apply-folder-import.ts
│  └─ cleanup-folder-imports.ts
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

### Task 1: Safe Generic Markdown Adapter and Import Primitives

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

```ts
export type ImportDiagnostic = {
  code: string;
  severity: "WARNING" | "BLOCKING";
  sourcePath: string | null;
  message: string;
  details?: Record<string, unknown>;
};

export type ParsedMarkdownEntry = {
  sourcePath: string;
  externalId: null;
  resolvedTitle: string;
  titleSource: "FRONTMATTER" | "H1" | "FILENAME";
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

- [ ] **Step 1: Install parser dependencies and write failing tests**

Run:

```bash
npm install yaml mdast-util-from-markdown mdast-util-to-string
```

Create `tests/unit/phase2-import-parser.test.ts`:

```ts
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decodeUtf8Markdown, parseGenericMarkdownText } from "@/modules/sources/adapters/generic-markdown-folder-adapter";
import { isIgnoredImportPath, normalizeImportPath } from "@/modules/sources/domain/import-path";

const hash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

describe("Phase 2 import path", () => {
  it("normalizes separators/dot segments and preserves case", () => {
    expect(normalizeImportPath("Docs\\./K8s/Ingress.MD").sourcePath).toBe("Docs/K8s/Ingress.MD");
  });

  it("rejects unsafe relative/absolute/control-character paths", () => {
    for (const value of ["../x.md", "/x.md", "C:\\x.md", "a\u0000b.md", "a\u001fb.md", "a\u007fb.md"]) {
      expect(() => normalizeImportPath(value)).toThrowError(expect.objectContaining({ code: "INVALID_SOURCE_PATH" }));
    }
  });

  it("ignores fixed system and hidden paths", () => {
    for (const value of [".git/config", ".obsidian/app.json", "node_modules/a.md", "docs/.cache/a.md", ".DS_Store", "Thumbs.db"]) {
      expect(isIgnoredImportPath(value)).toBe(true);
    }
    expect(isIgnoredImportPath("docs/a.md")).toBe(false);
  });
});

describe("Phase 2 Markdown adapter", () => {
  it("accepts BOM and rejects invalid UTF-8", () => {
    expect(decodeUtf8Markdown(new Uint8Array([0xef, 0xbb, 0xbf, 0x23, 0x20, 0x41]))).toBe("# A");
    expect(() => decodeUtf8Markdown(new Uint8Array([0xc3, 0x28]))).toThrowError(expect.objectContaining({ code: "INVALID_MARKDOWN_ENCODING" }));
  });

  it("separates frontmatter, prefers frontmatter title, and warns on H1 conflict", () => {
    const text = "---\ntitle: Canonical\ntags: [b, a]\n---\n# Different\n\nBody\n";
    const result = parseGenericMarkdownText({ sourcePath: "docs/a.md", text, sourceFileHash: hash(text) });
    expect(result.resolvedTitle).toBe("Canonical");
    expect(result.markdown).toBe("# Different\n\nBody\n");
    expect(result.metadata).toEqual({ tags: ["b", "a"], title: "Canonical" });
    expect(result.diagnostics.map((item) => item.code)).toContain("TITLE_CONFLICT");
  });

  it("uses the first real H1 instead of fenced-code text", () => {
    const text = "```md\n# Fake\n```\n\n# Real\n";
    expect(parseGenericMarkdownText({ sourcePath: "a.md", text, sourceFileHash: hash(text) }).resolvedTitle).toBe("Real");
  });

  it("keeps reconciliation fingerprint stable when filename-derived title changes", () => {
    const left = parseGenericMarkdownText({ sourcePath: "foo.md", text: "body\n", sourceFileHash: hash("body\n") });
    const right = parseGenericMarkdownText({ sourcePath: "bar.md", text: "body\n", sourceFileHash: hash("body\n") });
    expect(left.reconciliationFingerprint).toBe(right.reconciliationFingerprint);
    expect(left.revisionContentHash).not.toBe(right.revisionContentHash);
  });
});
```

- [ ] **Step 2: Run the failing test**

```bash
npm run test:unit -- tests/unit/phase2-import-parser.test.ts
```

Expected: FAIL because the Phase 2 modules do not exist.

- [ ] **Step 3: Implement errors, limits, normalization, title resolution, fingerprints, and parser**

`src/modules/sources/domain/import-errors.ts`:

```ts
import { DomainError } from "@/shared/domain/errors";

export class SourceImportError extends DomainError {
  constructor(code: string, message: string) {
    super(code, message);
    this.name = "SourceImportError";
  }
}

export const importError = (code: string, message: string) => new SourceImportError(code, message);
```

`src/modules/sources/domain/import-limits.ts`:

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

`src/modules/sources/domain/import-path.ts`:

```ts
import { createHash } from "node:crypto";
import { importError } from "./import-errors";

const CONTROL = /[\u0000-\u001f\u007f]/u;
const WINDOWS_ABSOLUTE = /^[A-Za-z]:[\\/]/u;

export function compareImportText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function normalizeImportPath(rawPath: string): { sourcePath: string; sourcePathHash: string } {
  if (!rawPath || rawPath.startsWith("/") || WINDOWS_ABSOLUTE.test(rawPath) || CONTROL.test(rawPath)) {
    throw importError("INVALID_SOURCE_PATH", "Source paths must be safe relative paths.");
  }
  const normalized: string[] = [];
  for (const part of rawPath.replace(/\\/g, "/").split("/")) {
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
  return parts.some((part) => part.startsWith(".")) || parts.includes("node_modules") || parts.at(-1) === "Thumbs.db";
}
```

`src/modules/sources/domain/reconciliation-fingerprint.ts`:

```ts
import { createHash } from "node:crypto";
import { canonicalizeJsonObject, type KnowledgeMetadata } from "@/modules/knowledge/domain/content";

export function fingerprintReconciliationContent(input: { markdown: string; metadata: KnowledgeMetadata }): string {
  const payload = JSON.stringify({ markdown: input.markdown.replace(/\r\n/g, "\n"), metadata: canonicalizeJsonObject(input.metadata) });
  return createHash("sha256").update(`knowledge-import-reconcile:v1\0${payload}`, "utf8").digest("hex");
}
```

`src/modules/sources/domain/import-title.ts`:

```ts
import type { ImportDiagnostic } from "./import-diagnostic";
import { importError } from "./import-errors";

export function resolveImportTitle(input: { sourcePath: string; frontmatterTitle: unknown; firstH1: string | null }) {
  const diagnostics: ImportDiagnostic[] = [];
  const fm = typeof input.frontmatterTitle === "string" ? input.frontmatterTitle.trim() : "";
  if (input.frontmatterTitle !== undefined && !fm) diagnostics.push({ code: "INVALID_FRONTMATTER_TITLE", severity: "WARNING", sourcePath: input.sourcePath, message: "frontmatter.title must be a non-empty string; falling back." });
  const h1 = input.firstH1?.trim() || null;
  if (fm) {
    if (h1 && h1 !== fm) diagnostics.push({ code: "TITLE_CONFLICT", severity: "WARNING", sourcePath: input.sourcePath, message: "frontmatter.title differs from the first H1; frontmatter.title wins.", details: { frontmatterTitle: fm, h1 } });
    return { title: fm, source: "FRONTMATTER" as const, diagnostics };
  }
  if (h1) return { title: h1, source: "H1" as const, diagnostics };
  const filename = input.sourcePath.split("/").at(-1) ?? "";
  const title = filename.replace(/\.(?:md|markdown)$/iu, "").trim();
  if (!title) throw importError("INVALID_TITLE", "Markdown file could not resolve a non-empty title.");
  return { title, source: "FILENAME" as const, diagnostics };
}
```

`generic-markdown-folder-adapter.ts` must use `TextDecoder("utf-8", { fatal: true })`, `yaml.parseDocument(..., { strict: true, uniqueKeys: true })`, `document.toJS({ maxAliasCount: 50 })`, and `fromMarkdown()` + `toString()` for the first actual depth-1 heading. Frontmatter root must be a plain object; malformed/non-object frontmatter throws `INVALID_FRONTMATTER`/`FRONTMATTER_NOT_OBJECT`. The returned metadata is canonicalized with `canonicalizeJsonObject()`. Generate `revisionContentHash` with `fingerprintRevisionContent()` and reconciliation fingerprint with `fingerprintReconciliationContent()`. Do not fetch links, resolve `file://`, execute tags, or read filesystem includes.

- [ ] **Step 4: Run focused and full static/unit checks**

```bash
npm run test:unit -- tests/unit/phase2-import-parser.test.ts
npm run test:unit
npm run typecheck
npm run lint
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add package.json package-lock.json src/modules/sources/domain src/modules/sources/adapters tests/unit/phase2-import-parser.test.ts
git commit -m "feat: add phase 2 import parser primitives"
```

---

### Task 2: Deterministic Reconciler and Serializable Action Plan

**Files:**
- Create: `src/modules/sources/domain/import-plan.ts`
- Create: `src/modules/sources/domain/import-reconciler.ts`
- Test: `tests/unit/phase2-reconciler.test.ts`

**Interfaces:**

```ts
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
  contentHash: string;
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
    upsert: { sourcePath: string; sourcePathHash: string; mimeType: string | null; contentHash: string; metadata: Record<string, unknown> }[];
    remove: { assetId: string; sourcePath: string }[];
  };
  ordering: { nodeKey: string; parentPath: string | null; position: number }[];
  preview: ImportPreviewChange[];
  summary: ImportDiffSummary;
};

export function reconcileFolderImport(snapshot: ReadyImportContent, current: CanonicalImportState): FolderImportPlan;
```

`nodeKey` is a stable plan-local key: existing nodes use `tree:<treeNodeId>`; new folder nodes use `folder:<sourcePath>`; new documents use `document:<sourcePath>`. It never becomes a canonical ID.

- [ ] **Step 1: Write failing reconciler decision-table tests**

Create `tests/unit/phase2-reconciler.test.ts` covering exact path UPDATE, unique-fingerprint move/rename, ambiguous duplicate content, restore same IDs, asset path-only matching, folder path-only identity, external-id/path contradiction, and deterministic repeated output. Include:

```ts
it("does not guess ambiguous fingerprint identity", () => {
  const plan = reconcileFolderImport(snapshotWith("guide/c.md", "same"), canonicalWith([doc("a.md", "same"), doc("b.md", "same")]));
  expect(plan.documents.create).toHaveLength(1);
  expect(plan.documents.archive).toHaveLength(2);
  expect(plan.preview.flatMap((item) => item.diagnostics).map((item) => item.code)).toContain("AMBIGUOUS_IDENTITY");
});

it("keeps a restored document on the same IDs", () => {
  const plan = reconcileFolderImport(snapshotWith("docs/a.md", "same"), canonicalWith([doc("docs/a.md", "same", "ARCHIVED")]));
  expect(plan.documents.restore).toEqual([expect.objectContaining({ entryId: "entry:docs/a.md", documentId: "doc:docs/a.md", treeNodeId: "node:docs/a.md" })]);
});

it("blocks external-id/path contradiction", () => {
  expect(() => reconcileFolderImport(snapshotWithExternalId("a.md", "X"), canonicalWithExternalConflict())).toThrowError(expect.objectContaining({ code: "IDENTITY_CONFLICT" }));
});
```

Define the local `snapshotWith`, `doc`, `canonicalWith`, `snapshotWithExternalId`, and `canonicalWithExternalConflict` builders in the same test file; each builder returns the exact Task 2 interfaces above and uses deterministic string IDs.

- [ ] **Step 2: Run the failing test**

```bash
npm run test:unit -- tests/unit/phase2-reconciler.test.ts
```

Expected: FAIL because plan/reconciler modules are missing.

- [ ] **Step 3: Implement four-pass matching and deterministic desired ordering**

Use exact binary-like text ordering from Task 1, never locale-sensitive ordering:

```ts
const orderedDocuments = [...snapshot.documents].sort((a, b) => compareImportText(a.sourcePath, b.sourcePath));
```

Build O(n) lookup maps:

```ts
const byExternalId = new Map(current.documents.filter((item) => item.externalId !== null).map((item) => [item.externalId!, item]));
const byPath = new Map(current.documents.map((item) => [item.sourcePath, item]));
const byFingerprint = new Map<string, CanonicalDocumentState[]>();
for (const item of current.documents) {
  const values = byFingerprint.get(item.reconciliationFingerprint) ?? [];
  values.push(item);
  byFingerprint.set(item.reconciliationFingerprint, values);
}
```

Matching must be exactly:

```ts
function matchDocument(incoming: ReadyImportDocument): CanonicalDocumentState | null {
  if (incoming.externalId !== null) {
    const external = byExternalId.get(incoming.externalId);
    const path = byPath.get(incoming.sourcePath);
    if (external && path && external.entryId !== path.entryId) throw importError("IDENTITY_CONFLICT", "External identity and source path resolve to different documents.");
    if (external && !matched.has(external.entryId)) return external;
  }
  const exact = byPath.get(incoming.sourcePath);
  if (exact && !matched.has(exact.entryId)) return exact;
  const candidates = (byFingerprint.get(incoming.reconciliationFingerprint) ?? []).filter((item) => !matched.has(item.entryId));
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) ambiguous.set(incoming.sourcePath, candidates.map((item) => item.sourcePath).sort(compareImportText));
  return null;
}
```

Derive required folders from document+asset parent segments. Folder reconciliation only matches exact path. Sort folder restore/create by depth ascending then `compareImportText`; archive by depth descending then `compareImportText`.

For each parent group, derive one final active ordering: folders first, then documents; within each category sort the child basename with `compareImportText`. Emit `ordering` positions from 0..N-1. New entities are represented by plan-local `nodeKey`, never UUID.

A matched document may emit several actions. Rules are exact:

```text
ARCHIVED existing -> restore
parent path changed -> move + MOVED label
basename changed -> RENAMED label
canonical title/markdown/metadata changed -> revise + UPDATED label
path changed or content hash changed -> updateLocator
no lifecycle/path/content change -> UNCHANGED only
```

Unmatched active existing documents archive. Unmatched archived existing documents remain archived and do not emit another archive. Assets match path only: same path+same payload unchanged; same path+changed payload upsert UPDATED; new path upsert ADDED; missing old path remove. Same asset hash at a different path remains remove+add.

- [ ] **Step 4: Run unit/static checks**

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

### Task 3: Staging/Asset Migrations and MariaDB Repository Contracts

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
- Modify: `src/modules/sources/domain/import-snapshot.ts`
- Create: `src/infrastructure/database/mariadb/repositories/import-snapshots.ts`
- Create: `src/infrastructure/database/mariadb/repositories/import-snapshot-entries.ts`
- Create: `src/infrastructure/database/mariadb/repositories/import-canonical-state.ts`
- Modify: `src/infrastructure/database/mariadb/repositories/assets.ts`
- Modify: `src/infrastructure/database/mariadb/repositories/index.ts`
- Test: `tests/integration/phase2-import-schema.test.ts`

**Interfaces:**

```ts
export interface ImportSnapshotRepository {
  insert(snapshot: ImportSnapshot): Promise<void>;
  findById(snapshotId: string): Promise<ImportSnapshot | null>;
  lockById(snapshotId: string): Promise<ImportSnapshot | null>;
  countActiveByCreatorAndState(creatorId: string, state: "BUILDING" | "READY", now: Date): Promise<number>;
  markReady(input: MarkImportSnapshotReadyInput): Promise<void>;
  markApplied(input: { snapshotId: string; sourceId: string; resultVersion: number; appliedAt: Date }): Promise<void>;
  markStale(input: { snapshotId: string; staleAt: Date }): Promise<void>;
  listCleanupCandidates(now: Date, limit: number): Promise<string[]>;
  deleteIfCleanupEligible(snapshotId: string, now: Date): Promise<boolean>;
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

- [ ] **Step 1: Write failing migration/repository tests**

Create `tests/integration/phase2-import-schema.test.ts` using the existing isolated MariaDB pattern. Assert migrations 6/7 apply, required columns/indexes exist, snapshot binding constraints reject invalid shapes, entry rows cascade on snapshot deletion, and `AssetRepository.upsertByPath()` preserves row ID while updating current projection values.

Key assertions:

```ts
expect((await pool.query<{ version: number; state: string }[]>("SELECT version, state FROM schema_migrations WHERE version IN (6,7) ORDER BY version")).map((row) => [Number(row.version), row.state])).toEqual([[6, "APPLIED"], [7, "APPLIED"]]);
expect((await pool.query<{ INDEX_NAME: string }[]>("SHOW INDEX FROM source_import_snapshot_entries")).map((row) => row.INDEX_NAME)).toContain("uq_import_entries_snapshot_path_hash");
```

- [ ] **Step 2: Run the failing integration test**

```bash
npx vitest run --config vitest.integration.config.ts tests/integration/phase2-import-schema.test.ts
```

Expected: FAIL because migration/repository surfaces do not exist.

- [ ] **Step 3: Add migration 006 and staging domain types**

Add `ImportSnapshot`, `ImportSnapshotEntry`, `FinalizedImportSnapshotEntry`, and `MarkImportSnapshotReadyInput` to `import-snapshot.ts` with the fields approved in the spec. The database tables must use native `UUID`, binary collation for paths/hashes, JSON validity checks, `ON DELETE CASCADE` only from snapshot to staging entry, and these exact indexes:

```text
idx_import_snapshots_creator_state(created_by, state)
idx_import_snapshots_source_created(source_id, created_at)
idx_import_snapshots_workspace_created(workspace_id, created_at)
idx_import_snapshots_state_expires(state, expires_at)
uq_import_entries_snapshot_upload(snapshot_id, upload_key)
uq_import_entries_snapshot_path_hash(snapshot_id, source_path_hash)
idx_import_entries_snapshot_upload(snapshot_id, upload_status)
```

The binding check must enforce:

```text
initial: source_id NULL, based_on_version NULL, proposed_source_name NOT NULL
resync:  source_id NOT NULL, based_on_version NOT NULL, proposed_source_name NULL
```

`source_path_hash` remains nullable. This is required so invalid/colliding entries can still be persisted in a READY blocker Preview without violating the unique index. Finalizer sets `source_path_hash = NULL` on every entry involved in `PATH_COLLISION`; only valid unique normalized paths receive a hash.

- [ ] **Step 4: Add repository implementations and one bounded canonical-state loader**

Add the three ports above to `SourceRepositories` and `createRepositories()`. `MariaDbImportCanonicalStateRepository.load(sourceId)` must use bounded queries: one SourceEntry/Document/current-Revision/Tree join plus one asset query. Do not call `findCurrent()` once per document. Compute each current document reconciliation fingerprint in memory from current Revision markdown+metadata.

Repository state-transition writes must be conditional:

```sql
UPDATE source_import_snapshots
SET state = 'READY', snapshot_hash = ?, plan_hash = ?, summary = ?, plan = ?, has_blockers = ?, finalized_at = ?, expires_at = ?
WHERE id = ? AND state = 'BUILDING'
```

Use affected-row checks so READY/APPLIED/STALE rows cannot be mutated back into another state.

- [ ] **Step 5: Add migration 007 and upgrade AssetRepository**

Change `KnowledgeAsset` and port:

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

export interface AssetRepository {
  insert(asset: KnowledgeAsset): Promise<void>;
  findById(assetId: string): Promise<KnowledgeAsset | null>;
  listBySourceId(sourceId: string): Promise<KnowledgeAsset[]>;
  upsertByPath(asset: KnowledgeAsset): Promise<void>;
  deleteById(assetId: string): Promise<void>;
}
```

Before migration 007, read all existing assets and require every `source_path` already equals `normalizeImportPath(source_path).sourcePath`; also reject duplicate normalized paths per Source. Then run fixed migration statements:

```sql
ALTER TABLE knowledge_assets ADD COLUMN source_path_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL;
ALTER TABLE knowledge_assets ADD COLUMN updated_at DATETIME(6) NULL;
UPDATE knowledge_assets SET source_path_hash = LOWER(SHA2(source_path, 256)), updated_at = created_at WHERE source_path_hash IS NULL OR updated_at IS NULL;
ALTER TABLE knowledge_assets MODIFY source_path_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL;
ALTER TABLE knowledge_assets MODIFY updated_at DATETIME(6) NOT NULL;
ALTER TABLE knowledge_assets ADD CONSTRAINT uq_assets_source_path_hash UNIQUE (source_id, source_path_hash);
```

`upsertByPath()` uses `INSERT ... ON DUPLICATE KEY UPDATE` and must preserve the existing row ID while updating path/hash/MIME/content/metadata/updated_at.

- [ ] **Step 6: Run focused/full integration/static checks**

```bash
npx vitest run --config vitest.integration.config.ts tests/integration/phase2-import-schema.test.ts
npm run test:integration
npm run typecheck
npm run lint
```

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

```bash
git add src/infrastructure/database/mariadb src/modules/sources/domain/asset.ts src/modules/sources/domain/import-snapshot.ts src/modules/sources/ports tests/integration/phase2-import-schema.test.ts
git commit -m "feat: add phase 2 import staging persistence"
```

---

### Task 4: BUILDING Session Creation, Manifest Authority, Limits, and Raw-Byte Upload

**Files:**
- Create: `src/server/import-config.ts`
- Modify: `.env.example`
- Create: `src/modules/sources/application/create-folder-import.ts`
- Create: `src/modules/sources/application/upload-folder-import-entries.ts`
- Test: `tests/integration/phase2-import-session.test.ts`

**Interfaces:**

```ts
export type ImportManifestEntry =
  | { uploadKey: string; relativePath: string; kind: "MARKDOWN"; size: number }
  | { uploadKey: string; relativePath: string; kind: "ASSET"; size: number; contentHash: string; mimeType: string | null; lastModified: Date | null };

export class CreateFolderImportService {
  createInitial(caller: CallerContext, input: { workspaceId: string; sourceName: string; rootName: string; manifest: ImportManifestEntry[] }): Promise<{ snapshotId: string; state: "BUILDING"; expiresAt: Date }>;
  createResync(caller: CallerContext, input: { sourceId: string; rootName: string; manifest: ImportManifestEntry[] }): Promise<{ snapshotId: string; state: "BUILDING"; expiresAt: Date }>;
}

export class UploadFolderImportEntriesService {
  upload(caller: CallerContext, input: { snapshotId: string; entries: { uploadKey: string; bytes: Uint8Array }[] }): Promise<{ accepted: number; idempotent: number; diagnostics: ImportDiagnostic[] }>;
}
```

- [ ] **Step 1: Write failing session/upload integration tests**

Create `tests/integration/phase2-import-session.test.ts`. Cover:

```text
initial session creates BUILDING snapshot but no Source
resync derives Workspace and based_on_version from Source
HUB_MANAGED or ARCHIVED Source rejects
nonmember rejects
another user cannot upload to creator snapshot
expired snapshot rejects upload
4th active BUILDING snapshot rejects with IMPORT_SESSION_LIMIT
11th active READY snapshot rejects with IMPORT_SESSION_LIMIT
expired BUILDING/READY rows do not count against active quota
manifest >20,000 rejects
Markdown >5 MiB rejects
Markdown total >256 MiB rejects
upload batch >20 files or >10 MiB rejects
same uploadKey + same bytes is idempotent
same uploadKey + different bytes is UPLOAD_ENTRY_CONFLICT
invalid UTF-8 is stored as RECEIVED with BLOCKING diagnostic and no raw text
```

- [ ] **Step 2: Run the failing test**

```bash
npx vitest run --config vitest.integration.config.ts tests/integration/phase2-import-session.test.ts
```

Expected: FAIL because services/config are missing.

- [ ] **Step 3: Implement exact import configuration and authoritative manifest classification**

`import-config.ts` reads positive integer overrides for the nine approved limits and defaults to `DEFAULT_IMPORT_LIMITS`. Add those nine variables to `.env.example` with exact default numbers.

At session creation, `kind` is a client hint only. Server classification is authoritative:

```ts
function classify(relativePath: string): "DOCUMENT" | "ASSET" {
  return /\.(?:md|markdown)$/iu.test(relativePath) ? "DOCUMENT" : "ASSET";
}
```

If client says ASSET for `a.md`, persist it as DOCUMENT/PENDING and require raw Markdown upload. If client says MARKDOWN for `a.png`, persist it as ASSET/RECEIVED and require asset hash metadata. Do not trust client classification to bypass parsing.

Validate `sourceName.trim()` and `rootName.trim()` are nonempty and at most 512 UTF-8 characters/bytes as appropriate for their DB columns. Validate unique `uploadKey` and unique raw relative path in the manifest. Sort manifest deterministically with `compareImportText(relativePath)` then `compareImportText(uploadKey)` before hashing canonical JSON.

Both session methods must upsert trusted caller identity, re-check Workspace membership, and use `countActiveByCreatorAndState(..., now)` for quotas. BUILDING `expiresAt` is exactly `now + 2h`. `createResync()` loads Source server-side and accepts no Workspace/version argument.

- [ ] **Step 4: Implement raw-byte upload idempotency and invalid-encoding blocker persistence**

Before storing a batch: lock/read snapshot, require creator equality, current Workspace membership, BUILDING, unexpired state, and batch limits. For each DOCUMENT upload compute SHA-256 over raw bytes. If already RECEIVED, same hash is idempotent and different hash throws `UPLOAD_ENTRY_CONFLICT`. Decode with Task 1 fatal UTF-8 decoder. On `INVALID_MARKDOWN_ENCODING`, mark RECEIVED with `rawMarkdown = null`, hash, and one BLOCKING diagnostic so Finalize can still produce a blocker Preview.

- [ ] **Step 5: Run focused/full integration/static checks**

```bash
npx vitest run --config vitest.integration.config.ts tests/integration/phase2-import-session.test.ts
npm run test:integration
npm run typecheck
npm run lint
```

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

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

Cover these exact outcomes:

```text
complete valid snapshot -> READY, plan/hash persisted, raw_markdown cleared
incomplete Markdown upload -> UPLOAD_INCOMPLETE and remains BUILDING
malformed frontmatter -> READY + blocker
invalid UTF-8 from Task 4 -> READY + blocker
TITLE_CONFLICT -> warning only
normalized duplicate path -> READY + PATH_COLLISION blocker
ignored paths omitted from plan
empty directories never appear because folders derive from included files
existing Source Preview emits move/update/archive/restore correctly
READY Finalize retry returns persisted Preview without mutation
```

For collision case, assert both colliding staging rows have `source_path_hash IS NULL` after Finalize, proving the blocker can persist without violating `uq_import_entries_snapshot_path_hash`.

- [ ] **Step 2: Run the failing test**

```bash
npx vitest run --config vitest.integration.config.ts tests/integration/phase2-import-finalize.test.ts
```

Expected: FAIL because finalizer is missing.

- [ ] **Step 3: Implement finalization pipeline**

Inside one short staging UoW:

```text
lock snapshot
verify creator + current Workspace membership + BUILDING + not expired
load all manifest entries
require every DOCUMENT upload_status=RECEIVED
normalize paths and server ignore rules
collect normalized-path groups before writing source_path_hash
for groups with >1 entry: attach PATH_COLLISION to every member and leave source_path_hash NULL
parse valid Markdown rows; parser/title errors become BLOCKING diagnostics
validate metadata JSON UTF-8 byte length <=256 KiB
canonicalize Asset rows from source-provided hash/size/MIME/lastModified
build ReadyImportContent from only nonignored, nonblocking canonical entries
load canonical Source state once and reconcile
merge diagnostics into Preview/summary
persist finalized rows with rawMarkdown=NULL
persist FolderImportPlan + snapshotHash + planHash
BUILDING -> READY and set expiresAt=finalizedAt+30m
```

Use deterministic SHA-256 over canonical JSON. Every list included in the hash must first sort paths with `compareImportText`; do not use `localeCompare`.

The snapshot hash input is exactly target binding + adapter type/version + proposed source name + canonicalized entry fields required for Apply. `planHash = SHA256(JSON.stringify(plan))` after the reconciler has emitted deterministic ordering.

If current canonical Source state itself contains duplicate current SourceEntry paths, produce one BLOCKING `CANONICAL_SOURCE_PATH_CONFLICT` diagnostic and do not guess an entry identity.

- [ ] **Step 4: Run focused/unit/full integration checks**

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

### Task 6: Atomic Whole-Snapshot Apply, Rollback, Stable Identity, and Concurrency

**Files:**
- Create: `src/modules/sources/application/source-import-plan-executor.ts`
- Create: `src/modules/sources/application/apply-folder-import.ts`
- Modify: `src/modules/sources/application/source-knowledge-projection-service.ts`
- Test: `tests/integration/phase2-import-apply.test.ts`
- Test: `tests/integration/phase2-import-concurrency.test.ts`

**Interfaces:**

```ts
export type ApplyFolderImportResult =
  | { kind: "APPLIED"; sourceId: string; resultVersion: number; runId: string | null; alreadyApplied: boolean }
  | { kind: "VERSION_CONFLICT"; sourceId: string; currentVersion: number };

export class ApplyFolderImportService {
  apply(caller: CallerContext, snapshotId: string): Promise<ApplyFolderImportResult>;
}

export async function executeFolderImportPlan(
  repositories: SourceRepositories,
  caller: CallerContext,
  source: KnowledgeSource,
  plan: FolderImportPlan,
  options?: { failurePoint?: "folders" | "documents" | "revisions" | "assets" | "before-run" },
): Promise<void>;
```

- [ ] **Step 1: Write failing apply/rollback/stable-ID tests**

Cover:

```text
initial Confirm creates Source only inside Apply and commits version 1 + one APPLIED run
existing sync with many entries advances version once + one APPLIED run
all-UNCHANGED no-op advances version once and creates no Revision
archive/restore reuses same SourceEntry/Document/TreeNode IDs
filename-fallback rename preserves Document ID but creates new Revision title
asset update keeps projection row identity at same path
failure injected after folders/documents/revisions/assets/before-run fully rolls back canonical state/version
initial failure leaves no Source and no SyncRun
existing unexpected failure leaves snapshot READY and records FAILED run only after rollback
```

- [ ] **Step 2: Write failing concurrency tests**

Cover:

```text
A/B snapshots both based_on=7; A applies ->8; B commits STALE+FAILED run and returns VERSION_CONFLICT without Knowledge mutation
parallel double Apply on same snapshot results in exactly one canonical mutation/run/version advance; second result is alreadyApplied=true
membership removed after Preview causes Apply denial and no canonical mutation
HUB_MANAGED/ARCHIVED Source cannot be applied even if snapshot exists
```

- [ ] **Step 3: Run the failing tests**

```bash
npx vitest run --config vitest.integration.config.ts tests/integration/phase2-import-apply.test.ts tests/integration/phase2-import-concurrency.test.ts
```

Expected: FAIL because batch Apply does not exist.

- [ ] **Step 4: Add Source-managed batch ordering primitive and execute persisted plan**

Extend `SourceKnowledgeProjectionService`:

```ts
normalizeProjectedOrdering(caller: CallerContext, input: { nodeId: string; parentId: string | null; position: number }[]): Promise<void>;
```

Its implementation calls `requireBoundSource()` once, verifies every listed node belongs to the bound Source and still has the expected parent, then changes only differing positions through `repositories.tree.updatePosition()`.

`executeFolderImportPlan()` must execute in this order:

```text
restore folders top-down
create folders top-down
create documents
restore documents
move existing documents
create changed revisions
update SourceEntry locators/content hashes
upsert assets
archive missing documents
remove stale asset rows
archive obsolete folders bottom-up
resolve plan-local nodeKey -> actual TreeNode ID and normalize final ordering
```

Seed a `folderIdByPath` map from `ImportCanonicalStateRepository.load(source.id)`. New folder/document UUIDs are generated only in this transaction. New SourceEntry IDs use `uuidv7()`; existing entity IDs from the plan are reused. `projectDocument`, `projectFolder`, `projectRevision`, move/archive/restore primitives remain the mutation authority.

For `ordering`, resolve:

```text
tree:<id> -> existing TreeNode ID
folder:<sourcePath> -> TreeNode ID created/restored for that folder path
document:<sourcePath> -> TreeNode ID created for that new document path
```

Then pass concrete `{nodeId,parentId,position}` rows to `normalizeProjectedOrdering()`.

- [ ] **Step 5: Implement Apply with accessible-snapshot check before state handling**

Inside the UoW, lock snapshot first. Then always verify creator equality and current Workspace membership. State handling is exact:

```text
APPLIED -> return idempotent APPLIED with resultSourceId/resultVersion, runId=null; no new write
STALE -> throw IMPORT_SNAPSHOT_STALE
READY but expired -> throw IMPORT_SNAPSHOT_EXPIRED
READY with blockers -> throw IMPORT_SNAPSHOT_NOT_READY
BUILDING -> throw IMPORT_SNAPSHOT_NOT_READY
```

For existing Source, lock Source second and re-check ACTIVE + `SOURCE_MANAGED/FOLDER_SYNC`. If current version differs from `basedOnVersion`, in the same transaction mark snapshot STALE and insert FAILED SyncRun with `failureCode=SOURCE_VERSION_CONFLICT`; return `{kind:"VERSION_CONFLICT"}` so the UoW commits. HTTP maps it to 409 later.

If versions match, call `guardAndAdvanceVersion()` exactly once, execute persisted plan, insert exactly one APPLIED SyncRun, and mark snapshot APPLIED in the same transaction. The version change rolls back automatically if any later step fails.

For initial import, re-check Workspace membership, create one `FOLDER_SYNC/SOURCE_MANAGED/ACTIVE` Source at version 0, execute plan, advance 0->1 exactly once, insert APPLIED SyncRun `(based=0,result=1)`, and mark snapshot APPLIED in the same transaction.

Outside the UoW, unexpected existing-source failure may open a separate UoW to insert FAILED run with `IMPORT_APPLY_FAILED`; snapshot stays READY. Failed initial import never creates phantom Source/SyncRun.

- [ ] **Step 6: Run focused and full regression checks**

```bash
npx vitest run --config vitest.integration.config.ts tests/integration/phase2-import-apply.test.ts tests/integration/phase2-import-concurrency.test.ts
npm run test:integration
npm run test:unit
npm run typecheck
npm run lint
```

Expected: PASS.

- [ ] **Step 7: Commit Task 6**

```bash
git add src/modules/sources/application/source-import-plan-executor.ts src/modules/sources/application/apply-folder-import.ts src/modules/sources/application/source-knowledge-projection-service.ts tests/integration/phase2-import-apply.test.ts tests/integration/phase2-import-concurrency.test.ts
git commit -m "feat: apply folder imports atomically"
```

---

### Task 7: Creator-Private Preview Read Service and Staging Cleanup

**Files:**
- Create: `src/modules/sources/application/get-folder-import-preview.ts`
- Create: `src/modules/sources/application/cleanup-folder-imports.ts`
- Create: `scripts/db/cleanup-import-snapshots.ts`
- Test: `tests/integration/phase2-import-cleanup.test.ts`

**Interfaces:**

```ts
export class GetFolderImportPreviewService {
  get(caller: CallerContext, snapshotId: string): Promise<ImportPreview>;
}

export class CleanupFolderImportsService {
  cleanup(input?: { now?: Date; batchSize?: number }): Promise<{ deleted: number }>;
}
```

- [ ] **Step 1: Write failing preview-access and cleanup tests**

Cover:

```text
creator + current member can read READY/APPLIED/STALE Preview
same-Workspace different user gets hidden/not-found semantics
creator who lost membership cannot read Preview
expired READY is returned as derived expired state/error suitable for UI
expired BUILDING/READY, STALE older than 24h, APPLIED older than 24h are cleanup candidates
fresh READY remains
snapshot deletion cascades staging entries only
canonical Source/Revision/SyncRun counts remain unchanged
```

- [ ] **Step 2: Run failing test**

```bash
npx vitest run --config vitest.integration.config.ts tests/integration/phase2-import-cleanup.test.ts
```

Expected: FAIL because read/cleanup services are missing.

- [ ] **Step 3: Implement preview read authorization and derived expiry**

`GetFolderImportPreviewService.get()` loads snapshot, returns hidden not-found when snapshot missing or creator differs, re-checks Workspace membership, requires persisted summary+plan for READY/APPLIED/STALE, and maps `plan.preview` into `ImportPreview`. Do not return raw staging Markdown or full frontmatter serialization.

- [ ] **Step 4: Implement bounded conditional cleanup**

`listCleanupCandidates(now, limit)` selects only:

```text
BUILDING or READY where expires_at <= now
STALE where stale_at <= now - 24h
APPLIED where applied_at <= now - 24h
```

`deleteIfCleanupEligible(id, now)` repeats the same predicate in the DELETE statement so selection cannot race an Apply. Cleanup service clamps batch size to 1..500 and defaults to 200. Script creates pool/UoW, runs one batch, prints only deleted count, and closes pool in `finally`.

- [ ] **Step 5: Run integration/static checks**

```bash
npx vitest run --config vitest.integration.config.ts tests/integration/phase2-import-cleanup.test.ts
npm run test:integration
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit Task 7**

```bash
git add src/modules/sources/application/get-folder-import-preview.ts src/modules/sources/application/cleanup-folder-imports.ts scripts/db/cleanup-import-snapshots.ts tests/integration/phase2-import-cleanup.test.ts src/modules/sources/ports/import-snapshot-repository.ts src/infrastructure/database/mariadb/repositories/import-snapshots.ts
git commit -m "feat: add import preview reads and cleanup"
```

---

### Task 8: Trusted Server Adapter and Next.js API Routes

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

```ts
export async function createInitialSourceImport(workspaceId: string, input: InitialImportRequest): Promise<CreateImportResult>;
export async function createSourceResync(sourceId: string, input: ResyncRequest): Promise<CreateImportResult>;
export async function uploadSourceImportEntries(snapshotId: string, entries: { uploadKey: string; bytes: Uint8Array }[]): Promise<UploadImportResult>;
export async function finalizeSourceImport(snapshotId: string): Promise<ImportPreview>;
export async function getSourceImportPreview(snapshotId: string): Promise<ImportPreview>;
export async function applySourceImport(snapshotId: string): Promise<ApplyFolderImportResult>;
```

Every function obtains trusted identity through existing `IdentityProvider` + `callerFromIdentity`; no actor/workspace override is accepted.

- [ ] **Step 1: Write failing HTTP mapping tests**

`tests/unit/phase2-import-http.test.ts` must assert:

```text
WORKSPACE_ACCESS_DENIED / WORKSPACE_NOT_FOUND / SOURCE_NOT_FOUND / IMPORT_SNAPSHOT_NOT_FOUND -> non-enumerating 404 NOT_FOUND
SOURCE_VERSION_CONFLICT / IMPORT_SNAPSHOT_STALE / IMPORT_APPLY_RETRYABLE -> 409
IMPORT_SESSION_LIMIT / UPLOAD_INCOMPLETE / INVALID_* -> 400
unknown error -> 500 INTERNAL_ERROR without internal message
```

- [ ] **Step 2: Run failing HTTP test**

```bash
npm run test:unit -- tests/unit/phase2-import-http.test.ts
```

Expected: FAIL because adapter/routes do not exist.

- [ ] **Step 3: Wire all Phase 2 application services into `composition.ts` and `source-imports.ts`**

Use the same identity flow as `knowledge-read.ts`:

```ts
const services = applicationServices();
const identity = await getCurrentIdentity(services.identityProvider);
const caller = callerFromIdentity(identity);
return services.importPreview.get(caller, snapshotId);
```

Composition must instantiate `CreateFolderImportService`, `UploadFolderImportEntriesService`, `FinalizeFolderImportService`, `GetFolderImportPreviewService`, `ApplyFolderImportService`, and `CleanupFolderImportsService` from the shared `MariaDbUnitOfWork`.

- [ ] **Step 4: Implement JSON routes and bounded multipart upload**

Next.js 15 dynamic params use `Promise<{...}>`. Create-session routes call the initial/resync server functions. GET snapshot calls preview read service. Finalize/Apply use empty POST bodies.

Before `request.json()` or `request.formData()`, reject a declared `Content-Length` larger than the applicable configured limit plus 1 MiB framing allowance. Application limits are still authoritative after parsing, but this prevents obviously oversized bodies from being materialized first.

Upload multipart contract is exact:

```text
field "entries": JSON array [{"uploadKey":"f1","field":"file-0"}]
field "file-0": File bytes
```

Reject duplicate mapping field names, missing `File`, duplicate uploadKey, and non-array metadata before application call.

Apply route maps `{kind:"VERSION_CONFLICT"}` to 409 `SOURCE_VERSION_CONFLICT`; both fresh and idempotent APPLIED results return 200.

- [ ] **Step 5: Run HTTP/unit/integration/static checks**

```bash
npm run test:unit -- tests/unit/phase2-import-http.test.ts
npm run test:unit
npm run test:integration
npm run typecheck
npm run lint
```

Expected: PASS.

- [ ] **Step 6: Commit Task 8**

```bash
git add src/server src/app/api tests/unit/phase2-import-http.test.ts
git commit -m "feat: expose source import APIs"
```

---

### Task 9: `/knowledge` Import/Sync Launcher and Persisted Preview UX

**Files:**
- Modify: `src/modules/knowledge/application/knowledge-query-service.ts`
- Modify: `src/app/knowledge/page.tsx`
- Create: `src/components/knowledge/source-import-launcher.tsx`
- Create: `src/components/knowledge/source-import-preview.tsx`
- Create: `src/components/knowledge/source-import-preview-actions.tsx`
- Create: `src/app/knowledge/imports/[snapshotId]/page.tsx`
- Modify: `src/server/source-imports.ts`

**Interfaces:**

Extend `SourceView`:

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

Client launcher state:

```ts
type ImportUiState =
  | { kind: "IDLE" }
  | { kind: "PREPARING" }
  | { kind: "UPLOADING"; uploaded: number; total: number }
  | { kind: "FINALIZING" }
  | { kind: "ERROR"; code: string; message: string };
```

- [ ] **Step 1: Extend SourceView and run existing Knowledge Browser tests**

`toSourceView()` returns `sourceType` and `syncVersion` from existing SourcePolicy. Run:

```bash
npm run test:unit
npx vitest run --config vitest.integration.config.ts tests/integration/phase1-query.test.ts
```

Expected: PASS.

- [ ] **Step 2: Implement client folder launcher with deterministic manifest and batching**

Render `Import folder` for selected Workspace and `Sync folder` only for selected active `SOURCE_MANAGED/FOLDER_SYNC` Source. Directory input is `multiple` and receives `webkitdirectory` via ref attribute.

When selected, sort files using a raw comparator:

```ts
const ordered = [...files].sort((a, b) => {
  const left = a.webkitRelativePath || a.name;
  const right = b.webkitRelativePath || b.name;
  return left < right ? -1 : left > right ? 1 : 0;
});
```

Derive root folder from first relative-path segment. Source name defaults to root name and is editable before session creation only. Build client hint manifest, but server remains authoritative about document-vs-asset classification. Hash every asset with Web Crypto SHA-256 before create-session request. Upload only files whose paths end `.md`/`.markdown` in batches satisfying both max 20 files and max 10 MiB; each batch uses Task 8 multipart contract. Finalize after uploads, then route to `/knowledge/imports/${snapshotId}`.

- [ ] **Step 3: Integrate launcher into `/knowledge`**

Pass currently selected Workspace and Source to `SourceImportLauncher`. Do not add identity/employee/org controls. Existing Workspace/Source browsing remains intact.

- [ ] **Step 4: Implement server-rendered Preview and client Apply actions**

`/knowledge/imports/[snapshotId]/page.tsx` calls trusted `getSourceImportPreview(snapshotId)`. Preview displays target, based version, expiry, Document/Folder/Asset counters, warning/blocker counts, and change rows. Filters are `Changed`, `Added`, `Updated`, `Moved`, `Archived`, `Warnings`, `All`; UNCHANGED appears only under All.

Apply button is disabled for blockers, derived expiry, STALE, or APPLIED. On 409 `SOURCE_VERSION_CONFLICT`, show stale message and `Choose folder again`; never render Force Apply. On successful Apply, route back to `/knowledge?workspaceId=<workspace>&sourceId=<resultSource>`.

- [ ] **Step 5: Compile/build check**

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

### Task 10: Fixtures, E2E Acceptance, Performance Smoke, and Documentation

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

- [ ] **Step 1: Add semantic fixtures**

`basic-v1` contains unchanged README, Architecture v1, Runbook, and asset `diagram.txt`. `basic-v2` keeps README unchanged, moves Architecture to `platform/architecture.md` and changes body to v2, removes Runbook, adds `docs/new-guide.md`, and changes `diagram.txt`. This produces UNCHANGED + MOVED/UPDATED + ARCHIVED + ADDED + asset UPDATED in one resync.

`malformed-frontmatter/broken.md` is exactly:

```md
---
title: [broken
---
# Broken
```

`duplicate-content/a.md` and `b.md` have exactly identical body+metadata so fingerprint ambiguity is deterministic.

- [ ] **Step 2: Write Playwright acceptance tests**

Create four flows in `tests/e2e/source-import.spec.ts`:

```text
1. Query Master -> Import folder basic-v1 -> Preview Added -> Apply -> created SOURCE_MANAGED Source visible
2. Import basic-v1 -> Sync folder basic-v2 -> Preview Moved/Updated/Archived/Added -> Apply -> tree reflects v2
3. Import malformed-frontmatter -> INVALID_FRONTMATTER visible -> Apply disabled
4. Create old Preview, apply a second Preview for same Source, then Apply old Preview -> stale message; Force Apply absent
```

Use Playwright directory upload on the `webkitdirectory` input. Helpers in the same file must drive real UI/API; do not bypass application logic with direct DB mutations except when a test specifically needs to establish concurrent version state that cannot be achieved through the UI without duplicating unrelated setup.

- [ ] **Step 3: Add 1,000-document pure reconciler smoke test**

Append:

```ts
it("reconciles 1,000 documents with lookup-map matching", () => {
  const documents = Array.from({ length: 1000 }, (_, index) => snapshotDocument(`docs/${String(index).padStart(4, "0")}.md`, `fp-${index}`));
  const plan = reconcileFolderImport({ sourceBinding: binding, documents, assets: [] }, { documents: [], folders: [], assets: [] });
  expect(plan.documents.create).toHaveLength(1000);
  expect(plan.summary.documents.added).toBe(1000);
});
```

No brittle millisecond threshold. The implementation must retain Map-based matching and no nested full scans.

- [ ] **Step 4: Update README**

Document Phase 2 user flow, source-managed authority, blocker/warning behavior, metadata-only assets, optional `KM_IMPORT_*` limits, and cleanup command:

```bash
npx tsx scripts/db/cleanup-import-snapshots.ts
```

- [ ] **Step 5: Run final acceptance gate**

```bash
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run build
npm run test:e2e
```

Expected: every command exits 0. Do not claim Phase 2 complete if any command is skipped or failing.

- [ ] **Step 6: Commit Task 10**

```bash
git add tests/fixtures/import tests/e2e/source-import.spec.ts tests/unit/phase2-reconciler.test.ts README.md
git commit -m "test: cover phase 2 source import workflow"
```

---

## Final Implementation Review Checklist

- [ ] Initial Preview creates no Source; first successful Confirm creates Source and version 1 atomically.
- [ ] Existing resync receives only Source scope; Workspace/version are server-derived.
- [ ] Server, not client `kind`, is authoritative for Markdown-vs-Asset classification.
- [ ] Browser sends raw Markdown File bytes; server performs fatal UTF-8 validation.
- [ ] YAML frontmatter becomes metadata and is absent from canonical `Revision.markdown`.
- [ ] H1 extraction uses Markdown AST, not regex.
- [ ] Generic adapter always emits `externalId: null`.
- [ ] Revision fingerprint includes title; reconciliation fingerprint excludes title.
- [ ] Reconciler matching order/ambiguity behavior matches spec exactly.
- [ ] All deterministic ordering uses binary-like string comparison, not locale-dependent comparison.
- [ ] Folder rename is old Archived + new Added; no subtree inference exists.
- [ ] Asset projection has no lifecycle/revision/history and stores no binary.
- [ ] PATH_COLLISION is representable as READY blocker because colliding staging rows keep `source_path_hash=NULL`.
- [ ] Finalize persists immutable READY snapshot + plan + hashes and clears raw staging Markdown.
- [ ] Apply executes persisted plan only and never reparses/reconciles.
- [ ] Snapshot lock precedes Source lock in every Apply path.
- [ ] Successful no-op sync advances `sync_version` once and writes one APPLIED run with `changed=false`.
- [ ] Version conflict commits STALE + FAILED run and returns HTTP 409 without Knowledge mutation.
- [ ] Double Apply creates one actual mutation/run/version advance and one idempotent success with `runId=null`.
- [ ] Unexpected existing-source failure rolls back canonical data and leaves snapshot retryable READY.
- [ ] Unexpected initial-import failure leaves no Source and no phantom SyncRun.
- [ ] Creator-private snapshot access/current Workspace membership are enforced on read/upload/finalize/apply.
- [ ] No Force Apply, actor override, Workspace transfer, filesystem include, outbound fetch, or shell/filesystem source-path execution exists.
- [ ] Cleanup only physically deletes staging rows; canonical history remains intact.
- [ ] Full lint/typecheck/unit/integration/build/E2E gate passes.
