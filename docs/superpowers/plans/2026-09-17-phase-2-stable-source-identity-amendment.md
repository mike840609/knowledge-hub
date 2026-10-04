# Phase 2 Stable Source Identity Amendment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Generic Markdown folder sources optionally provide a stable `knowledge_id` that maps to `SourceEntry.externalId`, survives rename/move plus content edits, and can be safely adopted by existing documents without creating synthetic revisions.

**Architecture:** Keep Hub `Document.id` as the canonical identity and treat Markdown `knowledge_id` as a source-scoped external identity hint. Parse and persist it in import staging, reconcile it with explicit `null -> externalId` adoption actions in a `phase2:v2` persisted plan, then apply adoption atomically with move/revision/locator updates. Files without `knowledge_id` keep the existing path + unique-fingerprint fallback.

**Tech Stack:** TypeScript 5.7, Next.js 15.5, React 19, MariaDB 10.11 native UUID, `yaml`, Vitest, real MariaDB integration tests, Playwright E2E.

**Spec:** `docs/superpowers/specs/2026-09-17-phase-2-stable-source-identity-amendment-design.md`

## Implementation status — 2026-09-17

Tasks 1–6 are implemented in the working tree. Task 7 verification is recorded in
[`2026-09-17-phase-2-stable-source-identity-verification.md`](../verification/2026-09-17-phase-2-stable-source-identity-verification.md).
The step checklists below preserve the original proposed procedure; their commit steps have not been executed.

- Staging uses migration 010 and persisted v2 versions/external identity.
- Markdown parsing, legacy comparison, reconciliation, explicit adoption, transactional Apply, and Preview detail are implemented.
- Lifecycle and rollback acceptance tests are consolidated in `phase2-import-apply.test.ts` instead of adding overlapping cases to finalize-edge tests.
- Incoming identity conflicts use per-document blocking diagnostics. Canonical duplicate identities remain a global integrity blocker.
- Main's existing PR #36 upload hydration test fix is included because this documentation branch predates it.

## Global Constraints

- Node engine remains `>=20.9.0 <25`; use npm and keep `package-lock.json` unchanged unless dependencies actually change. This amendment adds no npm dependency.
- MariaDB remains canonical storage. `source_entries.external_id` is the persisted source identity and remains scoped by `source_id`; comparison is case-sensitive.
- `knowledge_id` is optional, top-level, string-only, trimmed, non-empty, opaque, and reserved by the Generic Markdown adapter.
- Match the existing `source_entries.external_id VARCHAR(512) utf8mb4_bin` storage contract; reject values longer than 512 characters during parsing instead of relying on a later DB failure.
- `knowledge_id` is not revision content: exclude it from `Revision.metadata`, revision content hash, reconciliation fingerprint, title resolution, and revision-change decisions.
- Knowledge Hub consumes source identity but never generates or writes `knowledge_id` back to the source folder.
- Mixed identified/unidentified documents in one Source are valid.
- Only `externalId: null -> non-null` is a legal persisted identity mutation. Established IDs may not be silently removed or replaced when the predecessor is safely identified.
- READY snapshots and persisted plans are immutable. Apply never reparses source bytes or reruns reconciliation.
- `phase2:v1` persisted plans are intentionally unsupported by the new executor; users must create a fresh Preview.
- Whole-snapshot Apply remains transactional; identity conflict/blocker means no partial canonical success.
- Do not rewrite historical immutable revisions merely to remove legacy `knowledge_id` metadata.

---

## File Structure

The implementation should keep responsibilities split as follows:

```text
src/modules/sources/
├─ domain/
│  ├─ markdown-source-identity.ts          # reserved field extraction/validation + legacy strip helper
│  ├─ import-snapshot.ts                   # staging externalId + v1/v2 snapshot version types
│  ├─ import-plan.ts                       # phase2:v2 plan, adoptExternalId action, preview identity detail
│  ├─ import-errors.ts                     # INVALID_KNOWLEDGE_ID / IDENTITY_* error codes
│  ├─ import-integrity.ts                  # hash persisted staging externalId + new plan action/detail
│  └─ import-reconciler.ts                 # matching/adoption state machine + legacy revision comparison
├─ adapters/
│  └─ generic-markdown-folder-adapter.ts   # split reserved identity from revision metadata
└─ application/
   ├─ create-folder-import.ts              # create new phase2:v2 snapshots
   ├─ finalize-folder-import.ts            # persist parsed externalId and pass it to reconciliation
   ├─ source-entry-mapping-service.ts      # atomic null->externalId primitive
   └─ source-import-plan-executor.ts       # execute phase2:v2 adoption action

src/infrastructure/database/mariadb/
├─ migrations/
│  ├─ 010-phase-2-stable-source-identity.ts
│  └─ index.ts
└─ repositories/
   ├─ import-snapshot-entries.ts            # persist staging external_id
   └─ import-snapshots.ts                   # read actual adapter/plan version columns

src/components/imports/
└─ import-change-group.tsx                  # render identity adoption detail

tests/
├─ unit/
│  ├─ phase2-import-parser.test.ts
│  ├─ phase2-import-integrity.test.ts
│  └─ phase2-reconciler.test.ts
├─ integration/
│  ├─ phase2-import-schema.test.ts
│  ├─ phase2-import-session.test.ts
│  ├─ phase2-import-finalize.test.ts
│  ├─ phase2-import-finalize-edge.test.ts
│  └─ phase2-import-apply.test.ts
└─ e2e/
   └─ source-import.spec.ts
```

---

### Task 1: Version and persist source identity through import staging

**Files:**
- Create: `src/infrastructure/database/mariadb/migrations/010-phase-2-stable-source-identity.ts`
- Modify: `src/infrastructure/database/mariadb/migrations/index.ts`
- Modify: `src/modules/sources/domain/import-snapshot.ts`
- Modify: `src/modules/sources/application/create-folder-import.ts`
- Modify: `src/infrastructure/database/mariadb/repositories/import-snapshots.ts`
- Modify: `src/infrastructure/database/mariadb/repositories/import-snapshot-entries.ts`
- Test: `tests/integration/phase2-import-schema.test.ts`
- Test: `tests/integration/phase2-import-session.test.ts`

**Interfaces:**
- Consumes: existing `source_import_snapshots.adapter_version`, `source_import_snapshots.plan_version`, and `source_entries.external_id VARCHAR(512) utf8mb4_bin` storage conventions.
- Produces: `ImportSnapshotEntry.externalId: string | null`; new snapshots use `adapterVersion: "phase2:v2"` and `planVersion: "phase2:v2"`; old `(v1,v1)` snapshot rows remain readable for explicit rejection at Apply.

- [ ] **Step 1: Write schema/session tests that fail before migration 010 exists**

Add assertions equivalent to:

```ts
const columns = await pool.query<{ COLUMN_NAME: string; CHARACTER_MAXIMUM_LENGTH: number | null; COLLATION_NAME: string | null }[]>(
  `SELECT COLUMN_NAME, CHARACTER_MAXIMUM_LENGTH, COLLATION_NAME
   FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'source_import_snapshot_entries'
     AND COLUMN_NAME = 'external_id'`,
);
expect(columns).toEqual([
  expect.objectContaining({
    COLUMN_NAME: "external_id",
    CHARACTER_MAXIMUM_LENGTH: 512,
    COLLATION_NAME: "utf8mb4_bin",
  }),
]);
```

In the session test, assert a newly created snapshot reports:

```ts
expect(snapshot.adapterVersion).toBe("phase2:v2");
expect(snapshot.planVersion).toBe("phase2:v2");
```

- [ ] **Step 2: Run the focused integration tests and verify RED**

Run:

```bash
npm run test:integration -- tests/integration/phase2-import-schema.test.ts tests/integration/phase2-import-session.test.ts
```

Expected: FAIL because `external_id` is absent and new snapshots still use `phase2:v1`.

- [ ] **Step 3: Add migration 010**

Create:

```ts
import type { Migration } from "./types";

export const phase2StableSourceIdentityMigration: Migration = {
  version: 10,
  name: "phase-2-stable-source-identity",
  statements: [
    "ALTER TABLE source_import_snapshot_entries ADD COLUMN external_id VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL AFTER source_path_hash",
    "ALTER TABLE source_import_snapshots DROP CONSTRAINT ck_import_snapshots_adapter",
    `ALTER TABLE source_import_snapshots ADD CONSTRAINT ck_import_snapshots_adapter CHECK (
      (adapter_type = 'GENERIC_MARKDOWN_FOLDER' AND adapter_version = 'phase2:v1' AND plan_version = 'phase2:v1')
      OR
      (adapter_type = 'GENERIC_MARKDOWN_FOLDER' AND adapter_version = 'phase2:v2' AND plan_version = 'phase2:v2')
    )`,
  ],
};
```

Register it after migration 009 in `migrations/index.ts`.

- [ ] **Step 4: Extend snapshot domain types and DB mappers**

Change the relevant types to:

```ts
export type ImportAdapterVersion = "phase2:v1" | "phase2:v2";
export type ImportPlanVersion = "phase2:v1" | "phase2:v2";

export type ParsedMarkdownEntry = {
  sourcePath: string;
  externalId: string | null;
  // existing fields unchanged
};

export type ImportSnapshot = {
  // existing fields
  adapterVersion: ImportAdapterVersion;
  planVersion: ImportPlanVersion;
};

export type ImportSnapshotEntry = {
  // existing fields
  externalId: string | null;
};
```

In `import-snapshot-entries.ts`, add `external_id` to `INSERT_COLUMNS`, add one placeholder, map `row.external_id`, and include `entry.externalId` in `toRowArgs`.

In `import-snapshots.ts`, stop hardcoding v1 and map persisted values:

```ts
adapterVersion: String(row.adapter_version) as ImportSnapshot["adapterVersion"],
planVersion: String(row.plan_version) as ImportSnapshot["planVersion"],
```

- [ ] **Step 5: Create new snapshots as v2**

In `create-folder-import.ts` use:

```ts
adapterVersion: "phase2:v2",
planVersion: "phase2:v2",
```

Initialize every manifest/staging `ImportSnapshotEntry` with:

```ts
externalId: null,
```

- [ ] **Step 6: Run migration/schema/session tests and verify GREEN**

Run:

```bash
npm run test:integration -- tests/integration/phase2-import-schema.test.ts tests/integration/phase2-import-session.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

```bash
git add src/infrastructure/database/mariadb/migrations/010-phase-2-stable-source-identity.ts \
  src/infrastructure/database/mariadb/migrations/index.ts \
  src/modules/sources/domain/import-snapshot.ts \
  src/modules/sources/application/create-folder-import.ts \
  src/infrastructure/database/mariadb/repositories/import-snapshots.ts \
  src/infrastructure/database/mariadb/repositories/import-snapshot-entries.ts \
  tests/integration/phase2-import-schema.test.ts \
  tests/integration/phase2-import-session.test.ts
git commit -m "feat: version stable source identity staging"
```

---

### Task 2: Parse reserved `knowledge_id` without changing revision content

**Files:**
- Create: `src/modules/sources/domain/markdown-source-identity.ts`
- Modify: `src/modules/sources/domain/import-errors.ts`
- Modify: `src/modules/sources/adapters/generic-markdown-folder-adapter.ts`
- Modify: `src/modules/sources/application/finalize-folder-import.ts`
- Modify: `src/modules/sources/domain/import-integrity.ts`
- Test: `tests/unit/phase2-import-parser.test.ts`
- Test: `tests/unit/phase2-import-integrity.test.ts`
- Test: `tests/integration/phase2-import-finalize.test.ts`

**Interfaces:**
- Consumes: `KnowledgeMetadata`, `SourceImportError`, `ImportSnapshotEntry.externalId` from Task 1.
- Produces:
  - `splitMarkdownSourceIdentity(metadata): { externalId: string | null; metadata: KnowledgeMetadata }`
  - `stripLegacyMarkdownSourceIdentity(metadata): KnowledgeMetadata`
  - finalized staging rows whose `externalId` equals parsed `knowledge_id` and whose revision metadata does not contain the reserved key.

- [ ] **Step 1: Write parser tests for extraction, validation, and hash invariance**

Add tests equivalent to:

```ts
it("extracts knowledge_id as external identity and excludes it from revision metadata", () => {
  const text = "---\nknowledge_id: auth-001\ntitle: Auth\nowner: platform\n---\n# Auth\n";
  const result = parseGenericMarkdownText({ sourcePath: "auth.md", text, sourceFileHash: hash(text) });
  expect(result.externalId).toBe("auth-001");
  expect(result.metadata).toEqual({ owner: "platform", title: "Auth" });
});

it("does not change revision or reconciliation fingerprints when only knowledge_id is added", () => {
  const withoutId = parse("auth.md", "---\ntitle: Auth\n---\nbody\n");
  const withId = parse("auth.md", "---\nknowledge_id: auth-001\ntitle: Auth\n---\nbody\n");
  expect(withId.revisionContentHash).toBe(withoutId.revisionContentHash);
  expect(withId.reconciliationFingerprint).toBe(withoutId.reconciliationFingerprint);
});
```

Also cover trimmed strings and reject null, blank, number, array, object, and >512-character strings with `INVALID_KNOWLEDGE_ID`.

- [ ] **Step 2: Run parser tests and verify RED**

```bash
npm run test:unit -- tests/unit/phase2-import-parser.test.ts
```

Expected: FAIL because `externalId` is still always null and `knowledge_id` remains metadata.

- [ ] **Step 3: Add the reserved-field helper**

Create `markdown-source-identity.ts` with the concrete contract:

```ts
import type { KnowledgeMetadata } from "@/modules/knowledge/domain/content";
import { importError } from "./import-errors";

export const MARKDOWN_SOURCE_IDENTITY_FIELD = "knowledge_id";
export const MAX_SOURCE_EXTERNAL_ID_CHARS = 512;

export function splitMarkdownSourceIdentity(metadata: KnowledgeMetadata): {
  externalId: string | null;
  metadata: KnowledgeMetadata;
} {
  if (!Object.prototype.hasOwnProperty.call(metadata, MARKDOWN_SOURCE_IDENTITY_FIELD)) {
    return { externalId: null, metadata };
  }
  const raw = metadata[MARKDOWN_SOURCE_IDENTITY_FIELD];
  if (typeof raw !== "string") {
    throw importError("INVALID_KNOWLEDGE_ID", "knowledge_id must be a string.");
  }
  const externalId = raw.trim();
  if (externalId.length === 0 || Array.from(externalId).length > MAX_SOURCE_EXTERNAL_ID_CHARS) {
    throw importError("INVALID_KNOWLEDGE_ID", "knowledge_id must contain 1 to 512 characters after trimming.");
  }
  const { [MARKDOWN_SOURCE_IDENTITY_FIELD]: _ignored, ...contentMetadata } = metadata;
  return { externalId, metadata: contentMetadata };
}

export function stripLegacyMarkdownSourceIdentity(metadata: KnowledgeMetadata): KnowledgeMetadata {
  if (!Object.prototype.hasOwnProperty.call(metadata, MARKDOWN_SOURCE_IDENTITY_FIELD)) return metadata;
  const { [MARKDOWN_SOURCE_IDENTITY_FIELD]: _ignored, ...contentMetadata } = metadata;
  return contentMetadata;
}
```

Add `"INVALID_KNOWLEDGE_ID"` to `ImportErrorCode`.

- [ ] **Step 4: Use the helper before title/content fingerprinting**

In `parseGenericMarkdownText`, split identity immediately after frontmatter parsing:

```ts
const parsedFrontmatter = splitFrontmatter(input.text);
const identity = splitMarkdownSourceIdentity(parsedFrontmatter.metadata);
const metadata = identity.metadata;
```

Return:

```ts
externalId: identity.externalId,
```

All title resolution, revision hashing, and reconciliation fingerprinting must use the stripped `metadata`.

- [ ] **Step 5: Persist parsed identity during Finalize**

In `finalize-folder-import.ts`, when building the finalized row and `ReadyImportDocument`, propagate the parsed identity:

```ts
row = {
  ...row,
  externalId: parsed.externalId,
  // existing parsed fields
};

documents.push({
  sourcePath: parsed.sourcePath,
  uploadKey: entry.staged.uploadKey,
  externalId: parsed.externalId,
  // existing fields
});
```

Asset rows remain `externalId: null`.

- [ ] **Step 6: Make snapshot integrity include persisted external identity**

Replace the hardcoded slot in `hashableEntry`:

```ts
externalId: entry.externalId,
```

Add a unit test proving identical content with different external IDs produces different snapshot hashes while revision/reconciliation hashes remain equal.

- [ ] **Step 7: Add Finalize integration assertions**

Finalize a Markdown file containing `knowledge_id: auth-001`, then query staging and assert:

```ts
expect(row.external_id).toBe("auth-001");
expect(JSON.parse(String(row.metadata))).not.toHaveProperty("knowledge_id");
expect(snapshot.plan_version).toBe("phase2:v2");
```

Also finalize an invalid `knowledge_id` and assert Preview contains blocking `INVALID_KNOWLEDGE_ID` and Apply is unavailable.

- [ ] **Step 8: Run Task 2 tests and verify GREEN**

```bash
npm run test:unit -- tests/unit/phase2-import-parser.test.ts tests/unit/phase2-import-integrity.test.ts
npm run test:integration -- tests/integration/phase2-import-finalize.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit Task 2**

```bash
git add src/modules/sources/domain/markdown-source-identity.ts \
  src/modules/sources/domain/import-errors.ts \
  src/modules/sources/adapters/generic-markdown-folder-adapter.ts \
  src/modules/sources/application/finalize-folder-import.ts \
  src/modules/sources/domain/import-integrity.ts \
  tests/unit/phase2-import-parser.test.ts \
  tests/unit/phase2-import-integrity.test.ts \
  tests/integration/phase2-import-finalize.test.ts
git commit -m "feat: parse markdown stable source identity"
```

---

### Task 3: Add the phase2:v2 identity-adoption reconciliation model

**Files:**
- Modify: `src/modules/sources/domain/import-plan.ts`
- Modify: `src/modules/sources/domain/import-reconciler.ts`
- Modify: `src/modules/sources/domain/import-integrity.ts`
- Modify: `src/modules/sources/application/reconcile-import-snapshot.ts`
- Test: `tests/unit/phase2-reconciler.test.ts`
- Test: `tests/unit/phase2-import-integrity.test.ts`

**Interfaces:**
- Consumes: incoming `ReadyImportDocument.externalId`, canonical `CanonicalDocumentState.externalId`, and `stripLegacyMarkdownSourceIdentity` from Task 2.
- Produces:

```ts
export type ImportPreviewIdentityDetail = {
  adoptedExternalId: string;
};

export type AdoptExternalIdAction = {
  entryId: string;
  externalId: string;
};
```

`FolderImportPlan.planVersion` becomes `"phase2:v2"`, and `documents.adoptExternalId` is persisted and hashed.

- [ ] **Step 1: Write reconciler tests for every identity transition before implementation**

Add focused cases covering:

```ts
// exact-path adoption
expect(plan.documents.adoptExternalId).toEqual([
  { entryId: existing.entryId, externalId: "K1" },
]);
expect(change.identity).toEqual({ adoptedExternalId: "K1" });
expect(plan.documents.revise).toHaveLength(0);

// unique fingerprint adoption across rename
expect(plan.documents.move).toHaveLength(1);
expect(plan.documents.adoptExternalId).toEqual([
  { entryId: existing.entryId, externalId: "K1" },
]);

// new identified document, no predecessor
expect(plan.documents.create).toEqual([
  expect.objectContaining({ externalId: "K1" }),
]);
expect(plan.documents.adoptExternalId).toHaveLength(0);
```

Also cover:
- existing `K1` + incoming `K1` => normal match, no adoption action;
- existing `K1` + incoming `K2` => blocking `IDENTITY_CONFLICT`;
- existing `K1` + safely matched incoming missing ID => blocking `IDENTITY_CONFLICT`;
- duplicate incoming IDs => `IDENTITY_CONFLICT`;
- external-ID/path contradiction => `IDENTITY_CONFLICT`;
- new identified incoming + multiple predecessor fingerprint candidates => blocking `IDENTITY_ADOPTION_AMBIGUOUS`;
- two incoming identified claimants competing for one fingerprint predecessor => blocking ambiguity;
- unidentified ambiguity keeps existing WARNING + ADDED behavior;
- mixed identified/unidentified documents work in one plan.

- [ ] **Step 2: Write the legacy-revision compatibility test**

Use a canonical current revision whose metadata contains the pre-amendment key:

```ts
const existing = currentDocument("auth.md", "same", {
  currentRevision: {
    id: "revision:legacy",
    title: "Auth",
    markdown: "body\n",
    metadata: { knowledge_id: "K1", owner: "platform" },
    contentHash: "legacy-hash",
  },
});
const incoming = incomingDocument("auth.md", "same", {
  externalId: "K1",
  title: "Auth",
  markdown: "body\n",
  metadata: { owner: "platform" },
});
expect(reconcileFolderImport(snapshot([incoming]), canonical({ documents: [existing] })).documents.revise).toHaveLength(0);
```

- [ ] **Step 3: Run reconciler tests and verify RED**

```bash
npm run test:unit -- tests/unit/phase2-reconciler.test.ts
```

Expected: FAIL because the plan has no identity action/detail and the old matching logic does not enforce the new transition rules.

- [ ] **Step 4: Extend persisted plan/preview types**

In `import-plan.ts` use:

```ts
export type ImportPreviewIdentityDetail = {
  adoptedExternalId: string;
};

export type ImportPreviewChange = {
  kind: "DOCUMENT" | "FOLDER" | "ASSET";
  sourcePath: string;
  previousPath: string | null;
  labels: ImportPreviewLabel[];
  identity?: ImportPreviewIdentityDetail;
  diagnostics: ImportDiagnostic[];
};

export type AdoptExternalIdAction = {
  entryId: string;
  externalId: string;
};

export type FolderImportPlan = {
  planVersion: "phase2:v2";
  // ...
  documents: {
    // existing arrays
    adoptExternalId: AdoptExternalIdAction[];
  };
};
```

Initialize `adoptExternalId: []` in the empty/blocked plan constructors.

- [ ] **Step 5: Refactor matching into an explicit identity state machine**

Preserve the current strong-claim order, but when an incoming document has a non-null external ID not already bound canonically:

```text
same external ID exists -> match by external ID
else exact path exists   -> null => adopt; different non-null => conflict
else unique fingerprint  -> null => adopt; different non-null => conflict
else ambiguous fingerprint predecessor(s) -> blocking IDENTITY_ADOPTION_AMBIGUOUS
else no predecessor -> create new document with incoming externalId
```

For incoming `externalId === null`:

```text
exact-path/fingerprint predecessor with externalId === null -> existing fallback
safely matched predecessor with externalId !== null          -> blocking IDENTITY_CONFLICT
no predecessor                                                -> create unidentified document
```

Use per-document blocking diagnostics where `sourcePath` is known; reserve thrown/global `IDENTITY_CONFLICT` for duplicate canonical IDs or contradictions that cannot be represented safely as one incoming change.

- [ ] **Step 6: Emit adoption action and preview detail without changing summary counters**

When a matched predecessor has `externalId === null` and incoming has `K1`:

```ts
plan.documents.adoptExternalId.push({
  entryId: existing.entryId,
  externalId: incoming.externalId,
});
```

Set only the detail field:

```ts
identity: { adoptedExternalId: incoming.externalId },
```

Do not add a new `ImportPreviewLabel` or `ImportDiffSummary.documents` counter.

- [ ] **Step 7: Make revision comparison legacy-aware without rewriting history**

Before `isSameRevisionContent`, strip only the stored legacy reserved field:

```ts
const comparableExistingRevision = {
  ...existing.currentRevision,
  metadata: stripLegacyMarkdownSourceIdentity(existing.currentRevision.metadata),
};
const contentChanged = !isSameRevisionContent(comparableExistingRevision, {
  title: incoming.title,
  markdown: incoming.markdown,
  metadata: incoming.metadata,
});
```

Do not mutate the stored revision object.

- [ ] **Step 8: Hash the v2 action/detail deterministically**

Extend `canonicalPlan` in `import-integrity.ts`:

```ts
adoptExternalId: plan.documents.adoptExternalId.map((item) => ({ ...item })),
```

The existing canonical preview mapping should retain `identity` through object canonicalization; add a unit test proving changing only `adoptedExternalId` changes `planHash`.

- [ ] **Step 9: Run Task 3 tests and verify GREEN**

```bash
npm run test:unit -- tests/unit/phase2-reconciler.test.ts tests/unit/phase2-import-integrity.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 10: Commit Task 3**

```bash
git add src/modules/sources/domain/import-plan.ts \
  src/modules/sources/domain/import-reconciler.ts \
  src/modules/sources/domain/import-integrity.ts \
  src/modules/sources/application/reconcile-import-snapshot.ts \
  tests/unit/phase2-reconciler.test.ts \
  tests/unit/phase2-import-integrity.test.ts
git commit -m "feat: reconcile stable source identity adoption"
```

---

### Task 4: Apply identity adoption atomically and reject v1 plans

**Files:**
- Modify: `src/modules/sources/application/source-entry-mapping-service.ts`
- Modify: `src/modules/sources/application/source-import-plan-executor.ts`
- Test: `tests/integration/phase2-import-apply.test.ts`
- Test: `tests/unit/phase2-import-apply-perf.test.ts`

**Interfaces:**
- Consumes: `documents.adoptExternalId` from Task 3 and the transaction-bound `SourceRepositories` already owned by the executor.
- Produces:

```ts
export async function adoptSourceExternalId(
  repositories: SourceRepositories,
  caller: CallerContext,
  sourceId: string,
  entryId: string,
  externalId: string,
): Promise<SourceEntry>;
```

- [ ] **Step 1: Write Apply integration tests first**

Cover a plan that contains move + revise + adoption and assert after Apply:

```ts
expect(entry.documentId).toBe(originalDocumentId);
expect(entry.sourcePath).toBe("security/auth.md");
expect(entry.externalId).toBe("auth-001");
expect(currentRevision.title).toBe("Auth v2");
```

Add failure cases:
- target SourceEntry is no longer `externalId === null` => `IDENTITY_STATE_CHANGED`;
- another SourceEntry already owns the new ID => `IDENTITY_STATE_CHANGED` or `IDENTITY_CONFLICT` per implementation contract;
- any adoption failure rolls back move and revision;
- `planVersion: "phase2:v1"` => `IMPORT_PLAN_VERSION_UNSUPPORTED`.

- [ ] **Step 2: Run focused Apply tests and verify RED**

```bash
npm run test:integration -- tests/integration/phase2-import-apply.test.ts
```

Expected: FAIL because the executor only supports v1 and has no identity action.

- [ ] **Step 3: Add the transaction-bound adoption primitive**

Implement in `source-entry-mapping-service.ts`:

```ts
export async function adoptSourceExternalId(
  repositories: SourceRepositories,
  caller: CallerContext,
  sourceId: string,
  entryId: string,
  externalId: string,
): Promise<SourceEntry> {
  requireExternalId(externalId);
  const entry = requireBoundEntry(await repositories.entries.findById(entryId), sourceId);
  if (entry.entryType !== "DOCUMENT" || entry.externalId !== null) {
    throw importError("IDENTITY_STATE_CHANGED", "Source identity changed after Preview; create a fresh Preview.");
  }
  const conflicting = await repositories.entries.findByExternalId(sourceId, externalId);
  if (conflicting && conflicting.id !== entry.id) {
    throw importError("IDENTITY_STATE_CHANGED", "Source identity is now bound to another document; create a fresh Preview.");
  }
  const updated = {
    ...entry,
    externalId,
    updatedBy: caller.identity.id,
    lastSeenAt: new Date(),
  };
  await repositories.entries.update(updated);
  return updated;
}
```

If importing `importError` into this service creates an undesirable application/domain dependency, throw a focused `SourceEntryConflictError` here and translate it to `IDENTITY_STATE_CHANGED` in the executor. Keep the externally visible error code stable.

Add `"IDENTITY_STATE_CHANGED"` to `ImportErrorCode`.

- [ ] **Step 4: Upgrade the executor to phase2:v2 and execute adoption**

Change the guard to:

```ts
if (plan.planVersion !== "phase2:v2") {
  throw importError("IMPORT_PLAN_VERSION_UNSUPPORTED", "Unsupported import plan version; create a fresh Preview.");
}
```

After revisions and before locator updates, execute:

```ts
for (const action of plan.documents.adoptExternalId) {
  await adoptSourceExternalId(
    repositories,
    caller,
    source.id,
    action.entryId,
    action.externalId,
  );
}
```

Keep this inside the existing Apply unit of work so move/revise/adopt/updateLocator remain atomic.

- [ ] **Step 5: Update the executor performance fixture for the new plan shape**

Every synthetic `FolderImportPlan` in `phase2-import-apply-perf.test.ts` must use:

```ts
planVersion: "phase2:v2",
documents: {
  // existing arrays
  adoptExternalId: [],
},
```

The existing O(1) tree-read expectation must remain unchanged.

- [ ] **Step 6: Run Task 4 tests and verify GREEN**

```bash
npm run test:integration -- tests/integration/phase2-import-apply.test.ts
npm run test:unit -- tests/unit/phase2-import-apply-perf.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit Task 4**

```bash
git add src/modules/sources/application/source-entry-mapping-service.ts \
  src/modules/sources/application/source-import-plan-executor.ts \
  src/modules/sources/domain/import-errors.ts \
  tests/integration/phase2-import-apply.test.ts \
  tests/unit/phase2-import-apply-perf.test.ts
git commit -m "feat: apply source identity adoption atomically"
```

---

### Task 5: Prove end-to-end migration, conflict, mixed-mode, and legacy behavior

**Files:**
- Modify: `tests/integration/phase2-import-finalize-edge.test.ts`
- Modify: `tests/integration/phase2-import-apply.test.ts`
- Modify: `tests/e2e/source-import.spec.ts`
- Add fixtures only if the existing test helpers cannot express these cases cleanly: `tests/fixtures/import/stable-identity-v1/`, `tests/fixtures/import/stable-identity-v2/`

**Interfaces:**
- Consumes: all Task 1–4 behavior.
- Produces: regression evidence for all acceptance cases in the design spec.

- [ ] **Step 1: Add a resync fixture where identity is established before rename+edit**

Use this conceptual sequence:

```text
Run 1:
  docs/auth.md
  knowledge_id: auth-001
  body: v1

Run 2:
  security/login.md
  knowledge_id: auth-001
  body: v2
```

The E2E/integration assertion must prove the same `knowledge_documents.id` survives while Preview shows move/rename + update.

- [ ] **Step 2: Add first-time adoption coverage**

Seed an existing canonical document with `external_id = NULL`, then sync an otherwise identical file carrying `knowledge_id: auth-001`.

Assert:

```ts
expect(after.documentId).toBe(before.documentId);
expect(after.externalId).toBe("auth-001");
expect(revisionCountAfter).toBe(revisionCountBefore);
```

Repeat with a unique-fingerprint rename to prove move + adoption works without a revision when content is unchanged.

- [ ] **Step 3: Add legacy metadata compatibility coverage**

Seed a current immutable revision containing:

```json
{"knowledge_id":"auth-001","owner":"platform"}
```

Finalize/apply the same real content with `knowledge_id` now extracted from metadata. Assert no cleanup revision is created. Then change `owner` or Markdown and assert the next genuine revision contains no `knowledge_id` key.

- [ ] **Step 4: Add conflict and ambiguity coverage**

Cover at least:
- established `K1 -> K2` blocks;
- established `K1 -> missing` blocks when exact path identifies the predecessor;
- duplicate `knowledge_id` in one incoming folder blocks;
- ambiguous fingerprint adoption with incoming ID blocks instead of warning+ADDED;
- unidentified ambiguous files retain existing warning+ADDED behavior;
- fresh identified document with no predecessor is added normally;
- mixed source with identified and unidentified files applies successfully.

- [ ] **Step 5: Run the Phase 2 integration and E2E slices**

```bash
npm run test:integration -- tests/integration/phase2-import-finalize-edge.test.ts tests/integration/phase2-import-apply.test.ts
npm run test:e2e -- tests/e2e/source-import.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

```bash
git add tests/integration/phase2-import-finalize-edge.test.ts \
  tests/integration/phase2-import-apply.test.ts \
  tests/e2e/source-import.spec.ts \
  tests/fixtures/import/stable-identity-v1 \
  tests/fixtures/import/stable-identity-v2
git commit -m "test: cover stable source identity lifecycle"
```

If no new fixture directories are needed, omit them from `git add` rather than creating unused fixtures.

---

### Task 6: Surface identity adoption in Preview without changing diff counters

**Files:**
- Modify: `src/components/imports/import-change-group.tsx`
- Test: `tests/e2e/source-import.spec.ts`

**Interfaces:**
- Consumes: `ImportPreviewChange.identity?.adoptedExternalId` from Task 3.
- Produces: human-readable Preview text for bookkeeping identity adoption while preserving existing Added/Updated/Moved/etc. grouping and counters.

- [ ] **Step 1: Add an E2E assertion for the Preview text**

For the first-time adoption scenario, require visible text equivalent to:

```text
Identity adopted: auth-001
```

and continue to assert the normal change label (`UNCHANGED`, `MOVED`, `RENAMED`, or `UPDATED`) independently.

- [ ] **Step 2: Run the E2E test and verify RED**

```bash
npm run test:e2e -- tests/e2e/source-import.spec.ts
```

Expected: FAIL because the current change row renders only labels and diagnostics.

- [ ] **Step 3: Render the identity detail in the existing change row**

In `import-change-group.tsx`, directly below the main label row, add:

```tsx
{change.identity?.adoptedExternalId ? (
  <p className="mt-1 text-xs text-kh-text-muted">
    Identity adopted: <span className="font-mono">{change.identity.adoptedExternalId}</span>
  </p>
) : null}
```

Do not add a new group, badge label, summary counter, warning, or blocker for successful adoption.

- [ ] **Step 4: Run E2E and accessibility-sensitive regressions**

```bash
npm run test:e2e -- tests/e2e/source-import.spec.ts
npm run lint
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit Task 6**

```bash
git add src/components/imports/import-change-group.tsx tests/e2e/source-import.spec.ts
git commit -m "feat: show source identity adoption in preview"
```

---

### Task 7: Full regression and implementation evidence

**Files:**
- No production file should be added in this task unless a failing regression reveals a real defect in the feature.
- Modify test/docs only when required by a verified failure or to record final evidence.

**Interfaces:**
- Consumes: complete implementation from Tasks 1–6.
- Produces: verified branch ready for code review.

- [ ] **Step 1: Run unit tests**

```bash
npm run test:unit
```

Expected: PASS.

- [ ] **Step 2: Run real MariaDB integration tests**

```bash
npm run test:integration
```

Expected: PASS.

- [ ] **Step 3: Run E2E**

```bash
npm run test:e2e
```

Expected: PASS.

- [ ] **Step 4: Run static checks and build**

```bash
npm run lint
npm run typecheck
npm run build
```

Expected: all PASS.

- [ ] **Step 5: Verify acceptance invariants directly**

Confirm from automated assertions, not manual inference:

```text
fresh knowledge_id -> new Document + persisted externalId
null -> K1 exact-path adoption -> same Document, no synthetic revision
null -> K1 unique-fingerprint rename -> same Document + move/adoption
K1 -> K1 -> normal sync
K1 -> K2 -> blocked
K1 -> missing -> blocked when predecessor is safely known
duplicate incoming identity -> blocked
identity/path contradiction -> blocked
ambiguous identified adoption -> blocked
fresh identified file without predecessor -> added normally
no-ID files -> original fallback unchanged
legacy stored knowledge_id metadata -> no cleanup revision
real later edit -> new revision without knowledge_id
move + revise + adopt -> one atomic commit
apply-time identity drift -> full rollback
phase2:v1 plan -> unsupported; fresh Preview required
Preview shows adoption detail without changing diff counters
```

- [ ] **Step 6: Commit any final test/evidence-only fixes**

If no fixes were needed, do not create an empty commit. If fixes were needed:

```bash
git add <only-files-changed-by-verified-regression-fix>
git commit -m "test: finalize stable source identity verification"
```

---

## Self-Review Result

- **Spec coverage:** All design sections are mapped: reserved field contract (Task 2), mixed mode (Tasks 3/5), legacy immutable revision compatibility (Tasks 3/5), exact-path/fingerprint adoption (Task 3), new stable-ID document creation (Task 3), ambiguity/conflict blocking (Tasks 3/5), explicit persisted adoption action (Task 3), Preview detail (Task 6), atomic Apply and defensive revalidation (Task 4), plan v2/v1 rejection (Tasks 1/4), full acceptance suite (Task 5/7).
- **Persistence gap closed:** `source_import_snapshot_entries.external_id` is deliberately added because READY Apply may not reparse source bytes; snapshot integrity hashes the persisted identity.
- **Version consistency:** new snapshots and plans use `(adapterVersion, planVersion) = (phase2:v2, phase2:v2)` while migration 010 keeps old `(v1,v1)` rows valid enough to load and reject safely.
- **Type consistency:** `ParsedMarkdownEntry.externalId`, `ImportSnapshotEntry.externalId`, `ReadyImportDocument.externalId`, `CanonicalDocumentState.externalId`, `AdoptExternalIdAction.externalId`, and `SourceEntry.externalId` all use `string | null` at boundaries where null is legal; the adoption action itself carries a non-null `string`.
- **No scope creep:** no source write-back, no sidecar manifest, no fuzzy similarity, no manual repair UI, no new summary counter, no binary changes, no new dependency.
