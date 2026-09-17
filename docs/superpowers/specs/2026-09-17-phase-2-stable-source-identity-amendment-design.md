# Knowledge Hub — Phase 2 Stable Source Identity Amendment

| Item | Value |
| --- | --- |
| Date | 2026-09-17 |
| Type | Phase 2 design amendment |
| Parent design | `docs/superpowers/specs/2026-09-12-phase-2-knowledge-source-import-sync-design.md` |
| Scope | Generic Markdown Folder stable source identity |
| Status | Implemented in working tree; see implementation plan and verification report |

## 1. Goal

Phase 2 already separates stable Hub `Document.id` from mutable source paths and already provides `SourceEntry.externalId` plus external-ID-first reconciliation. The remaining gap is that the Generic Markdown Folder adapter always emits `externalId = null`, so a source-owned document cannot retain identity across a simultaneous rename/move and content edit unless the source provides a stable identifier through another adapter.

This amendment adds an optional, source-provided Markdown identity convention:

```yaml
---
knowledge_id: auth-001
title: Authentication
owner: platform
---
```

For Generic Markdown only, top-level `knowledge_id` maps to `SourceEntry.externalId`. Knowledge Hub consumes this value but never generates it and never writes it back into the source folder.

The design remains source-agnostic at the Hub boundary: other adapters may map their own native stable identifiers to the same `externalId` contract without using `knowledge_id`.

## 2. Non-goals

This amendment does not:

- require every Markdown file to contain `knowledge_id`;
- require every source type to use the same field name;
- generate or write stable IDs into source files;
- add a sidecar manifest format;
- add fuzzy similarity matching;
- add manual identity-repair UI;
- change Hub `Document.id` semantics;
- change SOURCE_MANAGED ownership or make folder sync bidirectional;
- rewrite historical immutable revisions.

## 3. Identity Contract

### 3.1 Reserved Markdown field

For the Generic Markdown Folder adapter, `knowledge_id` is a reserved top-level frontmatter field.

Accepted values:

- YAML string only;
- leading and trailing whitespace are trimmed before use;
- the trimmed result must contain 1–512 Unicode characters, matching the persisted VARCHAR(512) contract;
- value is otherwise opaque;
- comparison is case-sensitive;
- uniqueness is scoped to one `KnowledgeSource`.

Examples:

```yaml
knowledge_id: auth-001
```

```yaml
knowledge_id: "019c7c8e-7c8d-7abc-9def-0123456789ab"
```

The Hub does not require UUID, UUIDv7, numeric, or any other source-specific format.

Invalid examples include null, empty/whitespace-only strings, numbers, arrays, and objects. Invalid values block Preview with `INVALID_KNOWLEDGE_ID`.

### 3.2 Identity is not revision content

`knowledge_id` is identity metadata, not knowledge content. The Generic Markdown adapter must remove it from revision metadata before revision normalization and fingerprinting.

Therefore `knowledge_id` must not affect:

- `Revision.metadata`;
- revision content hash;
- reconciliation fingerprint;
- title resolution;
- whether a new Revision is created.

Conceptually:

```text
frontmatter.knowledge_id  -> SourceEntry.externalId
remaining frontmatter     -> Revision.metadata
```

Adding a `knowledge_id` to an otherwise unchanged file must not create a Revision.

### 3.3 Mixed sources are valid

A single source may contain both identified and unidentified documents:

```text
folder/
  a.md   knowledge_id=A
  b.md   no knowledge_id
  c.md   knowledge_id=C
```

Documents with stable IDs use external-identity matching. Documents without them continue to use the existing exact-path then reconciliation-fingerprint fallback.

## 4. Legacy Revision Compatibility

Before this amendment, a Markdown frontmatter field named `knowledge_id` was ordinary revision metadata. Existing immutable revisions may therefore contain it.

The amendment must not rewrite historical revisions and must not create a synthetic cleanup Revision only to remove the newly reserved key.

When comparing incoming content against a pre-amendment current Revision, revision comparison must ignore the top-level legacy `knowledge_id` key on the stored side. All other metadata remains significant.

Example:

```text
stored metadata   = { knowledge_id: "auth-001", owner: "platform" }
incoming metadata = { owner: "platform" }

=> content unchanged
=> no cleanup Revision
```

When a later real content change creates a new Revision, that new Revision is written without `knowledge_id`.

## 5. Reconciliation Model

### 5.1 Matching priority

The existing priority remains conceptually correct:

1. stable external identity;
2. exact source path;
3. unique reconciliation fingerprint;
4. otherwise no predecessor match.

This amendment adds explicit identity-adoption semantics when an incoming document has `knowledge_id` but the matched existing SourceEntry has `externalId = null`.

### 5.2 Existing and incoming identity states

For a known predecessor:

| Existing `externalId` | Incoming `knowledge_id` | Result |
| --- | --- | --- |
| `null` | `null` | Existing path/fingerprint behavior |
| `null` | `K1` | Eligible for explicit identity adoption |
| `K1` | `K1` | Same stable identity; normal sync |
| `K1` | `null` | Blocking `IDENTITY_CONFLICT` when the predecessor can be identified |
| `K1` | `K2` | Blocking `IDENTITY_CONFLICT` |

Only `null -> non-null` is a legal persisted identity mutation.

### 5.3 New identified documents remain valid

An incoming `knowledge_id` that does not already exist in canonical state does not automatically imply adoption.

The reconciler evaluates predecessor candidates in this order:

1. If exact path resolves to an existing entry, evaluate identity compatibility and adopt if its `externalId` is null.
2. Otherwise, if reconciliation fingerprint has exactly one unmatched canonical candidate and exactly one incoming claimant, evaluate identity compatibility and adopt if its `externalId` is null.
3. If there are multiple plausible predecessor candidates, block with `IDENTITY_ADOPTION_AMBIGUOUS`.
4. If there is no plausible predecessor candidate, the file is a legitimate new document and is created with its incoming `knowledge_id`.

This distinction is required so a brand-new stable-ID document is not rejected merely because it has no predecessor.

### 5.4 Adoption by exact path

Example:

```text
canonical:
  docs/auth.md
  documentId = D1
  externalId = null

incoming:
  docs/auth.md
  knowledge_id = auth-001
```

Result:

```text
same Document D1
+ ADOPT_EXTERNAL_ID(auth-001)
```

Adding the identity alone does not create a Revision.

### 5.5 Adoption by unique fingerprint

Adoption may also occur across rename/move when the existing Phase 2 fingerprint rule is unambiguous on both sides.

```text
canonical:
  docs/auth.md
  externalId = null
  fingerprint = F1

incoming:
  security/login.md
  knowledge_id = auth-001
  fingerprint = F1
```

If F1 identifies exactly one unmatched canonical predecessor and exactly one unmatched incoming claimant, result is:

```text
same Document
+ MOVED / RENAMED as applicable
+ ADOPT_EXTERNAL_ID(auth-001)
```

If content also changed, fingerprint adoption is no longer possible; without a previously bound external ID, the Hub cannot safely prove predecessor identity from path/content alone. This amendment does not add fuzzy inference.

### 5.6 Ambiguous adoption is blocking

If an incoming document has a new `knowledge_id` and multiple canonical entries could be its predecessor, the Hub must not guess and must not silently create a new identity.

Result:

```text
IDENTITY_ADOPTION_AMBIGUOUS
```

This is stricter than the existing no-ID ambiguity behavior. For unidentified documents, existing behavior may remain warning + new document. For an explicit incoming stable identity, ambiguous predecessor adoption is blocking because silently creating another logical document would make later repair harder.

### 5.7 Identity/path contradiction

Existing contradiction protection remains mandatory. If stable external identity and exact path resolve to different canonical entries, reconciliation blocks with `IDENTITY_CONFLICT`.

Duplicate non-null identities within one source, whether canonical or incoming, also block with `IDENTITY_CONFLICT`.

### 5.8 Removing or changing an established identity

When an incoming document can be matched to an existing SourceEntry whose `externalId` is already non-null:

- same ID: allowed;
- missing ID: blocking `IDENTITY_CONFLICT`;
- different ID: blocking `IDENTITY_CONFLICT`.

The Hub must never silently downgrade a known stable identity back to path/fingerprint-only identity.

There is an unavoidable filesystem limitation: if a previously identified source document simultaneously loses its ID, moves to an unrelated path, and changes content such that no safe predecessor match remains, the Hub cannot prove that the new unidentified file is that predecessor rather than a deletion plus a new file. In that case normal snapshot semantics apply: the old identified document may archive and the new unidentified file may be treated as new. This amendment must not claim stronger identity guarantees than the source data can support.

## 6. Explicit Identity Action

Identity adoption is a first-class mutation, not a side effect of locator update.

`FolderImportPlan` is upgraded to `phase2:v2` and gains an explicit document action conceptually equivalent to:

```ts
type AdoptExternalIdAction = {
  entryId: string;
  externalId: string;
};
```

The document plan contains a collection such as:

```text
documents.adoptExternalId[]
```

Responsibilities remain separated:

```text
move               -> Tree/location change
revise              -> immutable content revision
updateLocator       -> sourcePath/contentHash locator state
adoptExternalId     -> source identity mapping
```

Identity adoption must not be hidden inside `updateLocator`.

## 7. Preview Semantics

Preview must expose stable-identity behavior without inflating ordinary document change counters.

For a successful adoption, document details may show:

```text
Identity adopted: auth-001
Changes: Moved, Updated
```

`IDENTITY_ADOPTED` may be represented as dedicated detail/metadata rather than counted as another document content change.

Blocking diagnostics:

- `INVALID_KNOWLEDGE_ID` — reserved field exists but is not a valid non-empty string;
- `IDENTITY_CONFLICT` — duplicate ID, established ID removed/changed, or path/identity contradiction;
- `IDENTITY_ADOPTION_AMBIGUOUS` — a new stable ID cannot be safely attached because multiple predecessor candidates exist.

The existing Phase 2 whole-snapshot rule remains: any blocking identity diagnostic prevents Apply for the entire source snapshot. No partial success is introduced.

## 8. Apply and Transaction Semantics

Identity adoption executes inside the existing transactional whole-snapshot Apply.

A representative order is:

1. folder create/restore;
2. document create/restore/move;
3. revision creation;
4. external-ID adoption;
5. locator updates;
6. archive/assets;
7. ordering/invariant checks;
8. commit.

The exact internal order may vary where existing invariants require it, but move, revision, locator update, and identity adoption for one Apply must commit atomically.

Example:

```text
path:       docs/auth.md -> security/auth.md
content:    v1 -> v2
externalId: null -> auth-001
```

Either all intended changes commit or all roll back.

### 8.1 Apply-time defensive validation

Before applying `null -> K1`, executor must revalidate at minimum:

- target SourceEntry still exists;
- target belongs to the bound Source;
- target is a document entry;
- target `externalId` is still null;
- `K1` is not already bound to a different entry in that Source.

If the state changed after Preview, Apply fails and rolls back with a stale/identity-state error such as `IDENTITY_STATE_CHANGED`, requiring a fresh Preview.

Existing source version / snapshot binding guards remain authoritative and should be reused rather than bypassed.

## 9. Plan Versioning

Persisted import plans move from:

```text
phase2:v1
```

to:

```text
phase2:v2
```

Old v1 plans are intentionally not Apply-compatible after deployment. Attempting to Apply one returns the existing unsupported/stale-plan class of error and the caller must rescan and create a new Preview.

No dual v1/v2 executor compatibility is required.

## 10. Security and Ownership Boundaries

This amendment does not change authority rules:

- SOURCE_MANAGED content remains read-only in the Hub;
- Knowledge Hub never mutates the source Markdown folder;
- source-provided `knowledge_id` is an identity hint scoped by the owning `KnowledgeSource`, not a globally trusted authorization identifier;
- Workspace/Source policy continues to determine access;
- external identity never becomes an authorization proof.

## 11. Required Acceptance Cases

Implementation is complete only when automated tests cover at least:

1. new identified document creates a new Document and persists `externalId`;
2. `null -> K1` at exact path preserves existing Document ID and adopts identity;
3. `null -> K1` across rename/move with unique fingerprint preserves Document ID;
4. existing `K1` plus incoming `K1` syncs normally;
5. existing `K1` plus incoming `K2` blocks;
6. existing `K1` plus missing incoming ID blocks when the predecessor is safely matched;
7. duplicate incoming IDs block;
8. canonical duplicate non-null IDs block/integrity-fail;
9. identity/path contradiction blocks;
10. ambiguous stable-ID adoption blocks;
11. a truly new file with a fresh `knowledge_id` is created rather than blocked;
12. files without `knowledge_id` retain current path/fingerprint behavior;
13. adding only `knowledge_id` creates no Revision;
14. legacy current Revision metadata containing `knowledge_id` compares equal when all real content is unchanged;
15. a real later content change creates a new Revision without `knowledge_id` in metadata;
16. invalid `knowledge_id` types/values block Preview;
17. mixed identified/unidentified documents in one source work correctly;
18. move + revise + adopt is atomic;
19. apply-time identity state drift rolls back the entire Apply;
20. persisted `phase2:v1` plan cannot be applied after v2 deployment.

## 12. Completion Criteria

The amendment is complete when all of the following are true:

- Generic Markdown parses optional reserved `knowledge_id` into `externalId`;
- identity metadata is excluded from revision metadata and both content/reconciliation hashes;
- legacy revisions remain immutable and do not create synthetic cleanup revisions;
- safe `null -> externalId` adoption is explicit in the persisted plan;
- exact-path and unique-fingerprint adoption are supported;
- new stable-ID files are still creatable without a predecessor;
- established IDs cannot be silently removed or replaced when the predecessor is known;
- ambiguous adoption and identity conflicts block the whole snapshot;
- unidentified files remain backward compatible with Phase 2 behavior;
- Preview explains adoption/conflict state;
- Apply remains atomic;
- v1 persisted plans require a new Preview.

The key product guarantee is:

> When a source provides a stable `knowledge_id`, Knowledge Hub can preserve the same Hub Document identity across rename/move and simultaneous content edits once that stable identity has been established. During first-time adoption, exact-path or unique-fingerprint evidence is required to attach the new source identity to an existing Hub Document safely.
