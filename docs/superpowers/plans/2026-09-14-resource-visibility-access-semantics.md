# Resource Visibility & Access Semantics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve non-enumerating 404 behavior for unknown/foreign resources while returning an explicit access-denied state for resources the caller is already allowed to know exist.

**Architecture:** Keep the existing Workspace membership boundary unchanged. For Phase 2 import snapshots, use the trusted `created_by == caller.identity.id` check as discoverability proof; after that proof, translate a revoked Workspace membership into an import-specific access-denied error. HTTP maps that error to 403, the browser renders a dedicated access-denied state, and foreign/missing snapshots remain 404. General `discover`/`read` capabilities are documented for Phase 3 rather than implemented prematurely.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Vitest, MariaDB 10.11.

**Spec:** `docs/superpowers/specs/2026-09-14-resource-visibility-access-semantics-amendment.md`

## Global Constraints

- Do not expose foreign creator-private snapshots.
- Do not treat URL parameters, Workspace IDs, source IDs, org metadata, or owner metadata as authorization proof.
- Missing/undiscoverable resources remain `404 NOT_FOUND`.
- Known-but-forbidden import snapshots return `403 ACCESS_DENIED` at the API boundary.
- The browser must distinguish not-found, access-denied, and unexpected-error states.
- Do not introduce Phase 3 roles, Source overrides, Document ACLs, or a general discovery engine in this change.

---

### Task 1: Lock the HTTP contract with a failing unit test

**Files:**
- Modify: `tests/unit/phase2-import-http.test.ts`
- Modify later: `src/server/http-error-response.ts`

**Interfaces:**
- Consumes: `SourceImportError`, `WorkspaceAccessDeniedError`, `WorkspaceNotFoundError`.
- Produces: HTTP mapping for `IMPORT_SNAPSHOT_ACCESS_DENIED` → `403 ACCESS_DENIED` while existing hidden errors stay 404.

- [ ] **Step 1: Write the failing test**

Change the existing 404 test so `IMPORT_SNAPSHOT_NOT_FOUND`, `IMPORT_SOURCE_NOT_FOUND`, `WORKSPACE_ACCESS_DENIED`, and `WORKSPACE_NOT_FOUND` remain hidden 404 cases, and add:

```ts
it("maps a discoverable import snapshot denial to 403 ACCESS_DENIED", () => {
  const mapped = toImportErrorResponse(
    importError("IMPORT_SNAPSHOT_ACCESS_DENIED", "Import snapshot exists, but access is denied."),
  );
  expect(mapped.status).toBe(403);
  expect(mapped.body).toEqual({
    error: { code: "ACCESS_DENIED", message: expect.any(String) },
  });
});
```

- [ ] **Step 2: Run the unit gate and verify RED**

Run `npm run test:unit -- tests/unit/phase2-import-http.test.ts` or the repository's equivalent Vitest filter. Expected: the new test fails because `IMPORT_SNAPSHOT_ACCESS_DENIED` currently falls through to 400.

- [ ] **Step 3: Commit the RED test**

Commit only the test/docs state so CI evidence proves the behavior did not already exist.

---

### Task 2: Translate only known snapshot denials

**Files:**
- Create: `src/modules/sources/application/import-snapshot-access.ts`
- Modify: `src/modules/sources/application/get-folder-import-preview.ts`
- Modify: `src/modules/sources/application/upload-folder-import-entries.ts`
- Modify: `src/modules/sources/application/finalize-folder-import.ts`
- Modify: `src/modules/sources/application/apply-folder-import.ts`
- Modify: `tests/integration/phase2-import-cleanup.test.ts`

**Interfaces:**
- Consumes: `WorkspaceAccessPolicy.requireMembership(caller, workspaceId)` after `snapshot.createdBy` has already matched the caller.
- Produces: `requireKnownSnapshotWorkspaceAccess(...)` that converts only `WorkspaceAccessDeniedError` into `IMPORT_SNAPSHOT_ACCESS_DENIED`; all other errors are rethrown.

- [ ] **Step 1: Update the integration expectation first**

Change the creator-after-membership-removal case to expect:

```ts
{ code: "IMPORT_SNAPSHOT_ACCESS_DENIED" }
```

Keep the foreign-member and random-UUID tests expecting `IMPORT_SNAPSHOT_NOT_FOUND`.

- [ ] **Step 2: Verify the integration test is RED**

Expected: creator-after-revocation still throws `WORKSPACE_ACCESS_DENIED`.

- [ ] **Step 3: Add the minimal application helper**

```ts
export async function requireKnownSnapshotWorkspaceAccess(
  policy: WorkspaceAccessPolicy,
  caller: CallerContext,
  workspaceId: string,
): Promise<void> {
  try {
    await policy.requireMembership(caller, workspaceId);
  } catch (error) {
    if (error instanceof WorkspaceAccessDeniedError) {
      throw importError(
        "IMPORT_SNAPSHOT_ACCESS_DENIED",
        "Import snapshot exists, but you no longer have access to its Workspace.",
      );
    }
    throw error;
  }
}
```

Call it only after the existing `snapshot.createdBy === caller.identity.id` guard in preview/upload/finalize/apply.

- [ ] **Step 4: Verify integration GREEN**

The creator-revocation case passes; foreign and missing snapshot tests remain not-found.

---

### Task 3: Map the discoverable denial to HTTP 403

**Files:**
- Modify: `src/server/http-error-response.ts`
- Test: `tests/unit/phase2-import-http.test.ts`

**Interfaces:**
- Consumes: `IMPORT_SNAPSHOT_ACCESS_DENIED`.
- Produces: `{ status: 403, body: { error: { code: "ACCESS_DENIED", ... } } }`.

- [ ] **Step 1: Add a dedicated access-denied set/branch before generic 400 mapping**

Do not move `WORKSPACE_ACCESS_DENIED` out of the hidden 404 set; that generic error still lacks discoverability proof.

- [ ] **Step 2: Run unit tests and verify GREEN**

Confirm both 404 hidden cases and the new 403 known-resource case.

---

### Task 4: Render an explicit browser access-denied state

**Files:**
- Create: `src/components/errors/resource-access-denied.tsx`
- Modify: `src/app/w/[workspaceId]/sources/imports/[snapshotId]/page.tsx`
- Test: add or update the smallest existing route/helper test that exercises error-code classification.

**Interfaces:**
- Consumes: `IMPORT_SNAPSHOT_NOT_FOUND` and `IMPORT_SNAPSHOT_ACCESS_DENIED`.
- Produces: not-found for the former, explicit access-denied UI for the latter, rethrow for unexpected failures.

- [ ] **Step 1: Add a failing test for browser classification**

Assert `IMPORT_SNAPSHOT_NOT_FOUND` selects not-found semantics and `IMPORT_SNAPSHOT_ACCESS_DENIED` selects access-denied semantics rather than the generic error path.

- [ ] **Step 2: Implement the minimal UI branch**

The access-denied state must not render staged Markdown, document titles, diff details, or other protected snapshot contents. It may state that the import session exists but current access is insufficient and provide navigation back to Sources.

- [ ] **Step 3: Verify the focused test and build**

Unexpected errors must still propagate to the existing error boundary.

---

### Task 5: Align authoritative documentation

**Files:**
- Modify: `docs/superpowers/specs/2026-09-12-phase-2-knowledge-source-import-sync-design.md`
- Modify: `docs/superpowers/roadmaps/2026-09-10-knowledge-hub-phase-roadmap.md`
- Keep: `docs/superpowers/specs/2026-09-14-resource-visibility-access-semantics-amendment.md`

**Interfaces:**
- Produces: one consistent policy for Phase 2 and Phase 3.

- [ ] **Step 1: Amend Phase 2 §18.2 and §20.7**

Document creator-as-discoverability proof, foreign/missing 404, creator-with-revoked-membership 403, and add `IMPORT_SNAPSHOT_ACCESS_DENIED` to the shipped code list.

- [ ] **Step 2: Amend Phase 3 roadmap**

Add explicit `discover` vs `read` capability semantics and state that discoverable-but-unreadable resources may produce access-denied/request-access UX without leaking protected content.

---

### Task 6: Full verification and tracking

**Files:**
- Update Issue #9 item 8 or add a resolving comment after code is green.

- [ ] **Step 1: Run/observe the full repository gate**

Required: unit, integration, e2e, and build all pass on the PR head.

- [ ] **Step 2: Review the final diff for enumeration regressions**

Confirm no generic `WorkspaceAccessDeniedError` was globally changed to 403 without discoverability proof.

- [ ] **Step 3: Update Issue #9**

Record that item 8 is resolved by a policy change: not all authorization failures collapse to 404; only undiscoverable resources do. Known creator-private snapshots with revoked Workspace access are intentionally distinguishable as access denied.
