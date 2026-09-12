# Phase 2 Knowledge Source Import & Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Phase 2 whole-folder Markdown import and re-sync flow from raw browser folder input through immutable Preview to one atomic `SOURCE_MANAGED` canonical Apply.

**Architecture:** Keep ingestion inside the existing Sources module. Browser input becomes a persisted staging snapshot; server-side parsing creates canonical staging entries; a pure reconciler produces a persisted deterministic `FolderImportPlan`; `ApplyFolderImportService` executes only that persisted plan through Phase 1 transaction-bound projection/mapping primitives inside one `READ COMMITTED` transaction. The Web layer remains an adapter: identity comes from the trusted provider, `/knowledge` launches import/sync, and `/knowledge/imports/[snapshotId]` renders persisted Preview state.

**Tech Stack:** Next.js 15.5, React 19, TypeScript 5.7 strict mode, MariaDB/native UUID, `mariadb`, Vitest, Playwright, npm/package-lock, `yaml`, `mdast-util-from-markdown`, `mdast-util-to-string`, existing Base UI/shadcn-style components and Tailwind.

**Spec:** `docs/superpowers/specs/2026-09-12-phase-2-knowledge-source-import-sync-design.md`

## Global Constraints

- Node engine remains `>=20.9.0 <25`; use npm and commit `package-lock.json`.
- MariaDB remains canonical storage and stable entity IDs remain application-generated UUIDv7 stored in native `UUID`.
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
├─ adapters/generic-markdown-folder-adapter.ts
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
├─ unit/phase2-import-parser.test.ts
├─ unit/phase2-reconciler.test.ts
├─ unit/phase2-import-http.test.ts
├─ integration/phase2-import-schema.test.ts
├─ integration/phase2-import-session.test.ts
├─ integration/phase2-import-finalize.test.ts
├─ integration/phase2-import-apply.test.ts
├─ integration/phase2-import-concurrency.test.ts
├─ integration/phase2-import-cleanup.test.ts
├─ e2e/source-import.spec.ts
└─ fixtures/import/{basic-v1,basic-v2,malformed-frontmatter,title-resolution,duplicate-content,assets}/
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

export function compareImportText(left: string, right: string): number;
export function normalizeImportPath(rawPath: string): { sourcePath: string; sourcePathHash: string };
export function isIgnoredImportPath(sourcePath: string): boolean;
export function decodeUtf8Markdown(bytes: Uint8Array): string;
export function parseGenericMarkdownText(input: { sourcePath: string; text: string; sourceFileHash: string }): ParsedMarkdownEntry;
export function fingerprintReconciliationContent(input: { markdown: string; metadata: KnowledgeMetadata }): string;
```

- [ ] **Step 1: Install dependencies and write failing parser/path/fingerprint tests**

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
  it("rejects unsafe paths", () => {
    for (const value of ["../x.md", "/x.md", "C:\\x.md", "a\u0000b.md", "a\u001fb.md", "a\u007fb.md"]) {
      expect(() => normalizeImportPath(value)).toThrowError(expect.objectContaining({ code: "INVALID_SOURCE_PATH" }));
    }
  });
  it("ignores hidden/system paths", () => {
    for (const value of [".git/config", ".obsidian/app.json", "node_modules/a.md", "docs/.cache/a.md", ".DS_Store", "Thumbs.db"]) expect(isIgnoredImportPath(value)).toBe(true);
    expect(isIgnoredImportPath("docs/a.md")).toBe(false);
  });
});

describe("Phase 2 Markdown adapter", () => {
  it("accepts BOM and rejects invalid UTF-8", () => {
    expect(decodeUtf8Markdown(new Uint8Array([0xef, 0xbb, 0xbf, 0x23, 0x20, 0x41]))).toBe("# A");
    expect(() => decodeUtf8Markdown(new Uint8Array([0xc3, 0x28]))).toThrowError(expect.objectContaining({ code: "INVALID_MARKDOWN_ENCODING" }));
  });
  it("separates frontmatter and warns on title conflict", () => {
    const text = "---\ntitle: Canonical\ntags: [b, a]\n---\n# Different\n\nBody\n";
    const result = parseGenericMarkdownText({ sourcePath: "docs/a.md", text, sourceFileHash: hash(text) });
    expect(result.resolvedTitle).toBe("Canonical");
    expect(result.markdown).toBe("# Different\n\nBody\n");
    expect(result.metadata).toEqual({ tags: ["b", "a"], title: "Canonical" });
    expect(result.diagnostics.map((item) => item.code)).toContain("TITLE_CONFLICT");
  });
  it("uses a real H1, not fenced code", () => {
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

- [ ] **Step 2: Verify failure**

```bash
npm run test:unit -- tests/unit/phase2-import-parser.test.ts
```

Expected: FAIL because the new modules do not exist.

- [ ] **Step 3: Implement exact primitive contracts**

`import-errors.ts`:

```ts
import { DomainError } from "@/shared/domain/errors";
export class SourceImportError extends DomainError {
  constructor(code: string, message: string) { super(code, message); this.name = "SourceImportError"; }
}
export const importError = (code: string, message: string) => new SourceImportError(code, message);
```

`import-limits.ts`:

```ts
export type ImportLimits = {
  maxManifestEntries: number; maxPathBytes: number; maxMarkdownFileBytes: number; maxMarkdownTotalBytes: number;
  maxMetadataBytes: number; maxUploadBatchFiles: number; maxUploadBatchBytes: number;
  maxBuildingSnapshotsPerUser: number; maxReadySnapshotsPerUser: number;
};
export const DEFAULT_IMPORT_LIMITS: ImportLimits = {
  maxManifestEntries: 20_000, maxPathBytes: 2 * 1024, maxMarkdownFileBytes: 5 * 1024 * 1024,
  maxMarkdownTotalBytes: 256 * 1024 * 1024, maxMetadataBytes: 256 * 1024,
  maxUploadBatchFiles: 20, maxUploadBatchBytes: 10 * 1024 * 1024,
  maxBuildingSnapshotsPerUser: 3, maxReadySnapshotsPerUser: 10,
};
```

`import-path.ts`:

```ts
import { createHash } from "node:crypto";
import { importError } from "./import-errors";
const CONTROL = /[\u0000-\u001f\u007f]/u;
const WINDOWS_ABSOLUTE = /^[A-Za-z]:[\\/]/u;
export const compareImportText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
export function normalizeImportPath(rawPath: string) {
  if (!rawPath || rawPath.startsWith("/") || WINDOWS_ABSOLUTE.test(rawPath) || CONTROL.test(rawPath)) throw importError("INVALID_SOURCE_PATH", "Source paths must be safe relative paths.");
  const parts: string[] = [];
  for (const part of rawPath.replace(/\\/g, "/").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") throw importError("INVALID_SOURCE_PATH", "Source paths cannot escape the selected folder.");
    parts.push(part);
  }
  if (parts.length === 0) throw importError("INVALID_SOURCE_PATH", "Source path cannot be empty.");
  const sourcePath = parts.join("/");
  return { sourcePath, sourcePathHash: createHash("sha256").update(sourcePath, "utf8").digest("hex") };
}
export function isIgnoredImportPath(path: string) {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.some((part) => part.startsWith(".")) || parts.includes("node_modules") || parts.at(-1) === "Thumbs.db";
}
```

`reconciliation-fingerprint.ts`:

```ts
import { createHash } from "node:crypto";
import { canonicalizeJsonObject, type KnowledgeMetadata } from "@/modules/knowledge/domain/content";
export function fingerprintReconciliationContent(input: { markdown: string; metadata: KnowledgeMetadata }) {
  const payload = JSON.stringify({ markdown: input.markdown.replace(/\r\n/g, "\n"), metadata: canonicalizeJsonObject(input.metadata) });
  return createHash("sha256").update(`knowledge-import-reconcile:v1\0${payload}`, "utf8").digest("hex");
}
```

`import-title.ts` implements exactly: nonempty string frontmatter title -> first real H1 -> filename stem. Invalid/empty frontmatter title emits `INVALID_FRONTMATTER_TITLE` WARNING; frontmatter/H1 mismatch emits `TITLE_CONFLICT` WARNING; empty filename fallback throws `INVALID_TITLE`; no prettification.

`generic-markdown-folder-adapter.ts` uses `TextDecoder("utf-8", { fatal:true })`, strips BOM, parses only leading YAML frontmatter with `yaml.parseDocument(...,{strict:true,uniqueKeys:true})`, converts with `toJS({maxAliasCount:50})`, requires plain object root, canonicalizes metadata, parses body with `fromMarkdown()`, gets first depth-1 heading via `toString()`, computes revision hash with existing `fingerprintRevisionContent()`, and computes reconciliation hash with the function above. It performs no outbound fetch, file read, include resolution, eval, or custom executable tag execution.

- [ ] **Step 4: Run focused/full checks**

```bash
npm run test:unit -- tests/unit/phase2-import-parser.test.ts
npm run test:unit
npm run typecheck
npm run lint
```

Expected: PASS.

- [ ] **Step 5: Commit**

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
export type RevisionPayload = { title: string; markdown: string; metadata: KnowledgeMetadata; contentHash: string };
export type ImportPreviewLabel = "ADDED" | "UPDATED" | "MOVED" | "RENAMED" | "ARCHIVED" | "RESTORED" | "UNCHANGED";
export type ImportPreviewChange = {
  kind: "DOCUMENT" | "FOLDER" | "ASSET";
  sourcePath: string;
  previousPath: string | null;
  labels: ImportPreviewLabel[];
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
export type ReadyImportDocument = {
  sourcePath: string; externalId: string | null; title: string; markdown: string; metadata: KnowledgeMetadata;
  revisionContentHash: string; reconciliationFingerprint: string; diagnostics: ImportDiagnostic[];
};
export type ReadyImportAsset = {
  sourcePath: string; sourcePathHash: string; contentHash: string; mimeType: string | null;
  metadata: Record<string, unknown>; diagnostics: ImportDiagnostic[];
};
export type ReadyImportContent = {
  sourceBinding: { workspaceId: string; sourceId: string | null; basedOnVersion: number | null };
  documents: ReadyImportDocument[]; assets: ReadyImportAsset[];
};
export type CanonicalDocumentState = {
  entryId: string; documentId: string; treeNodeId: string; externalId: string | null; sourcePath: string; status: "ACTIVE" | "ARCHIVED";
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

`nodeKey` is plan-local only: existing nodes `tree:<treeNodeId>`, new folders `folder:<sourcePath>`, new documents `document:<sourcePath>`.

- [ ] **Step 1: Write failing decision-table tests**

Create `tests/unit/phase2-reconciler.test.ts` with local builders returning the exact interfaces above. Cover exact-path UPDATE, unique-fingerprint move/rename, ambiguity, restore, asset path-only matching, folder path-only identity, external-id/path contradiction, and repeated deterministic output.

Key tests:

```ts
it("does not guess ambiguous fingerprint identity", () => {
  const plan = reconcileFolderImport(snapshotWith("guide/c.md", "same"), canonicalWith([doc("a.md", "same"), doc("b.md", "same")]));
  expect(plan.documents.create).toHaveLength(1);
  expect(plan.documents.archive).toHaveLength(2);
  expect(plan.preview.flatMap((item) => item.diagnostics).map((item) => item.code)).toContain("AMBIGUOUS_IDENTITY");
});
it("blocks external-id/path contradiction", () => {
  expect(() => reconcileFolderImport(snapshotWithExternalId("a.md", "X"), canonicalWithExternalConflict())).toThrowError(expect.objectContaining({ code: "IDENTITY_CONFLICT" }));
});
```

- [ ] **Step 2: Verify failure**

```bash
npm run test:unit -- tests/unit/phase2-reconciler.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement four-pass matching with O(n) lookup maps and exact ordering**

Use `Map` for external ID, path, and fingerprint candidates. Matching is exactly:

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

Folder required-set derives only from included document/asset parent segments. Folder restore/create sort depth ascending then `compareImportText`; archive sort depth descending. For each parent, desired sibling ordering is folders first then documents, each by basename with `compareImportText`, positions contiguous from 0.

Matched document action rules are exact: archived -> restore; parent change -> move + MOVED; basename change -> RENAMED; canonical title/markdown/metadata change -> revise + UPDATED; path/content-hash change -> updateLocator; no lifecycle/path/content change -> UNCHANGED. Unmatched active existing documents archive. Ambiguous candidates never match. Assets match path only.

- [ ] **Step 4: Run tests/static checks**

```bash
npm run test:unit -- tests/unit/phase2-reconciler.test.ts
npm run test:unit
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/sources/domain/import-plan.ts src/modules/sources/domain/import-reconciler.ts tests/unit/phase2-reconciler.test.ts
git commit -m "feat: add deterministic folder import reconciler"
```

---

### Task 3: Staging/Asset Migrations and Repository Contracts

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
export type ImportSnapshot = {
  id: string; workspaceId: string; sourceId: string | null; basedOnVersion: number | null; createdBy: string;
  rootName: string; proposedSourceName: string | null; adapterType: "GENERIC_MARKDOWN_FOLDER"; adapterVersion: "phase2:v1"; planVersion: "phase2:v1";
  state: "BUILDING" | "READY" | "APPLIED" | "STALE"; manifestHash: string; snapshotHash: string | null; planHash: string | null;
  hasBlockers: boolean; summary: ImportDiffSummary | null; plan: FolderImportPlan | null;
  createdAt: Date; finalizedAt: Date | null; expiresAt: Date; appliedAt: Date | null; staleAt: Date | null;
  resultSourceId: string | null; resultVersion: number | null;
};
export type ImportSnapshotEntry = {
  id: string; snapshotId: string; uploadKey: string; clientRelativePath: string; sourcePath: string | null; sourcePathHash: string | null;
  entryType: "DOCUMENT" | "ASSET"; uploadStatus: "PENDING" | "RECEIVED"; declaredSize: number; sourceFileHash: string | null;
  rawMarkdown: string | null; resolvedTitle: string | null; titleSource: "FRONTMATTER" | "H1" | "FILENAME" | null;
  markdown: string | null; metadata: KnowledgeMetadata | null; revisionContentHash: string | null; reconciliationFingerprint: string | null;
  mimeType: string | null; assetContentHash: string | null; assetSize: number | null; assetLastModified: Date | null;
  diagnostics: ImportDiagnostic[]; previewChange: ImportPreviewChange | null;
};
export type FinalizedImportSnapshotEntry = ImportSnapshotEntry & { uploadStatus: "RECEIVED"; rawMarkdown: null };
export type MarkImportSnapshotReadyInput = {
  snapshotId: string; snapshotHash: string; planHash: string; summary: ImportDiffSummary; plan: FolderImportPlan;
  hasBlockers: boolean; finalizedAt: Date; expiresAt: Date;
};
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
export interface ImportCanonicalStateRepository { load(sourceId: string): Promise<CanonicalImportState>; }
```

- [ ] **Step 1: Write failing schema/repository integration tests**

Assert migrations 6/7 apply, required indexes/checks exist, invalid initial/resync binding is rejected, snapshot deletion cascades staging entries, and `AssetRepository.upsertByPath()` preserves current row identity.

- [ ] **Step 2: Verify failure**

```bash
npx vitest run --config vitest.integration.config.ts tests/integration/phase2-import-schema.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Add migration 006 and staging repositories**

Create `source_import_snapshots` and `source_import_snapshot_entries` with every field represented by the interfaces above. Use native UUIDs; binary collation for paths/hashes; JSON validity checks; FK snapshot->entry `ON DELETE CASCADE`; Source/Workspace/User FKs `RESTRICT`; state check BUILDING/READY/APPLIED/STALE; initial-vs-resync binding check.

Required indexes:

```text
idx_import_snapshots_creator_state(created_by,state)
idx_import_snapshots_source_created(source_id,created_at)
idx_import_snapshots_workspace_created(workspace_id,created_at)
idx_import_snapshots_state_expires(state,expires_at)
uq_import_entries_snapshot_upload(snapshot_id,upload_key)
uq_import_entries_snapshot_path_hash(snapshot_id,source_path_hash)
idx_import_entries_snapshot_upload(snapshot_id,upload_status)
```

`source_path_hash` is nullable. Finalizer will leave it NULL for invalid/colliding paths so blocker Preview can persist without violating the unique index.

Repository state transitions use conditional UPDATE by expected current state and verify affected row count. `ImportCanonicalStateRepository.load()` uses one SourceEntry+Document+current Revision+Tree query and one Asset query, not one query per document. It computes current reconciliation fingerprints in memory and reports duplicate current SourceEntry paths to the finalizer rather than choosing one.

- [ ] **Step 4: Add migration 007 and Asset current-projection repository methods**

Upgrade `KnowledgeAsset` to include `sourcePathHash` and `updatedAt`. Port methods are `insert`, `findById`, `listBySourceId`, `upsertByPath`, `deleteById`.

Before migration 007, `asset-projection-validation.ts` reads existing assets, normalizes each path with `normalizeImportPath()`, requires stored path already canonical, and rejects duplicate normalized path per Source. Then execute:

```sql
ALTER TABLE knowledge_assets ADD COLUMN source_path_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL;
ALTER TABLE knowledge_assets ADD COLUMN updated_at DATETIME(6) NULL;
UPDATE knowledge_assets SET source_path_hash = LOWER(SHA2(source_path,256)), updated_at = created_at WHERE source_path_hash IS NULL OR updated_at IS NULL;
ALTER TABLE knowledge_assets MODIFY source_path_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL;
ALTER TABLE knowledge_assets MODIFY updated_at DATETIME(6) NOT NULL;
ALTER TABLE knowledge_assets ADD CONSTRAINT uq_assets_source_path_hash UNIQUE (source_id,source_path_hash);
```

`upsertByPath()` uses the unique `(source_id,source_path_hash)` key, preserves existing row ID, and updates path/MIME/content/metadata/updated_at.

- [ ] **Step 5: Run integration/static checks**

```bash
npx vitest run --config vitest.integration.config.ts tests/integration/phase2-import-schema.test.ts
npm run test:integration
npm run typecheck
npm run lint
```

Expected: PASS.

- [ ] **Step 6: Commit**

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
export type CreateImportResult = { snapshotId: string; state: "BUILDING"; expiresAt: Date };
export type UploadImportResult = { accepted: number; idempotent: number; diagnostics: ImportDiagnostic[] };
export class CreateFolderImportService {
  createInitial(caller: CallerContext, input: { workspaceId: string; sourceName: string; rootName: string; manifest: ImportManifestEntry[] }): Promise<CreateImportResult>;
  createResync(caller: CallerContext, input: { sourceId: string; rootName: string; manifest: ImportManifestEntry[] }): Promise<CreateImportResult>;
}
export class UploadFolderImportEntriesService {
  upload(caller: CallerContext, input: { snapshotId: string; entries: { uploadKey: string; bytes: Uint8Array }[] }): Promise<UploadImportResult>;
}
```

- [ ] **Step 1: Write failing integration tests**

Cover: initial BUILDING/no Source; resync derives Workspace/version; HUB_MANAGED/ARCHIVED rejection; nonmember rejection; cross-user snapshot rejection; expired snapshot rejection; 4th active BUILDING and 11th active READY quota rejection while expired rows do not count; 20,001 manifest rejection; Markdown per-file/total limits; batch file/byte limits; identical-byte retry idempotency; different-byte conflict; invalid UTF-8 stored RECEIVED with BLOCKING diagnostic and no raw text.

- [ ] **Step 2: Verify failure**

```bash
npx vitest run --config vitest.integration.config.ts tests/integration/phase2-import-session.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement config and server-authoritative manifest classification**

`import-config.ts` reads nine positive integer `KM_IMPORT_*` overrides, falling back exactly to `DEFAULT_IMPORT_LIMITS`; add matching defaults to `.env.example`.

Client `kind` is only a hint. Server derives:

```ts
const entryType = /\.(?:md|markdown)$/iu.test(relativePath) ? "DOCUMENT" : "ASSET";
```

A `.md` sent as ASSET still becomes DOCUMENT/PENDING and requires raw upload. A non-Markdown sent as MARKDOWN becomes ASSET/RECEIVED and requires source-provided asset hash. Validate nonempty <=512 `sourceName/rootName`, unique uploadKey/raw path, manifest/path/file/total limits, and canonical manifest hash after sorting by `compareImportText(relativePath)` then uploadKey. Session expiry is now+2h. Quotas call `countActiveByCreatorAndState(...,now)`. `createResync()` accepts no Workspace/version input.

- [ ] **Step 4: Implement raw-byte upload**

Before mutation require creator equality, current Workspace membership, BUILDING, not expired, batch limits, matching DOCUMENT uploadKey. SHA-256 raw bytes. RECEIVED+same hash -> idempotent; RECEIVED+different hash -> `UPLOAD_ENTRY_CONFLICT`. Fatal UTF-8 decode success stores text; `INVALID_MARKDOWN_ENCODING` stores RECEIVED + hash + BLOCKING diagnostic + NULL raw text so Finalize can render blocker Preview.

- [ ] **Step 5: Run checks**

```bash
npx vitest run --config vitest.integration.config.ts tests/integration/phase2-import-session.test.ts
npm run test:integration
npm run typecheck
npm run lint
```

Expected: PASS.

- [ ] **Step 6: Commit**

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
  snapshotId: string; state: "READY" | "APPLIED" | "STALE"; expired: boolean;
  workspaceId: string; sourceId: string | null; proposedSourceName: string | null; basedOnVersion: number | null;
  expiresAt: Date; hasBlockers: boolean; summary: ImportDiffSummary; changes: ImportPreviewChange[];
};
export class FinalizeFolderImportService { finalize(caller: CallerContext, snapshotId: string): Promise<ImportPreview>; }
```

- [ ] **Step 1: Write failing finalize tests**

Cover: valid -> READY+plan/hashes/raw cleared; incomplete -> `UPLOAD_INCOMPLETE` and BUILDING; malformed frontmatter -> READY blocker; invalid UTF-8 -> READY blocker; title conflict warning only; normalized duplicate path -> READY `PATH_COLLISION`; ignored paths omitted; no empty dirs; existing Source preview emits move/update/archive/restore; READY finalize retry returns persisted Preview unchanged. Collision test must assert every colliding row has `source_path_hash IS NULL`.

- [ ] **Step 2: Verify failure**

```bash
npx vitest run --config vitest.integration.config.ts tests/integration/phase2-import-finalize.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement exact finalization pipeline**

Inside one short staging UoW:

```text
lock snapshot; verify creator/member/BUILDING/not-expired
load manifest rows; require every DOCUMENT RECEIVED
normalize paths and apply server ignore rules
build normalized-path groups before persisting hashes
for collision group size>1: attach PATH_COLLISION and keep hash NULL on all colliders
parse valid Markdown; convert parser/title errors to BLOCKING diagnostics
reject metadata >256 KiB as blocker
canonicalize Asset metadata
build ReadyImportContent from nonignored/nonblocking canonical entries
load canonical Source state once; if duplicate current paths -> CANONICAL_SOURCE_PATH_CONFLICT blocker
run pure reconciler
merge diagnostics/summary
persist finalized rows with rawMarkdown NULL
persist deterministic snapshotHash, planHash, plan
transition BUILDING->READY; expiresAt=finalizedAt+30m
```

Every list hashed/sorted uses `compareImportText`, never locale-dependent ordering. READY is immutable.

- [ ] **Step 4: Run checks**

```bash
npx vitest run --config vitest.integration.config.ts tests/integration/phase2-import-finalize.test.ts
npm run test:unit -- tests/unit/phase2-import-parser.test.ts tests/unit/phase2-reconciler.test.ts
npm run test:integration
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/sources/application/reconcile-import-snapshot.ts src/modules/sources/application/finalize-folder-import.ts tests/integration/phase2-import-finalize.test.ts
git commit -m "feat: finalize immutable import previews"
```

---

### Task 6: Atomic Apply, Stable IDs, Rollback, and Concurrency

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
export class ApplyFolderImportService { apply(caller: CallerContext, snapshotId: string): Promise<ApplyFolderImportResult>; }
export async function executeFolderImportPlan(
  repositories: SourceRepositories, caller: CallerContext, source: KnowledgeSource, plan: FolderImportPlan,
  options?: { failurePoint?: "folders" | "documents" | "revisions" | "assets" | "before-run" },
): Promise<void>;
```

- [ ] **Step 1: Write failing apply/rollback/stable-ID tests**

Cover: first Confirm creates Source/version1/one run; many-entry resync increments once; no-op increments once and no Revision; archive/restore same SourceEntry/Document/TreeNode IDs; filename-fallback rename same Document/new Revision title; asset same-path update keeps row ID; each injected failure point rolls canonical state/version back; initial failure no Source/no SyncRun; existing unexpected failure snapshot READY + separate FAILED run after rollback.

- [ ] **Step 2: Write failing concurrency tests**

Cover: two based-on-7 previews -> first to 8, second STALE+FAILED and no Knowledge mutation; parallel double Apply -> one actual mutation/run/version increment and one `alreadyApplied=true`; membership removal after Preview denies; HUB_MANAGED/ARCHIVED source denies.

- [ ] **Step 3: Verify failure**

```bash
npx vitest run --config vitest.integration.config.ts tests/integration/phase2-import-apply.test.ts tests/integration/phase2-import-concurrency.test.ts
```

Expected: FAIL.

- [ ] **Step 4: Add batch ordering projection and execute persisted plan**

Extend `SourceKnowledgeProjectionService`:

```ts
normalizeProjectedOrdering(caller: CallerContext, input: { nodeId: string; parentId: string | null; position: number }[]): Promise<void>;
```

It calls `requireBoundSource()` once, verifies every node belongs to bound Source and expected parent, and updates only differing positions.

Plan execution order is exact: restore folders top-down; create folders top-down; create docs; restore docs; move docs; create changed revisions; update SourceEntry locators/hashes; upsert assets; archive missing docs; remove stale assets; archive obsolete folders bottom-up; resolve plan-local node keys to TreeNode IDs and normalize final sibling positions. New UUIDs are generated only here; existing IDs from plan are reused. Canonical mutations continue through `bindSourceProjection()` and SourceEntry primitives.

- [ ] **Step 5: Implement Apply state/locking/version semantics**

Lock snapshot first; verify creator + current membership before interpreting state. Exact state handling:

```text
APPLIED -> idempotent APPLIED using persisted result IDs/version, runId=null
STALE -> IMPORT_SNAPSHOT_STALE
READY expired -> IMPORT_SNAPSHOT_EXPIRED
READY blockers -> IMPORT_SNAPSHOT_NOT_READY
BUILDING -> IMPORT_SNAPSHOT_NOT_READY
```

Existing Source: lock Source second; re-check ACTIVE + SOURCE_MANAGED/FOLDER_SYNC. Version mismatch commits STALE + FAILED SyncRun in same transaction and returns `VERSION_CONFLICT`; no Knowledge mutation. Version match calls `guardAndAdvanceVersion()` once, executes persisted plan, writes one APPLIED run, marks snapshot APPLIED. Any later unexpected failure rolls whole transaction back.

Initial: re-check Workspace; create FOLDER_SYNC/SOURCE_MANAGED Source version0; execute plan; advance 0->1 once; APPLIED run; mark snapshot APPLIED in same transaction. Initial failure leaves no Source/run.

Unexpected existing-source error is caught outside rolled-back UoW and may record one FAILED run in a separate UoW; snapshot remains READY. Test-only failure option is constructed only in tests, never composition/server.

- [ ] **Step 6: Run checks**

```bash
npx vitest run --config vitest.integration.config.ts tests/integration/phase2-import-apply.test.ts tests/integration/phase2-import-concurrency.test.ts
npm run test:integration
npm run test:unit
npm run typecheck
npm run lint
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/modules/sources/application/source-import-plan-executor.ts src/modules/sources/application/apply-folder-import.ts src/modules/sources/application/source-knowledge-projection-service.ts tests/integration/phase2-import-apply.test.ts tests/integration/phase2-import-concurrency.test.ts
git commit -m "feat: apply folder imports atomically"
```

---

### Task 7: Creator-Private Preview Reads and Staging Cleanup

**Files:**
- Create: `src/modules/sources/application/get-folder-import-preview.ts`
- Create: `src/modules/sources/application/cleanup-folder-imports.ts`
- Create: `scripts/db/cleanup-import-snapshots.ts`
- Test: `tests/integration/phase2-import-cleanup.test.ts`

**Interfaces:**

```ts
export class GetFolderImportPreviewService { get(caller: CallerContext, snapshotId: string): Promise<ImportPreview>; }
export class CleanupFolderImportsService { cleanup(input?: { now?: Date; batchSize?: number }): Promise<{ deleted: number }>; }
```

- [ ] **Step 1: Write failing access/cleanup tests**

Cover: creator+member can read READY/APPLIED/STALE; same-Workspace other user gets hidden not-found; creator after membership removal denied; `expired` is derived from `expiresAt<=now`; expired BUILDING/READY, STALE older24h, APPLIED older24h delete; fresh READY remains; entry cascade only; canonical counts unchanged.

- [ ] **Step 2: Verify failure**

```bash
npx vitest run --config vitest.integration.config.ts tests/integration/phase2-import-cleanup.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement Preview read service**

Load snapshot; missing/creator mismatch -> `IMPORT_SNAPSHOT_NOT_FOUND`; re-check Workspace membership; READY/APPLIED/STALE require persisted plan+summary; return `ImportPreview` with `expired: snapshot.expiresAt <= now`. Return plan preview changes only—never raw staging Markdown.

- [ ] **Step 4: Implement bounded conditional cleanup**

Candidate predicate is exactly BUILDING/READY expiry, STALE staleAt<=now-24h, APPLIED appliedAt<=now-24h. `deleteIfCleanupEligible()` repeats predicate in DELETE to avoid race. Service batch defaults 200 and clamps 1..500. Script opens pool/UoW, runs one batch, prints deleted count, closes pool.

- [ ] **Step 5: Run checks and commit**

```bash
npx vitest run --config vitest.integration.config.ts tests/integration/phase2-import-cleanup.test.ts
npm run test:integration
npm run typecheck
git add src/modules/sources/application/get-folder-import-preview.ts src/modules/sources/application/cleanup-folder-imports.ts scripts/db/cleanup-import-snapshots.ts tests/integration/phase2-import-cleanup.test.ts src/modules/sources/ports/import-snapshot-repository.ts src/infrastructure/database/mariadb/repositories/import-snapshots.ts
git commit -m "feat: add import preview reads and cleanup"
```

---

### Task 8: Trusted Server Adapter and Next.js APIs

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
export type InitialImportRequest = { sourceName: string; rootName: string; manifest: ImportManifestEntry[] };
export type ResyncRequest = { rootName: string; manifest: ImportManifestEntry[] };
export async function createInitialSourceImport(workspaceId: string, input: InitialImportRequest): Promise<CreateImportResult>;
export async function createSourceResync(sourceId: string, input: ResyncRequest): Promise<CreateImportResult>;
export async function uploadSourceImportEntries(snapshotId: string, entries: { uploadKey: string; bytes: Uint8Array }[]): Promise<UploadImportResult>;
export async function finalizeSourceImport(snapshotId: string): Promise<ImportPreview>;
export async function getSourceImportPreview(snapshotId: string): Promise<ImportPreview>;
export async function applySourceImport(snapshotId: string): Promise<ApplyFolderImportResult>;
```

- [ ] **Step 1: Write failing HTTP mapping tests**

Assert hidden access/not-found -> 404 `NOT_FOUND`; source version/stale/retryable ->409; limit/incomplete/invalid ->400; unknown ->500 `INTERNAL_ERROR` without internal message.

- [ ] **Step 2: Verify failure**

```bash
npm run test:unit -- tests/unit/phase2-import-http.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Wire composition and trusted identity server functions**

Instantiate all Phase 2 services from shared UoW/import limits. Every server function obtains current identity from `IdentityProvider`, converts with `callerFromIdentity`, then calls application service. No actor or workspace override fields exist in resync/upload/finalize/read/apply contracts.

- [ ] **Step 4: Implement routes**

Dynamic params use Next.js 15 Promise params. JSON create-session routes validate through application services. Upload route pre-checks declared `Content-Length <= maxUploadBatchBytes + 1 MiB` before `formData()`, then uses exact multipart mapping:

```text
entries = JSON [{"uploadKey":"f1","field":"file-0"}]
file-0 = File bytes
```

Reject invalid array, duplicate uploadKey/field, or missing File before application call. Do not invent a separate JSON-body byte limit; manifest count/path constraints remain authoritative for create-session JSON.

GET snapshot calls `GetFolderImportPreviewService`. Finalize and Apply accept empty POST body. Apply `VERSION_CONFLICT` -> HTTP 409 `SOURCE_VERSION_CONFLICT`; fresh/idempotent APPLIED ->200.

- [ ] **Step 5: Run checks and commit**

```bash
npm run test:unit -- tests/unit/phase2-import-http.test.ts
npm run test:unit
npm run test:integration
npm run typecheck
npm run lint
git add src/server src/app/api tests/unit/phase2-import-http.test.ts
git commit -m "feat: expose source import APIs"
```

---

### Task 9: Knowledge Browser Launcher and Preview UX

**Files:**
- Modify: `src/modules/knowledge/application/knowledge-query-service.ts`
- Modify: `src/app/knowledge/page.tsx`
- Create: `src/components/knowledge/source-import-launcher.tsx`
- Create: `src/components/knowledge/source-import-preview.tsx`
- Create: `src/components/knowledge/source-import-preview-actions.tsx`
- Create: `src/app/knowledge/imports/[snapshotId]/page.tsx`
- Modify: `src/server/source-imports.ts`

**Interfaces:**

```ts
export type SourceView = {
  id: string; workspaceId: string; name: string; sourceType: "FOLDER_SYNC" | "FILE_UPLOAD" | "HUB";
  ownership: "SOURCE_MANAGED" | "HUB_MANAGED"; status: "ACTIVE" | "ARCHIVED"; syncVersion: number;
};
type ImportUiState =
  | { kind: "IDLE" }
  | { kind: "PREPARING" }
  | { kind: "UPLOADING"; uploaded: number; total: number }
  | { kind: "FINALIZING" }
  | { kind: "ERROR"; code: string; message: string };
```

- [ ] **Step 1: Extend SourceView and verify existing browser tests**

`toSourceView()` includes sourceType/syncVersion. Run unit + `phase1-query.test.ts`; expected PASS.

- [ ] **Step 2: Implement client launcher**

Render Import for selected Workspace and Sync only for selected active SOURCE_MANAGED/FOLDER_SYNC Source. Set `webkitdirectory` on input. Sort files by raw comparator over `webkitRelativePath||name`; derive root folder; source name default root and editable only before session creation. Build client hint manifest. Hash every asset using `crypto.subtle.digest("SHA-256", await file.arrayBuffer())`. Create session; upload only `.md/.markdown` raw files in batches <=20 files and <=10 MiB using Task8 multipart; Finalize; route to Preview.

- [ ] **Step 3: Integrate into `/knowledge` and implement Preview**

Pass selected Workspace/Source to launcher without identity inputs. Preview page server-calls trusted `getSourceImportPreview()`. Display target, version, expiry, summary, warnings/blockers, changed entries; filters Changed/Added/Updated/Moved/Archived/Warnings/All; UNCHANGED only under All.

Apply disabled when blockers, `expired`, STALE, or APPLIED. 409 version conflict shows source-changed message and Choose folder again; never Force Apply. Success routes back to selected created/synced Source.

- [ ] **Step 4: Build/static checks**

```bash
npm run typecheck
npm run lint
npm run build
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/knowledge/application/knowledge-query-service.ts src/app/knowledge src/components/knowledge src/server/source-imports.ts
git commit -m "feat: add folder import preview workflow"
```

---

### Task 10: Fixtures, E2E Acceptance, Performance Smoke, and Docs

**Files:**
- Create fixtures under: `tests/fixtures/import/`
- Create: `tests/e2e/source-import.spec.ts`
- Modify: `tests/unit/phase2-reconciler.test.ts`
- Modify: `README.md`

- [ ] **Step 1: Add deterministic fixtures**

`basic-v1`: unchanged README, Architecture v1, Runbook, asset `diagram.txt`. `basic-v2`: same README; move Architecture to `platform/architecture.md` and change body to v2; remove Runbook; add `docs/new-guide.md`; change asset content. This yields UNCHANGED + MOVED/UPDATED + ARCHIVED + ADDED + asset UPDATED.

Malformed frontmatter fixture exactly:

```md
---
title: [broken
---
# Broken
```

Duplicate-content `a.md`/`b.md` have exactly identical body+metadata.

- [ ] **Step 2: Write Playwright flows**

Create four real acceptance flows:

```text
1. Query Master -> Import basic-v1 -> Preview -> Apply -> SOURCE_MANAGED source/tree visible
2. Import v1 -> Sync v2 -> Preview Moved/Updated/Archived/Added -> Apply -> tree reflects v2
3. malformed-frontmatter -> INVALID_FRONTMATTER visible -> Apply disabled
4. old Preview loses to second Preview -> old Apply shows stale; Force Apply absent
```

Use directory upload on webkitdirectory input. Helpers live in the same test file and use UI/API, not direct DB, except a narrowly scoped concurrent-version setup if UI duplication would obscure the behavior under test.

- [ ] **Step 3: Add 1,000-document reconciler smoke**

```ts
it("reconciles 1,000 documents with lookup-map matching", () => {
  const documents = Array.from({ length: 1000 }, (_, index) => snapshotDocument(`docs/${String(index).padStart(4, "0")}.md`, `fp-${index}`));
  const plan = reconcileFolderImport({ sourceBinding: binding, documents, assets: [] }, { documents: [], folders: [], assets: [] });
  expect(plan.documents.create).toHaveLength(1000);
  expect(plan.summary.documents.added).toBe(1000);
});
```

No millisecond threshold; Map-based matching/no nested full scans is the implementation constraint.

- [ ] **Step 4: Update README**

Document Import/Sync flow, source authority, warning/blocker behavior, metadata-only assets, `KM_IMPORT_*` overrides, and cleanup:

```bash
npx tsx scripts/db/cleanup-import-snapshots.ts
```

- [ ] **Step 5: Run final gate**

```bash
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run build
npm run test:e2e
```

Expected: every command exits 0. Do not claim Phase 2 complete if any command is skipped or failing.

- [ ] **Step 6: Commit**

```bash
git add tests/fixtures/import tests/e2e/source-import.spec.ts tests/unit/phase2-reconciler.test.ts README.md
git commit -m "test: cover phase 2 source import workflow"
```

---

## Final Implementation Review Checklist

- [ ] Initial Preview creates no Source; first successful Confirm creates Source and version 1 atomically.
- [ ] Existing resync receives only Source scope; Workspace/version are server-derived.
- [ ] Server, not client `kind`, is authoritative for Markdown-vs-Asset classification.
- [ ] Browser sends raw Markdown bytes; server performs fatal UTF-8 validation.
- [ ] YAML frontmatter becomes metadata and is absent from canonical `Revision.markdown`.
- [ ] H1 extraction uses Markdown AST, not regex.
- [ ] Generic adapter always emits `externalId: null`.
- [ ] Revision fingerprint includes title; reconciliation fingerprint excludes title.
- [ ] Reconciler matching order/ambiguity behavior matches spec exactly.
- [ ] Deterministic ordering uses raw comparator, not locale-dependent comparison.
- [ ] Folder rename is old Archived + new Added; no subtree inference exists.
- [ ] Asset projection has no lifecycle/revision/history and stores no binary.
- [ ] PATH_COLLISION remains representable as READY blocker because colliding staging rows keep path hash NULL.
- [ ] Finalize persists immutable READY snapshot + plan + hashes and clears raw staging Markdown.
- [ ] Apply executes persisted plan only and never reparses/reconciles.
- [ ] Snapshot lock precedes Source lock in every Apply path.
- [ ] Successful no-op sync advances version once and writes one APPLIED run with `changed=false`.
- [ ] Version conflict commits STALE + FAILED run and returns HTTP 409 without Knowledge mutation.
- [ ] Double Apply creates one real mutation/run/version advance and one idempotent success with `runId=null`.
- [ ] Unexpected existing-source failure rolls back canonical data and leaves snapshot retryable READY.
- [ ] Unexpected initial-import failure leaves no Source and no phantom SyncRun.
- [ ] Creator-private snapshot/current Workspace membership enforced on read/upload/finalize/apply.
- [ ] No Force Apply, actor override, Workspace transfer, filesystem include, outbound fetch, or shell/filesystem source-path execution exists.
- [ ] Cleanup only deletes staging rows; canonical history remains intact.
- [ ] Full lint/typecheck/unit/integration/build/E2E gate passes.
