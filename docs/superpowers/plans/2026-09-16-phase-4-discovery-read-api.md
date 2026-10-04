# Phase 4 Discovery & Read API Implementation Plan

**English** | [繁體中文](2026-09-16-phase-4-discovery-read-api.zh-TW.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users search Knowledge they are authorized to read by keyword in the Web UI, including mixed Chinese/English content, without search results ever exposing unreadable content.

**Architecture:** No new schema, derived index, or external service. Search uses one SQL query: within Workspaces where the caller has `document.read`, substring-match each Document's **current revision** title and body using `COLLATE utf8mb4_unicode_ci LIKE`, sort by title match count and update time, and extract snippets with `LOCATE` / `SUBSTRING` in the same query. Bound the query with `max_statement_time=5`.

**Tech Stack:** TypeScript, Next.js 15 App Router (server components), MariaDB 10.11 (`mariadb` driver), vitest (unit/integration), Playwright (E2E), Tailwind. **No new npm packages.**

**Spec:** `docs/superpowers/specs/2026-09-16-phase-4-discovery-read-api-design.md`

Chinese text in code examples and quoted interface copy is preserved as literal test input or UI examples.

## Global Constraints

- **No new npm dependencies.** Build search entirely on the existing stack.
- **The database is MariaDB 10.11**, and the environment has **no full-text parser plugins** (no ngram or Mroonga), so do not use `FULLTEXT` / `MATCH ... AGAINST`.
- **Always match with `COLLATE utf8mb4_unicode_ci`; do not use `LOWER()`**: measured `LOWER()` performance is approximately 36% slower and cannot handle full-width characters.
- **Search only Workspaces where the caller has `document.read`.** Discover-only Workspaces must produce no hits, counts, or names.
- **The LIKE escape character is always `!`**; always write SQL as `LIKE ? ESCAPE '!'`.
- **Wrap every query in `SET STATEMENT max_statement_time=5 FOR ...`**; the timeout errno is `1969`.
- **Default visibility matches the Knowledge Tree**: `knowledge_tree_nodes`, `knowledge_documents`, and `knowledge_sources` must all be `ACTIVE`.
- **Search only the current revision** (`knowledge_documents.current_revision_id`); historical revisions never enter search.
- Fixed pagination: 20 rows per page, fetch 21 to determine whether another page exists, maximum `page` 50.
- Query limits: `q` 200 characters, 5 terms, 64 characters per term.
- Route and query-string IDs provide navigation scope; **they are never authorization proof**.

**Existing test-command constraints (copy directly; do not redesign):**

- Unit tests can target one file: `npx vitest run --config vitest.config.ts <file>`
- **Integration tests cannot target one file**: `scripts/test/integration.ts` hardcodes vitest arguments; run the whole suite with `npm run test:integration` (the script creates and cleans up its own isolated database).
- E2E can target one spec: `npm run test:e2e -- tests/e2e/phase4-search.spec.ts` (`scripts/test/e2e.ts:117` forwards arguments to Playwright). E2E first runs `seedDevelopmentDatabase()`, so fixtures added to `scripts/db/seed.ts` take effect.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/modules/knowledge/domain/search-query.ts` | Query parsing, LIKE escaping, and snippet highlight segmentation. Pure functions, no DB access. |
| `src/modules/knowledge/ports/knowledge-search-repository.ts` | Search port and row types. |
| `src/infrastructure/database/mariadb/repositories/knowledge-search.ts` | The single search SQL statement and timeout translation. |
| `src/modules/knowledge/application/knowledge-search-service.ts` | Compute authorized scope, paginate, and call the repository. |
| `src/server/search-read.ts` | Page read model; convert authorization failure to `notFound()`. |
| `src/app/w/[workspaceId]/search/page.tsx` | Search page (server component). |
| `src/components/search/search-form.tsx` | GET form. |
| `src/components/search/search-results.tsx` | Results list and empty state. |
| `src/components/search/search-result-row.tsx` | Single result row and `<mark>` highlighting. |

Changes to existing files: `src/modules/knowledge/domain/errors.ts`(add `SearchTimeoutError`)、`src/modules/knowledge/ports/unit-of-work.ts`(add `search` to `KnowledgeRepositories`)、`src/infrastructure/database/mariadb/repositories/index.ts`(wire up)、`src/server/composition.ts`(expose `search`)、`src/server/workspace-admin.ts`(add `canSearch` to `WorkspaceActions`)、`src/components/shell/primary-nav.tsx`(Search navigation)、`scripts/db/seed.ts`(mixed Chinese/English fixtures)。

---

### Task 1: Query Parsing, Escaping, and Highlighting (Pure Functions)

**Files:**
- Create: `src/modules/knowledge/domain/search-query.ts`
- Test: `tests/unit/phase4-search-query.test.ts`

**Interfaces:**
- Consumes: None (this task has no dependencies)
- Produces:
  - `SEARCH_MAX_QUERY_LENGTH = 200`、`SEARCH_MAX_TERMS = 5`、`SEARCH_MAX_TERM_LENGTH = 64`
  - `type ParsedSearchQuery = { terms: string[]; tooLong: boolean }`
  - `parseSearchQuery(raw: string): ParsedSearchQuery`
  - `toLikePattern(term: string): string`
  - `type SnippetSegment = { text: string; match: boolean }`
  - `highlightSnippet(snippet: string, terms: readonly string[]): SnippetSegment[]`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/phase4-search-query.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import {
  highlightSnippet,
  parseSearchQuery,
  toLikePattern,
  SEARCH_MAX_QUERY_LENGTH,
  SEARCH_MAX_TERMS,
  SEARCH_MAX_TERM_LENGTH,
} from "@/modules/knowledge/domain/search-query";

describe("parseSearchQuery", () => {
  it("splits on whitespace including the full-width space U+3000", () => {
    expect(parseSearchQuery("請假　流程 leave").terms).toEqual(["請假", "流程", "leave"]);
  });

  it("drops duplicate terms case-insensitively and keeps the first spelling", () => {
    expect(parseSearchQuery("SWFP swfp SWFP").terms).toEqual(["SWFP"]);
  });

  it("keeps at most SEARCH_MAX_TERMS terms", () => {
    const parsed = parseSearchQuery("a1 b2 c3 d4 e5 f6 g7");
    expect(parsed.terms).toHaveLength(SEARCH_MAX_TERMS);
    expect(parsed.terms).toEqual(["a1", "b2", "c3", "d4", "e5"]);
  });

  it("truncates a single term to SEARCH_MAX_TERM_LENGTH characters", () => {
    const long = "x".repeat(SEARCH_MAX_TERM_LENGTH + 10);
    expect(parseSearchQuery(long).terms[0]).toHaveLength(SEARCH_MAX_TERM_LENGTH);
  });

  it("reports an over-long query instead of parsing it", () => {
    const parsed = parseSearchQuery("y".repeat(SEARCH_MAX_QUERY_LENGTH + 1));
    expect(parsed).toEqual({ terms: [], tooLong: true });
  });

  it("returns no terms for empty or whitespace-only input", () => {
    expect(parseSearchQuery("")).toEqual({ terms: [], tooLong: false });
    expect(parseSearchQuery("   　  ")).toEqual({ terms: [], tooLong: false });
  });
});

describe("toLikePattern", () => {
  it("wraps the term in wildcards", () => {
    expect(toLikePattern("請假")).toBe("%請假%");
  });

  it("escapes the ESCAPE character itself, percent and underscore", () => {
    expect(toLikePattern("100%")).toBe("%100!%%");
    expect(toLikePattern("a_b")).toBe("%a!_b%");
    expect(toLikePattern("wow!")).toBe("%wow!!%");
    expect(toLikePattern("!%_")).toBe("%!!!%!_%");
  });
});

describe("highlightSnippet", () => {
  it("marks matches case-insensitively and keeps the original casing", () => {
    expect(highlightSnippet("SWFP leave policy", ["swfp"])).toEqual([
      { text: "SWFP", match: true },
      { text: " leave policy", match: false },
    ]);
  });

  it("marks every occurrence of every term", () => {
    expect(highlightSnippet("請假流程與請假表單", ["請假"])).toEqual([
      { text: "請假", match: true },
      { text: "流程與", match: false },
      { text: "請假", match: true },
      { text: "表單", match: false },
    ]);
  });

  it("returns the whole snippet unmarked when nothing matches", () => {
    expect(highlightSnippet("nothing here", ["absent"])).toEqual([{ text: "nothing here", match: false }]);
    expect(highlightSnippet("nothing here", [])).toEqual([{ text: "nothing here", match: false }]);
  });
});
```

- [ ] **Step 2: Run tests and confirm RED**

```bash
npx vitest run --config vitest.config.ts tests/unit/phase4-search-query.test.ts
```

Expected: FAIL, with an error such as `Failed to resolve import "@/modules/knowledge/domain/search-query"`。

- [ ] **Step 3: Implement**

Create `src/modules/knowledge/domain/search-query.ts`：

```ts
/**
 * Phase 4 spec §6.1 / §6.4: query parsing, LIKE escaping and snippet
 * highlighting are pure functions and never touch the database.
 */
export const SEARCH_MAX_QUERY_LENGTH = 200;
export const SEARCH_MAX_TERMS = 5;
export const SEARCH_MAX_TERM_LENGTH = 64;

export type ParsedSearchQuery = { terms: string[]; tooLong: boolean };

/** Terms are ANDed by the caller; JavaScript's `\s` already covers U+3000. */
export function parseSearchQuery(raw: string): ParsedSearchQuery {
  if (raw.length > SEARCH_MAX_QUERY_LENGTH) return { terms: [], tooLong: true };
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const piece of raw.split(/\s+/)) {
    if (piece === "") continue;
    const term = piece.slice(0, SEARCH_MAX_TERM_LENGTH);
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
    if (terms.length === SEARCH_MAX_TERMS) break;
  }
  return { terms, tooLong: false };
}

/**
 * `!` is the SQL ESCAPE character (spec §6.1), so a literal `!` must be
 * escaped too. A single pass over the character class keeps that ordering
 * correct — escaping `%`/`_` first would double-escape the markers.
 */
export function toLikePattern(term: string): string {
  return `%${term.replace(/[!%_]/g, (character) => `!${character}`)}%`;
}

export type SnippetSegment = { text: string; match: boolean };

/**
 * Case-insensitive highlight. Full-width forms are deliberately NOT folded
 * here: MariaDB's utf8mb4_unicode_ci matches them, JavaScript does not, so a
 * full-width hit can stay unmarked (spec §6.4 known limitation).
 */
export function highlightSnippet(snippet: string, terms: readonly string[]): SnippetSegment[] {
  const needles = terms.filter((term) => term.length > 0).map((term) => term.toLowerCase());
  if (needles.length === 0) return [{ text: snippet, match: false }];
  const haystack = snippet.toLowerCase();
  const segments: SnippetSegment[] = [];
  let index = 0;
  while (index < snippet.length) {
    let bestAt = -1;
    let bestLength = 0;
    for (const needle of needles) {
      const at = haystack.indexOf(needle, index);
      if (at === -1) continue;
      if (bestAt === -1 || at < bestAt || (at === bestAt && needle.length > bestLength)) {
        bestAt = at;
        bestLength = needle.length;
      }
    }
    if (bestAt === -1) {
      segments.push({ text: snippet.slice(index), match: false });
      break;
    }
    if (bestAt > index) segments.push({ text: snippet.slice(index, bestAt), match: false });
    segments.push({ text: snippet.slice(bestAt, bestAt + bestLength), match: true });
    index = bestAt + bestLength;
  }
  return segments.filter((segment) => segment.text.length > 0);
}
```

- [ ] **Step 4: Run tests and confirm PASS**

```bash
npx vitest run --config vitest.config.ts tests/unit/phase4-search-query.test.ts
```

Expected: PASS (all 15 assertions pass).

- [ ] **Step 5: Commit**

```bash
git add src/modules/knowledge/domain/search-query.ts tests/unit/phase4-search-query.test.ts
git commit -m "feat: add Phase 4 search query parsing and escaping" -m "Claude-Session: https://claude.ai/code/session_01DaDE1g3jt2U6eQ79yUoHjJ"
```

---

### Task 2: `canSearch` Capability Derivation and Discover/Read Tripwire

**Files:**
- Modify: `src/server/workspace-admin.ts:10-14`(`WorkspaceActions` type) and  `src/server/workspace-admin.ts:38-52`(`deriveWorkspaceActions`)
- Test: `tests/unit/phase4-search-capability.test.ts`

**Interfaces:**
- Consumes: None
- Produces: `WorkspaceActions.canSearch: boolean`, derived by `deriveWorkspaceActions` using `capabilities.has("document.read")`. Task 5 navigation and read model depend on this field.

- [ ] **Step 1: Write failing tests**

Create `tests/unit/phase4-search-capability.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { deriveWorkspaceActions } from "@/server/workspace-admin";
import type { Workspace } from "@/modules/workspaces/domain/workspace";
import {
  ROLE_WORKSPACE_CAPABILITIES,
  type WorkspaceCapability,
} from "@/modules/workspaces/domain/workspace-capability";

const team: Workspace = {
  id: "0199f400-0000-7000-8000-000000000001",
  name: "Team",
  createdAt: new Date("2026-09-16T00:00:00.000Z"),
  updatedAt: new Date("2026-09-16T00:00:00.000Z"),
  workspaceType: "TEAM",
  personalOwnerUserId: null,
  lifecycleState: "ACTIVE",
};

describe("canSearch derivation", () => {
  it("is true for a caller holding document.read", () => {
    const capabilities = new Set<WorkspaceCapability>(ROLE_WORKSPACE_CAPABILITIES.VIEWER);
    expect(deriveWorkspaceActions(team, capabilities).canSearch).toBe(true);
  });

  it("is false for a discover-only caller", () => {
    const capabilities = new Set<WorkspaceCapability>([
      "workspace.discover",
      "source.discover",
      "document.discover",
    ]);
    expect(deriveWorkspaceActions(team, capabilities).canSearch).toBe(false);
  });

  it("stays true on an archived Team, because archived Teams remain readable", () => {
    const archived: Workspace = { ...team, lifecycleState: "ARCHIVED" };
    const capabilities = new Set<WorkspaceCapability>(ROLE_WORKSPACE_CAPABILITIES.VIEWER);
    expect(deriveWorkspaceActions(archived, capabilities).canSearch).toBe(true);
  });
});

describe("discover-vs-read tripwire", () => {
  // Spec §5.3: every assignable role currently holds document.read, so the
  // "discover but not read" branch is unreachable and KnowledgeQueryService
  // may keep its discover-level checks. The moment a bundle can discover
  // without reading, this test fails and the reads MUST move to
  // requireWorkspaceRead in the same change.
  it("no role bundle can discover a document without being able to read it", () => {
    for (const [role, capabilities] of Object.entries(ROLE_WORKSPACE_CAPABILITIES)) {
      const held = new Set<string>(capabilities);
      if (held.has("document.discover")) {
        expect(`${role}:${held.has("document.read")}`).toBe(`${role}:true`);
      }
    }
  });
});
```

- [ ] **Step 2: Run tests and confirm RED**

```bash
npx vitest run --config vitest.config.ts tests/unit/phase4-search-capability.test.ts
```

Expected: FAIL; the first three tests fail because `canSearch` is `undefined` (`expected undefined to be true`); the tripwire test passes.

- [ ] **Step 3: Implement**

Add `canSearch` to `WorkspaceActions` in `src/server/workspace-admin.ts`:

```ts
export type WorkspaceActions = {
  canImport: boolean; canInspectSources: boolean; canOpenSettings: boolean; canRename: boolean;
  canArchive: boolean; canRestore: boolean; canManageBasicMembers: boolean; canManageAdminMembers: boolean;
  canManageOwners: boolean; canManageBasicGroups: boolean; canManageAdminGroups: boolean; canReadAudit: boolean;
  /** Phase 4: keyword search needs read, not manage; archived Teams stay searchable. */
  canSearch: boolean;
};
```

Add a line to the object returned by `deriveWorkspaceActions` (after `canInspectSources`):

```ts
    canSearch: has("document.read"),
```

- [ ] **Step 4: Run tests and typecheck; confirm PASS**

```bash
npx vitest run --config vitest.config.ts tests/unit/phase4-search-capability.test.ts
npm run typecheck
```

Expected: tests PASS; `typecheck` has no errors (`WorkspaceActions` is built by `deriveWorkspaceActions`; no other site needs the field added).

- [ ] **Step 5: Commit**

```bash
git add src/server/workspace-admin.ts tests/unit/phase4-search-capability.test.ts
git commit -m "feat: derive canSearch from document.read" -m "Claude-Session: https://claude.ai/code/session_01DaDE1g3jt2U6eQ79yUoHjJ"
```

---

### Task 3: Search Port, SQL Repository, and UnitOfWork Wiring

**Files:**
- Create: `src/modules/knowledge/ports/knowledge-search-repository.ts`
- Create: `src/infrastructure/database/mariadb/repositories/knowledge-search.ts`
- Modify: `src/modules/knowledge/domain/errors.ts`(add `SearchTimeoutError` at the end)
- Modify: `src/modules/knowledge/ports/unit-of-work.ts:12-30`(add `search` to `KnowledgeRepositories`)
- Modify: `src/infrastructure/database/mariadb/repositories/index.ts:23-53`(create and return `search`)
- Test: `tests/integration/phase4-search-repository.test.ts`

**Interfaces:**
- Consumes: Task 1 `toLikePattern`
- Produces:
  - `type KnowledgeSearchRow = { documentId: string; sourceId: string; workspaceId: string; title: string; sourceName: string; workspaceName: string; snippet: string; status: "ACTIVE" | "ARCHIVED"; updatedAt: Date }`
  - `type KnowledgeSearchCriteria = { terms: readonly string[]; workspaceIds: readonly string[]; sourceId: string | null; includeArchived: boolean; limit: number; offset: number }`
  - `interface KnowledgeSearchRepository { search(criteria: KnowledgeSearchCriteria): Promise<KnowledgeSearchRow[]> }`
  - `KnowledgeRepositories.search: KnowledgeSearchRepository`
  - `class SearchTimeoutError`（code `SEARCH_TIMEOUT`）

- [ ] **Step 1: Write failing tests**

Create `tests/integration/phase4-search-repository.test.ts`：

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { HubKnowledgeCommandServiceImpl } from "@/modules/knowledge/application/hub-knowledge-command-service";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import type { UserIdentity } from "@/modules/identity/domain/user-identity";
import type { KnowledgeSearchCriteria } from "@/modules/knowledge/ports/knowledge-search-repository";
import { createTeamWorkspaceInsert } from "@/modules/workspaces/domain/workspace";
import { createDirectMembership } from "@/modules/workspaces/domain/workspace-membership";
import { uuidv7 } from "@/shared/ids/uuidv7";

let pool: Pool;
beforeAll(() => { pool = createDatabasePool(databaseConfig("test")); });
afterAll(async () => { await pool.end(); });

const owner: UserIdentity = { id: "00000000-0000-0000-0000-000000000401", emp_id: "P4-OWNER", name: "Search Owner", org_code: "HRSD" };

/** One workspace + one HUB source the owner can write to. */
async function createScope(): Promise<{ workspaceId: string; sourceId: string }> {
  const unitOfWork = new MariaDbUnitOfWork(pool);
  const workspaceId = uuidv7();
  const sourceId = uuidv7();
  const now = new Date();
  await unitOfWork.run(async (repositories) => {
    await repositories.users.upsertIdentity(owner);
    await repositories.workspaces.insert(createTeamWorkspaceInsert({ id: workspaceId, name: `Search ${workspaceId}`, createdBy: owner.id, now }));
    await repositories.workspaceMemberships.insert(createDirectMembership({ workspaceId, userId: owner.id, role: "OWNER", createdBy: owner.id, now }));
    await repositories.sources.insert({
      id: sourceId, name: "Search Source", workspaceId, sourceType: "HUB", ownership: "HUB_MANAGED", status: "ACTIVE", syncVersion: 0,
      createdBy: owner.id, updatedBy: owner.id, archivedBy: null, archivedAt: null, createdAt: now, updatedAt: now,
    });
  });
  return { workspaceId, sourceId };
}

async function search(criteria: Partial<KnowledgeSearchCriteria> & { terms: string[]; workspaceIds: string[] }) {
  const unitOfWork = new MariaDbUnitOfWork(pool);
  return unitOfWork.run((repositories) => repositories.search.search({
    sourceId: null, includeArchived: false, limit: 21, offset: 0, ...criteria,
  }));
}

describe("Phase 4 search repository", () => {
  it("matches mixed Chinese/English content case- and width-insensitively", async () => {
    const { workspaceId, sourceId } = await createScope();
    const hub = new HubKnowledgeCommandServiceImpl(new MariaDbUnitOfWork(pool));
    await hub.createDocument(callerFromIdentity(owner), {
      sourceId, parentId: null, title: "請假流程 SWFP Leave Policy",
      markdown: "員工請假流程：主管簽核後生效。Employee leave requests need manager approval.", metadata: {},
    });

    expect((await search({ terms: ["請假"], workspaceIds: [workspaceId] })).map((row) => row.title)).toEqual(["請假流程 SWFP Leave Policy"]);
    expect(await search({ terms: ["swfp"], workspaceIds: [workspaceId] })).toHaveLength(1);
    expect(await search({ terms: ["ＳＷＦＰ"], workspaceIds: [workspaceId] })).toHaveLength(1);
    // Simplified input does not reach Traditional content; recorded as current behaviour.
    expect(await search({ terms: ["请假"], workspaceIds: [workspaceId] })).toHaveLength(0);
  });

  it("requires every term to match either the title or the body", async () => {
    const { workspaceId, sourceId } = await createScope();
    const hub = new HubKnowledgeCommandServiceImpl(new MariaDbUnitOfWork(pool));
    await hub.createDocument(callerFromIdentity(owner), {
      sourceId, parentId: null, title: "Runbook 值班手冊", markdown: "escalation 流程說明", metadata: {},
    });

    expect(await search({ terms: ["Runbook", "escalation"], workspaceIds: [workspaceId] })).toHaveLength(1);
    expect(await search({ terms: ["Runbook", "absent"], workspaceIds: [workspaceId] })).toHaveLength(0);
  });

  it("hides archived documents, sources and tree nodes unless includeArchived is set", async () => {
    const { workspaceId, sourceId } = await createScope();
    const hub = new HubKnowledgeCommandServiceImpl(new MariaDbUnitOfWork(pool));
    const created = await hub.createDocument(callerFromIdentity(owner), {
      sourceId, parentId: null, title: "Retired 停用筆記", markdown: "archivedneedle 內容", metadata: {},
    });
    await hub.archiveDocument(callerFromIdentity(owner), created.documentId);

    expect(await search({ terms: ["archivedneedle"], workspaceIds: [workspaceId] })).toHaveLength(0);
    expect(await search({ terms: ["archivedneedle"], workspaceIds: [workspaceId], includeArchived: true })).toHaveLength(1);
  });

  it("searches only the current revision", async () => {
    const { workspaceId, sourceId } = await createScope();
    const hub = new HubKnowledgeCommandServiceImpl(new MariaDbUnitOfWork(pool));
    const created = await hub.createDocument(callerFromIdentity(owner), {
      sourceId, parentId: null, title: "Architecture 架構", markdown: "firstrevisionneedle", metadata: {},
    });
    await hub.createRevision(callerFromIdentity(owner), {
      documentId: created.documentId, expectedCurrentRevisionId: created.revisionId,
      title: "Architecture 架構", markdown: "secondrevisionneedle", metadata: {},
    });

    expect(await search({ terms: ["firstrevisionneedle"], workspaceIds: [workspaceId] })).toHaveLength(0);
    expect(await search({ terms: ["secondrevisionneedle"], workspaceIds: [workspaceId] })).toHaveLength(1);
  });

  it("treats an out-of-scope source filter exactly like a missing one", async () => {
    const { workspaceId, sourceId } = await createScope();
    const hub = new HubKnowledgeCommandServiceImpl(new MariaDbUnitOfWork(pool));
    await hub.createDocument(callerFromIdentity(owner), {
      sourceId, parentId: null, title: "Scoped 範圍", markdown: "scopedneedle", metadata: {},
    });

    expect(await search({ terms: ["scopedneedle"], workspaceIds: [workspaceId], sourceId })).toHaveLength(1);
    expect(await search({ terms: ["scopedneedle"], workspaceIds: [workspaceId], sourceId: uuidv7() })).toHaveLength(0);
  });

  it("ranks title hits above body-only hits", async () => {
    const { workspaceId, sourceId } = await createScope();
    const hub = new HubKnowledgeCommandServiceImpl(new MariaDbUnitOfWork(pool));
    await hub.createDocument(callerFromIdentity(owner), {
      sourceId, parentId: null, title: "Body only", markdown: "rankneedle appears in the body", metadata: {},
    });
    await hub.createDocument(callerFromIdentity(owner), {
      sourceId, parentId: null, title: "rankneedle in the title", markdown: "unrelated body", metadata: {},
    });

    expect((await search({ terms: ["rankneedle"], workspaceIds: [workspaceId] })).map((row) => row.title))
      .toEqual(["rankneedle in the title", "Body only"]);
  });

  it("applies limit and offset for pagination", async () => {
    const { workspaceId, sourceId } = await createScope();
    const hub = new HubKnowledgeCommandServiceImpl(new MariaDbUnitOfWork(pool));
    for (const index of [1, 2, 3]) {
      await hub.createDocument(callerFromIdentity(owner), {
        sourceId, parentId: null, title: `Page ${index}`, markdown: "pageneedle", metadata: {},
      });
    }

    const firstTwo = await search({ terms: ["pageneedle"], workspaceIds: [workspaceId], limit: 2, offset: 0 });
    const rest = await search({ terms: ["pageneedle"], workspaceIds: [workspaceId], limit: 2, offset: 2 });
    expect(firstTwo).toHaveLength(2);
    expect(rest).toHaveLength(1);
    expect(firstTwo.map((row) => row.documentId)).not.toContain(rest[0].documentId);
  });

  it("treats wildcard characters in the query as literal text", async () => {
    const { workspaceId, sourceId } = await createScope();
    const hub = new HubKnowledgeCommandServiceImpl(new MariaDbUnitOfWork(pool));
    await hub.createDocument(callerFromIdentity(owner), {
      sourceId, parentId: null, title: "Discount 折扣", markdown: "the coupon gives 100% off", metadata: {},
    });
    await hub.createDocument(callerFromIdentity(owner), {
      sourceId, parentId: null, title: "Plain 普通", markdown: "the number is 1000 exactly", metadata: {},
    });

    expect((await search({ terms: ["100%"], workspaceIds: [workspaceId] })).map((row) => row.title)).toEqual(["Discount 折扣"]);
  });

  it("returns no rows and issues no query when there are no terms or no workspaces", async () => {
    const { workspaceId } = await createScope();
    expect(await search({ terms: [], workspaceIds: [workspaceId] })).toEqual([]);
    expect(await search({ terms: ["anything"], workspaceIds: [] })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run integration tests and confirm RED**

```bash
npm run test:integration
```

Expected: FAIL. The new file cannot load due to `Failed to resolve import "@/modules/knowledge/ports/knowledge-search-repository"`; existing integration tests still pass.

- [ ] **Step 3: Add port types**

Create `src/modules/knowledge/ports/knowledge-search-repository.ts`：

```ts
/** Phase 4 spec §6.2: one row per matching Document, already scoped by the caller's readable Workspaces. */
export type KnowledgeSearchRow = {
  documentId: string;
  sourceId: string;
  workspaceId: string;
  title: string;
  sourceName: string;
  workspaceName: string;
  snippet: string;
  status: "ACTIVE" | "ARCHIVED";
  updatedAt: Date;
};

export type KnowledgeSearchCriteria = {
  /** Already parsed and de-duplicated; every term must match (AND). */
  terms: readonly string[];
  /** Workspaces the caller may READ. An empty list must produce no rows. */
  workspaceIds: readonly string[];
  sourceId: string | null;
  includeArchived: boolean;
  limit: number;
  offset: number;
};

export interface KnowledgeSearchRepository {
  search(criteria: KnowledgeSearchCriteria): Promise<KnowledgeSearchRow[]>;
}
```

- [ ] **Step 4: Add timeout error type**

Add at the end of `src/modules/knowledge/domain/errors.ts`:

```ts
/**
 * Phase 4 spec §6.6: the search statement carries max_statement_time=5, so an
 * over-broad query is interrupted by the server (errno 1969) instead of
 * holding a connection. This is a user-correctable state, never a 500.
 */
export class SearchTimeoutError extends DomainError {
  constructor(message = "The search took too long; narrow the query and try again.") {
    super("SEARCH_TIMEOUT", message);
    this.name = "SearchTimeoutError";
  }
}
```

- [ ] **Step 5: Implement MariaDB repository**

Create `src/infrastructure/database/mariadb/repositories/knowledge-search.ts`：

```ts
import { SearchTimeoutError } from "@/modules/knowledge/domain/errors";
import { toLikePattern } from "@/modules/knowledge/domain/search-query";
import type {
  KnowledgeSearchCriteria,
  KnowledgeSearchRepository,
  KnowledgeSearchRow,
} from "@/modules/knowledge/ports/knowledge-search-repository";
import type { DbRow, QueryConnection } from "./shared";
import { asDate, asRequiredString } from "./shared";

/** MariaDB reports a max_statement_time interruption as errno 1969. */
const SEARCH_TIMEOUT_ERRNO = 1969;
const SEARCH_TIMEOUT_SECONDS = 5;
const SNIPPET_LENGTH = 160;
const SNIPPET_LEAD = 60;

function mapRow(row: DbRow): KnowledgeSearchRow {
  return {
    documentId: String(row.document_id),
    sourceId: String(row.source_id),
    workspaceId: String(row.workspace_id),
    title: asRequiredString(row.title, "search title"),
    sourceName: asRequiredString(row.source_name, "search source name"),
    workspaceName: asRequiredString(row.workspace_name, "search workspace name"),
    snippet: row.snippet === null || row.snippet === undefined ? "" : String(row.snippet),
    status: String(row.status) as "ACTIVE" | "ARCHIVED",
    updatedAt: asDate(row.updated_at),
  };
}

function isTimeout(error: unknown): boolean {
  return typeof error === "object" && error !== null && "errno" in error
    && Number((error as { errno: unknown }).errno) === SEARCH_TIMEOUT_ERRNO;
}

export class MariaDbKnowledgeSearchRepository implements KnowledgeSearchRepository {
  constructor(private readonly connection: QueryConnection) {}

  /**
   * Spec §6.2. One statement: the tree-node join reproduces the Knowledge
   * Tree's default visibility (uq_tree_one_document keeps it row-preserving),
   * and the snippet is computed in the same pass so no second query is needed.
   */
  async search(criteria: KnowledgeSearchCriteria): Promise<KnowledgeSearchRow[]> {
    if (criteria.terms.length === 0 || criteria.workspaceIds.length === 0) return [];
    const anchor = criteria.terms[0];
    const parameters: unknown[] = [anchor, anchor, SNIPPET_LEAD, SNIPPET_LENGTH, SNIPPET_LENGTH];
    const titleHits = criteria.terms
      .map(() => "(r.title COLLATE utf8mb4_unicode_ci LIKE ? ESCAPE '!')")
      .join(" + ");
    for (const term of criteria.terms) parameters.push(toLikePattern(term));
    parameters.push(...criteria.workspaceIds);
    parameters.push(criteria.includeArchived ? 1 : 0);
    parameters.push(criteria.sourceId === null ? 1 : 0, criteria.sourceId);
    const termClauses = criteria.terms.map(
      () => "(r.title COLLATE utf8mb4_unicode_ci LIKE ? ESCAPE '!' OR r.markdown COLLATE utf8mb4_unicode_ci LIKE ? ESCAPE '!')",
    );
    for (const term of criteria.terms) {
      const pattern = toLikePattern(term);
      parameters.push(pattern, pattern);
    }
    parameters.push(criteria.limit, criteria.offset);
    const sql = `SET STATEMENT max_statement_time=${SEARCH_TIMEOUT_SECONDS} FOR
      SELECT d.id AS document_id, d.source_id AS source_id, s.workspace_id AS workspace_id, r.title AS title,
             s.name AS source_name, w.name AS workspace_name, d.status AS status, d.updated_at AS updated_at,
             CASE WHEN LOCATE(?, r.markdown COLLATE utf8mb4_unicode_ci) > 0
                  THEN SUBSTRING(r.markdown, GREATEST(LOCATE(?, r.markdown COLLATE utf8mb4_unicode_ci) - ?, 1), ?)
                  ELSE SUBSTRING(r.markdown, 1, ?) END AS snippet,
             (${titleHits}) AS title_hits
      FROM knowledge_documents d
      JOIN knowledge_revisions r ON r.id = d.current_revision_id
      JOIN knowledge_tree_nodes n ON n.document_id = d.id
      JOIN knowledge_sources s ON s.id = d.source_id
      JOIN workspaces w ON w.id = s.workspace_id
      WHERE s.workspace_id IN (${criteria.workspaceIds.map(() => "?").join(", ")})
        AND (? = 1 OR (d.status = 'ACTIVE' AND s.status = 'ACTIVE' AND n.status = 'ACTIVE'))
        AND (? = 1 OR d.source_id = ?)
        AND ${termClauses.join(" AND ")}
      ORDER BY title_hits DESC, d.updated_at DESC, d.id ASC
      LIMIT ? OFFSET ?`;
    try {
      const rows = await this.connection.query<DbRow[]>(sql, parameters);
      return rows.map(mapRow);
    } catch (error) {
      if (isTimeout(error)) throw new SearchTimeoutError();
      throw error;
    }
  }
}
```

- [ ] **Step 6: Wire up UnitOfWork**

Add to the imports in `src/modules/knowledge/ports/unit-of-work.ts`:

```ts
import type { KnowledgeSearchRepository } from "./knowledge-search-repository";
```

Add to `KnowledgeRepositories` (after `sourcePolicy`):

```ts
  /** Phase 4 keyword discovery; read-only and never used by mutation paths. */
  search: KnowledgeSearchRepository;
```

Add to the imports in `src/infrastructure/database/mariadb/repositories/index.ts`:

```ts
import { MariaDbKnowledgeSearchRepository } from "./knowledge-search";
```

Add to the object returned by `createRepositories` (after the `sourcePolicy` line):

```ts
    search: new MariaDbKnowledgeSearchRepository(connection),
```

- [ ] **Step 7: Run integration tests and typecheck; confirm PASS**

```bash
npm run typecheck
npm run test:integration
```

Expected: `typecheck` has no errors; all integration tests PASS, including the new file's 9 tests.

- [ ] **Step 8: Commit**

```bash
git add src/modules/knowledge/ports/knowledge-search-repository.ts src/modules/knowledge/domain/errors.ts \
        src/infrastructure/database/mariadb/repositories/knowledge-search.ts \
        src/infrastructure/database/mariadb/repositories/index.ts \
        src/modules/knowledge/ports/unit-of-work.ts \
        tests/integration/phase4-search-repository.test.ts
git commit -m "feat: add Phase 4 knowledge search repository" -m "Claude-Session: https://claude.ai/code/session_01DaDE1g3jt2U6eQ79yUoHjJ"
```

---

### Task 4: Search Application Service (Authorization Boundary)

**Files:**
- Create: `src/modules/knowledge/application/knowledge-search-service.ts`
- Modify: `src/server/composition.ts:61-96`(create and return `search`)
- Test: `tests/integration/phase4-search-service.test.ts`

**Interfaces:**
- Consumes: Task 1 `parseSearchQuery`; Task 3 `KnowledgeSearchRow`, `repositories.search`
- Produces:
  - `SEARCH_PAGE_SIZE = 20`、`SEARCH_MAX_PAGE = 50`
  - `type SearchScope = { kind: "workspace"; workspaceId: string } | { kind: "all" }`
  - `type KnowledgeSearchInput = { q: string; scope: SearchScope; sourceId?: string | null; includeArchived?: boolean; page?: number }`
  - `type KnowledgeSearchResult = { terms: string[]; hits: KnowledgeSearchRow[]; page: number; hasNext: boolean; tooLong: boolean }`
  - `class KnowledgeSearchService { constructor(unitOfWork: KnowledgeUnitOfWork, workspaces: WorkspaceQueryService); search(caller, input): Promise<KnowledgeSearchResult> }`
  - `applicationServices().search`

- [ ] **Step 1: Write failing tests**

Create `tests/integration/phase4-search-service.test.ts`：

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { HubKnowledgeCommandServiceImpl } from "@/modules/knowledge/application/hub-knowledge-command-service";
import { KnowledgeSearchService } from "@/modules/knowledge/application/knowledge-search-service";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import type { CallerContext } from "@/modules/identity/domain/caller-context";
import type { UserIdentity } from "@/modules/identity/domain/user-identity";
import { WorkspaceQueryService } from "@/modules/workspaces/application/workspace-query-service";
import { WorkspaceNotFoundError } from "@/modules/workspaces/domain/errors";
import { createTeamWorkspaceInsert } from "@/modules/workspaces/domain/workspace";
import { createDirectMembership } from "@/modules/workspaces/domain/workspace-membership";
import { uuidv7 } from "@/shared/ids/uuidv7";

let pool: Pool;
beforeAll(() => { pool = createDatabasePool(databaseConfig("test")); });
afterAll(async () => { await pool.end(); });

const member: UserIdentity = { id: "00000000-0000-0000-0000-000000000411", emp_id: "P4-MEMBER", name: "Member", org_code: "HRSD" };
const outsider: UserIdentity = { id: "00000000-0000-0000-0000-000000000412", emp_id: "P4-OUTSIDER", name: "Outsider", org_code: "HRSD" };
const grouped: UserIdentity = { id: "00000000-0000-0000-0000-000000000413", emp_id: "P4-GROUPED", name: "Grouped", org_code: "RD" };

function service(): KnowledgeSearchService {
  const unitOfWork = new MariaDbUnitOfWork(pool);
  return new KnowledgeSearchService(unitOfWork, new WorkspaceQueryService(unitOfWork));
}

function groupCaller(identity: UserIdentity, groupIds: string[]): CallerContext {
  return { identity: { ...identity }, validatedExternalGroupIds: groupIds, platformCapabilities: [] };
}

/** A workspace with one document containing `needle`. */
async function createWorkspaceWithDocument(options: { owner: UserIdentity; needle: string; archivedWorkspace?: boolean }): Promise<string> {
  const unitOfWork = new MariaDbUnitOfWork(pool);
  const workspaceId = uuidv7();
  const sourceId = uuidv7();
  const now = new Date();
  await unitOfWork.run(async (repositories) => {
    for (const identity of [member, outsider, grouped]) await repositories.users.upsertIdentity(identity);
    await repositories.workspaces.insert(createTeamWorkspaceInsert({ id: workspaceId, name: `WS ${workspaceId}`, createdBy: options.owner.id, now }));
    await repositories.workspaceMemberships.insert(createDirectMembership({ workspaceId, userId: options.owner.id, role: "OWNER", createdBy: options.owner.id, now }));
    await repositories.sources.insert({
      id: sourceId, name: "Source", workspaceId, sourceType: "HUB", ownership: "HUB_MANAGED", status: "ACTIVE", syncVersion: 0,
      createdBy: options.owner.id, updatedBy: options.owner.id, archivedBy: null, archivedAt: null, createdAt: now, updatedAt: now,
    });
  });
  await new HubKnowledgeCommandServiceImpl(unitOfWork).createDocument(callerFromIdentity(options.owner), {
    sourceId, parentId: null, title: "Shared 文件", markdown: `${options.needle} 內容`, metadata: {},
  });
  if (options.archivedWorkspace) {
    await unitOfWork.run(async (repositories) => {
      await repositories.workspaces.setWorkspaceLifecycle(workspaceId, "ARCHIVED", options.owner.id, new Date(), new Date());
    });
  }
  return workspaceId;
}

describe("Phase 4 search authorization", () => {
  it("returns hits from a workspace the caller can read", async () => {
    const needle = `needle${uuidv7().slice(0, 8)}`;
    const workspaceId = await createWorkspaceWithDocument({ owner: member, needle });
    const result = await service().search(callerFromIdentity(member), { q: needle, scope: { kind: "workspace", workspaceId } });
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0].workspaceId).toBe(workspaceId);
  });

  it("hides a non-member's workspace behind a non-enumerating not-found", async () => {
    const needle = `needle${uuidv7().slice(0, 8)}`;
    const workspaceId = await createWorkspaceWithDocument({ owner: member, needle });
    await expect(service().search(callerFromIdentity(outsider), { q: needle, scope: { kind: "workspace", workspaceId } }))
      .rejects.toBeInstanceOf(WorkspaceNotFoundError);
  });

  it("never leaks content of unreadable workspaces in an all-scope search", async () => {
    const needle = `needle${uuidv7().slice(0, 8)}`;
    await createWorkspaceWithDocument({ owner: member, needle });
    const result = await service().search(callerFromIdentity(outsider), { q: needle, scope: { kind: "all" } });
    expect(result.hits).toEqual([]);
  });

  it("includes workspaces granted through a validated SSO group mapping", async () => {
    const needle = `needle${uuidv7().slice(0, 8)}`;
    const workspaceId = await createWorkspaceWithDocument({ owner: member, needle });
    const externalGroupId = `p4-group-${uuidv7().slice(0, 8)}`;
    await new MariaDbUnitOfWork(pool).run(async (repositories) => {
      await repositories.groupMappings.insert({
        id: uuidv7(), workspaceId, externalGroupId, role: "VIEWER",
        createdBy: member.id, createdAt: new Date(), updatedAt: new Date(),
      });
    });
    const result = await service().search(groupCaller(grouped, [externalGroupId]), { q: needle, scope: { kind: "all" } });
    expect(result.hits.map((hit) => hit.workspaceId)).toEqual([workspaceId]);
  });

  it("keeps an archived Team searchable when scoped to it, but out of all-scope by default", async () => {
    const needle = `needle${uuidv7().slice(0, 8)}`;
    const workspaceId = await createWorkspaceWithDocument({ owner: member, needle, archivedWorkspace: true });
    const scoped = await service().search(callerFromIdentity(member), { q: needle, scope: { kind: "workspace", workspaceId } });
    expect(scoped.hits).toHaveLength(1);

    const all = await service().search(callerFromIdentity(member), { q: needle, scope: { kind: "all" } });
    expect(all.hits.map((hit) => hit.workspaceId)).not.toContain(workspaceId);

    const allArchived = await service().search(callerFromIdentity(member), { q: needle, scope: { kind: "all" }, includeArchived: true });
    expect(allArchived.hits.map((hit) => hit.workspaceId)).toContain(workspaceId);
  });

  it("reports an over-long query without touching the database", async () => {
    const result = await service().search(callerFromIdentity(member), { q: "x".repeat(201), scope: { kind: "all" } });
    expect(result).toMatchObject({ tooLong: true, hits: [], hasNext: false });
  });

  it("reports hasNext using one extra row beyond the page size", async () => {
    const needle = `needle${uuidv7().slice(0, 8)}`;
    const workspaceId = await createWorkspaceWithDocument({ owner: member, needle });
    const unitOfWork = new MariaDbUnitOfWork(pool);
    const sourceId = (await unitOfWork.run((repositories) => repositories.sourcePolicy.listByWorkspaceId(workspaceId)))[0].id;
    const hub = new HubKnowledgeCommandServiceImpl(unitOfWork);
    for (let index = 0; index < 20; index += 1) {
      await hub.createDocument(callerFromIdentity(member), {
        sourceId, parentId: null, title: `Extra ${index}`, markdown: `${needle} 內容`, metadata: {},
      });
    }
    const first = await service().search(callerFromIdentity(member), { q: needle, scope: { kind: "workspace", workspaceId } });
    expect(first.hits).toHaveLength(20);
    expect(first.hasNext).toBe(true);
    const second = await service().search(callerFromIdentity(member), { q: needle, scope: { kind: "workspace", workspaceId }, page: 2 });
    expect(second.hits).toHaveLength(1);
    expect(second.hasNext).toBe(false);
  });
});
```

- [ ] **Step 2: Run integration tests and confirm RED**

```bash
npm run test:integration
```

Expected: FAIL，`Failed to resolve import "@/modules/knowledge/application/knowledge-search-service"`。

- [ ] **Step 3: Implement service**

Create `src/modules/knowledge/application/knowledge-search-service.ts`：

```ts
import type { CallerContext } from "@/modules/identity/domain/caller-context";
import { evaluateWorkspaceCapabilities } from "@/modules/workspaces/application/workspace-authorization";
import type { WorkspaceQueryService } from "@/modules/workspaces/application/workspace-query-service";
import { parseSearchQuery } from "../domain/search-query";
import type { KnowledgeSearchRow } from "../ports/knowledge-search-repository";
import type { KnowledgeRepositories, KnowledgeUnitOfWork } from "../ports/unit-of-work";

export const SEARCH_PAGE_SIZE = 20;
export const SEARCH_MAX_PAGE = 50;

export type SearchScope = { kind: "workspace"; workspaceId: string } | { kind: "all" };

export type KnowledgeSearchInput = {
  q: string;
  scope: SearchScope;
  sourceId?: string | null;
  includeArchived?: boolean;
  page?: number;
};

export type KnowledgeSearchResult = {
  terms: string[];
  hits: KnowledgeSearchRow[];
  page: number;
  hasNext: boolean;
  tooLong: boolean;
};

/**
 * Phase 4 spec §5. A keyword match IS a read: a hit proves the document
 * contains the term, so matching only ever happens inside Workspaces where
 * the caller holds document.read. Discover-only Workspaces contribute no
 * hits, no counts and no names.
 */
export class KnowledgeSearchService {
  constructor(
    private readonly unitOfWork: KnowledgeUnitOfWork,
    private readonly workspaces: WorkspaceQueryService,
  ) {}

  async search(caller: CallerContext, input: KnowledgeSearchInput): Promise<KnowledgeSearchResult> {
    const parsed = parseSearchQuery(input.q);
    const page = Math.min(Math.max(input.page ?? 1, 1), SEARCH_MAX_PAGE);
    const includeArchived = input.includeArchived ?? false;
    if (parsed.tooLong || parsed.terms.length === 0) {
      return { terms: parsed.terms, hits: [], page, hasNext: false, tooLong: parsed.tooLong };
    }
    // The accessible list is read outside the search transaction, exactly as
    // the existing read models do; capabilities are then re-checked per row.
    const accessible = input.scope.kind === "all" ? await this.workspaces.listWorkspaces(caller) : [];
    return this.unitOfWork.run(async (repositories) => {
      await repositories.users.upsertIdentity(caller.identity);
      const workspaceIds = input.scope.kind === "workspace"
        ? await scopedWorkspace(repositories, caller, input.scope.workspaceId)
        : await readableWorkspaces(
            repositories,
            caller,
            accessible.filter((workspace) => includeArchived || workspace.lifecycleState !== "ARCHIVED").map((workspace) => workspace.id),
          );
      const rows = await repositories.search.search({
        terms: parsed.terms,
        workspaceIds,
        sourceId: input.sourceId ?? null,
        includeArchived,
        limit: SEARCH_PAGE_SIZE + 1,
        offset: (page - 1) * SEARCH_PAGE_SIZE,
      });
      return {
        terms: parsed.terms,
        hits: rows.slice(0, SEARCH_PAGE_SIZE),
        page,
        hasNext: rows.length > SEARCH_PAGE_SIZE,
        tooLong: false,
      };
    });
  }
}

/** Undiscoverable -> not found; discoverable but unreadable -> access denied. */
async function scopedWorkspace(
  repositories: KnowledgeRepositories,
  caller: CallerContext,
  workspaceId: string,
): Promise<string[]> {
  await repositories.workspaceAccess.requireWorkspaceRead(caller, workspaceId);
  return [workspaceId];
}

async function readableWorkspaces(
  repositories: KnowledgeRepositories,
  caller: CallerContext,
  candidateIds: readonly string[],
): Promise<string[]> {
  const readable: string[] = [];
  for (const workspaceId of candidateIds) {
    const capabilities = await evaluateWorkspaceCapabilities(repositories, caller, workspaceId);
    if (capabilities.has("document.read")) readable.push(workspaceId);
  }
  return readable;
}
```

- [ ] **Step 4: Wire up composition**

Add to the imports in `src/server/composition.ts`:

```ts
import { KnowledgeSearchService } from "@/modules/knowledge/application/knowledge-search-service";
```

In `buildApplicationServices`, add after `const workspaces = new WorkspaceQueryService(unitOfWork);`:

```ts
  const search = new KnowledgeSearchService(unitOfWork, workspaces);
```

Add `search` to the returned object (after `workspaces`):

```ts
  return { workspaceAdmin, teams, governance, verifyProductionReadiness: verifyReadiness, identityProvider, unitOfWork, resolver, personalWorkspaces, establishTrustedCaller, hub, queries, sources, workspaces, search, imports };
```

- [ ] **Step 5: Run integration tests and typecheck; confirm PASS**

```bash
npm run typecheck
npm run test:integration
```

Expected: all pass, including all 7 tests in the new file.

- [ ] **Step 6: Commit**

```bash
git add src/modules/knowledge/application/knowledge-search-service.ts src/server/composition.ts \
        tests/integration/phase4-search-service.test.ts
git commit -m "feat: add Phase 4 workspace-scoped search service" -m "Claude-Session: https://claude.ai/code/session_01DaDE1g3jt2U6eQ79yUoHjJ"
```

---

### Task 5: Search Page, Navigation Entry, and Fixtures

**Files:**
- Create: `src/server/search-read.ts`
- Create: `src/app/w/[workspaceId]/search/page.tsx`
- Create: `src/components/search/search-form.tsx`
- Create: `src/components/search/search-results.tsx`
- Create: `src/components/search/search-result-row.tsx`
- Modify: `src/components/shell/primary-nav.tsx:14-26`
- Modify: `scripts/db/seed.ts:20-51`(ID and copy constants)and `seedBrowserFixtures` in `scripts/db/seed.ts`
- Test: `tests/e2e/phase4-search.spec.ts`

**Interfaces:**
- Consumes: Task 1 `highlightSnippet`; Task 2 `actions.canSearch`; Task 4 `applicationServices().search`, `KnowledgeSearchResult`
- Produces: `getSearchPageModel(workspaceId, input)`, `SearchPageModel`, `/w/:workspaceId/search` route, `BROWSER_FIXTURE_IDS.searchDocument`, `BROWSER_FIXTURES.searchTitle` / `searchBody`

**Note (difference from spec §9.3 E5):** The first clause of E5, “navigation hides Search when `canSearch` is false,” is **unreachable** in the current role model because all four assignable roles include `document.read`. Task 2 unit test U6 covers derivation; E2E verifies the reachable portion: a non-member entering the search URL directly receives 404.

- [ ] **Step 1: Add seed fixture**

Add two IDs to `BROWSER_FIXTURE_IDS` in `scripts/db/seed.ts`:

```ts
  searchDocument: "0199f100-0000-7000-8000-000000000207",
  searchRevision: "0199f100-0000-7000-8000-000000000208",
  searchNode: "0199f100-0000-7000-8000-000000000209",
```

Add three constants to `BROWSER_FIXTURES`:

```ts
  searchTitle: "請假流程 SWFP Leave Policy",
  searchBody: "員工請假流程：先在系統送出申請，主管簽核後生效。Employee leave requests need manager approval.",
  searchMissTitle: "Retired Notes",
```

In `seedBrowserFixtures`, directly after the secret document block `if (!(await repositories.documents.findById(BROWSER_FIXTURE_IDS.secretDocument))) { ... }`, add within the same `unitOfWork.run` (fixed IDs plus existence checks make it repeatable):

```ts
    if (!(await repositories.documents.findById(BROWSER_FIXTURE_IDS.searchDocument))) {
      const content = { title: BROWSER_FIXTURES.searchTitle, markdown: BROWSER_FIXTURES.searchBody, metadata: {} };
      await repositories.documents.insertDraft({
        id: BROWSER_FIXTURE_IDS.searchDocument, sourceId: BROWSER_FIXTURE_IDS.obsidianWikiSource, currentRevisionId: null,
        status: "ACTIVE", createdBy: identity.id, updatedBy: identity.id, archivedBy: null, archivedAt: null, createdAt: now, updatedAt: now,
      });
      await repositories.revisions.insert({
        id: BROWSER_FIXTURE_IDS.searchRevision, documentId: BROWSER_FIXTURE_IDS.searchDocument, revisionNo: 1,
        ...content, contentHash: contentFingerprint(content), createdBy: identity.id, createdAt: now,
      });
      await repositories.documents.setCurrentRevision(BROWSER_FIXTURE_IDS.searchDocument, BROWSER_FIXTURE_IDS.searchRevision, identity.id);
      await repositories.tree.insert({
        id: BROWSER_FIXTURE_IDS.searchNode, sourceId: BROWSER_FIXTURE_IDS.obsidianWikiSource, parentId: null,
        nodeType: "DOCUMENT", name: null, documentId: BROWSER_FIXTURE_IDS.searchDocument, position: 1,
        status: "ACTIVE", updatedBy: identity.id, archivedBy: null, archivedAt: null,
      });
      await repositories.documents.assertComplete(BROWSER_FIXTURE_IDS.searchDocument);
    }
```

- [ ] **Step 2: Write failing E2E tests**

Create `tests/e2e/phase4-search.spec.ts`(copy constants manually following existing conventions; Playwright cannot resolve the `@/` alias)：

```ts
import { expect, test } from "@playwright/test";

// Mirrors scripts/db/seed.ts BROWSER_FIXTURES / BROWSER_FIXTURE_IDS.
const QUERY_MASTER_WORKSPACE = "0199f100-0000-7000-8000-000000000001";
const RESTRICTED_WORKSPACE = "0199f100-0000-7000-8000-000000000003";
const SEARCH_TITLE = "請假流程 SWFP Leave Policy";
const RESTRICTED_BODY_NEEDLE = "restricted-secret-body-9f31";

test("finds a mixed Chinese/English document and opens it", async ({ page }) => {
  await page.goto(`/w/${QUERY_MASTER_WORKSPACE}/knowledge`);
  await page.getByRole("link", { name: "Search" }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${QUERY_MASTER_WORKSPACE}/search`));

  await page.getByLabel("Search knowledge").fill("請假");
  await page.getByRole("button", { name: "Search" }).click();

  const hit = page.getByRole("link", { name: SEARCH_TITLE });
  await expect(hit).toBeVisible();
  await hit.click();
  await expect(page.getByRole("heading", { name: SEARCH_TITLE })).toBeVisible();
});

test("never returns content from a workspace without membership", async ({ page }) => {
  await page.goto(`/w/${QUERY_MASTER_WORKSPACE}/search?q=${encodeURIComponent(RESTRICTED_BODY_NEEDLE)}&scope=all`);
  await expect(page.getByText("No results", { exact: false })).toBeVisible();
  await expect(page.getByText(RESTRICTED_BODY_NEEDLE)).toHaveCount(0);
});

test("returns 404 for a workspace the caller cannot access", async ({ page }) => {
  const response = await page.goto(`/w/${RESTRICTED_WORKSPACE}/search?q=anything`);
  expect(response?.status()).toBe(404);
});

test("shows an empty state when nothing matches", async ({ page }) => {
  await page.goto(`/w/${QUERY_MASTER_WORKSPACE}/search?q=zzzznomatchzzzz`);
  await expect(page.getByText("No results", { exact: false })).toBeVisible();
});

test("keeps archived mode on result links", async ({ page }) => {
  await page.goto(`/w/${QUERY_MASTER_WORKSPACE}/search?q=${encodeURIComponent("請假")}&archived=1`);
  const links = page.getByRole("link", { name: SEARCH_TITLE });
  await expect(links.first()).toHaveAttribute("href", /includeArchived=true/);
});
```

- [ ] **Step 3: Run E2E and confirm RED**

```bash
npm run test:e2e -- tests/e2e/phase4-search.spec.ts
```

Expected: FAIL. `/w/:id/search` does not exist yet; the first test times out looking for the `Search` navigation link.

- [ ] **Step 4: Implement read model**

Create `src/server/search-read.ts`：

```ts
import { notFound } from "next/navigation";
import { sortSourcesByName } from "@/lib/knowledge-navigation";
import type { SourceView } from "@/modules/knowledge/application/knowledge-query-service";
import type { KnowledgeSearchResult } from "@/modules/knowledge/application/knowledge-search-service";
import { SearchTimeoutError } from "@/modules/knowledge/domain/errors";
import { applicationServices } from "@/server/composition";

export type SearchPageInput = {
  q: string;
  scope: "workspace" | "all";
  sourceId: string | null;
  includeArchived: boolean;
  page: number;
};

export type SearchPageModel = SearchPageInput & {
  workspaceId: string;
  workspaceName: string;
  sources: SourceView[];
  result: KnowledgeSearchResult | null;
  timedOut: boolean;
};

/**
 * The only Web entry to search. Authorization order is fixed: trusted caller,
 * then Workspace visibility, then canSearch, and only then any content query.
 * Anything the caller may not see resolves to notFound(), matching the
 * existing settings read model.
 */
export async function getSearchPageModel(workspaceId: string, input: SearchPageInput): Promise<SearchPageModel> {
  const services = applicationServices();
  const { caller } = await services.establishTrustedCaller();
  const navigation = await services.workspaceAdmin.navigation(caller);
  const workspace = navigation.items.find((item) => item.id === workspaceId);
  if (!workspace) notFound();
  const { actions } = await services.workspaceAdmin.workspaceState(caller, workspaceId);
  if (!actions.canSearch) notFound();

  const sources = sortSourcesByName(
    await services.queries
      .listSources(caller, workspaceId, { includeArchived: input.includeArchived })
      .catch(() => []),
  );
  const base = { ...input, workspaceId, workspaceName: workspace.name, sources };
  if (input.q.trim() === "") return { ...base, result: null, timedOut: false };
  try {
    const result = await services.search.search(caller, {
      q: input.q,
      scope: input.scope === "all" ? { kind: "all" } : { kind: "workspace", workspaceId },
      sourceId: input.scope === "all" ? null : input.sourceId,
      includeArchived: input.includeArchived,
      page: input.page,
    });
    return { ...base, result, timedOut: false };
  } catch (error) {
    if (error instanceof SearchTimeoutError) return { ...base, result: null, timedOut: true };
    throw error;
  }
}
```

- [ ] **Step 5: Implement components**

Create `src/components/search/search-form.tsx`：

```tsx
import type { SourceView } from "@/modules/knowledge/application/knowledge-query-service";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** A plain GET form: shareable URLs, and it works without JavaScript. */
export function SearchForm({
  workspaceId, q, scope, sourceId, includeArchived, sources,
}: {
  workspaceId: string;
  q: string;
  scope: "workspace" | "all";
  sourceId: string | null;
  includeArchived: boolean;
  sources: SourceView[];
}) {
  return (
    <form action={`/w/${workspaceId}/search`} method="get" className="flex flex-col gap-3">
      <div>
        <Label htmlFor="search-q">Search knowledge</Label>
        <Input id="search-q" name="q" type="search" defaultValue={q} autoComplete="off" placeholder="關鍵字 / keyword" />
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="search-scope">Scope</Label>
          <select
            id="search-scope"
            name="scope"
            defaultValue={scope}
            className="min-h-10 rounded-md border border-kh-border bg-kh-bg px-3 py-2 text-sm text-kh-text focus:border-kh-accent focus-visible:ring-2 focus-visible:ring-kh-accent"
          >
            <option value="workspace">This workspace</option>
            <option value="all">All my workspaces</option>
          </select>
        </div>
        <div>
          <Label htmlFor="search-source">Source</Label>
          <select
            id="search-source"
            name="source"
            defaultValue={sourceId ?? ""}
            className="min-h-10 rounded-md border border-kh-border bg-kh-bg px-3 py-2 text-sm text-kh-text focus:border-kh-accent focus-visible:ring-2 focus-visible:ring-kh-accent"
          >
            <option value="">All sources</option>
            {sources.map((source) => (
              <option key={source.id} value={source.id}>{source.name}</option>
            ))}
          </select>
        </div>
        <label className="flex min-h-10 items-center gap-2 text-sm text-kh-text">
          <input type="checkbox" name="archived" value="1" defaultChecked={includeArchived} />
          Show archived
        </label>
        <Button type="submit">Search</Button>
      </div>
    </form>
  );
}
```

Create `src/components/search/search-result-row.tsx`：

```tsx
import Link from "next/link";
import { FileText } from "lucide-react";
import { highlightSnippet } from "@/modules/knowledge/domain/search-query";
import type { KnowledgeSearchRow } from "@/modules/knowledge/ports/knowledge-search-repository";

function formatTimestamp(value: Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleString();
}

export function SearchResultRow({
  hit, terms, includeArchived,
}: {
  hit: KnowledgeSearchRow;
  terms: readonly string[];
  includeArchived: boolean;
}) {
  const href = `/w/${hit.workspaceId}/knowledge/${hit.sourceId}/${hit.documentId}${includeArchived ? "?includeArchived=true" : ""}`;
  return (
    <li>
      <Link
        href={href}
        className="flex gap-3 rounded-md border border-kh-border bg-kh-bg px-3 py-2.5 transition hover:bg-kh-bg-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-kh-accent"
      >
        <FileText size={16} strokeWidth={2} aria-hidden="true" className="mt-0.5 shrink-0 text-kh-text-muted" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-kh-text">{hit.title}</span>
          <span className="mt-0.5 block truncate text-xs text-kh-text-muted">
            {hit.workspaceName} · {hit.sourceName} · <time dateTime={new Date(hit.updatedAt).toISOString()}>{formatTimestamp(hit.updatedAt)}</time>
          </span>
          <span className="mt-1 block text-sm text-kh-text-muted line-clamp-2">
            {highlightSnippet(hit.snippet, terms).map((segment, index) =>
              segment.match
                ? <mark key={index} className="bg-kh-accent/20 text-kh-text">{segment.text}</mark>
                : <span key={index}>{segment.text}</span>,
            )}
          </span>
        </span>
      </Link>
    </li>
  );
}
```

Create `src/components/search/search-results.tsx`：

```tsx
import Link from "next/link";
import type { SearchPageModel } from "@/server/search-read";
import { SearchResultRow } from "@/components/search/search-result-row";

function pageHref(model: SearchPageModel, page: number): string {
  const params = new URLSearchParams({ q: model.q, scope: model.scope });
  if (model.sourceId) params.set("source", model.sourceId);
  if (model.includeArchived) params.set("archived", "1");
  if (page > 1) params.set("page", String(page));
  return `/w/${model.workspaceId}/search?${params.toString()}`;
}

export function SearchResults({ model }: { model: SearchPageModel }) {
  if (model.timedOut) {
    return (
      <p role="alert" className="rounded-md border border-kh-border p-6 text-sm text-kh-danger">
        搜尋逾時，請縮小範圍後再試一次。
      </p>
    );
  }
  if (model.result === null) {
    return <p className="rounded-md border border-dashed border-kh-border p-6 text-sm text-kh-text-muted">Enter a keyword to search.</p>;
  }
  if (model.result.tooLong) {
    return <p role="alert" className="rounded-md border border-kh-border p-6 text-sm text-kh-danger">Query is too long; use at most 200 characters.</p>;
  }
  if (model.result.hits.length === 0) {
    return <p className="rounded-md border border-dashed border-kh-border p-6 text-sm text-kh-text-muted">No results for this query.</p>;
  }
  return (
    <>
      <ul className="flex flex-col gap-2">
        {model.result.hits.map((hit) => (
          <SearchResultRow key={hit.documentId} hit={hit} terms={model.result!.terms} includeArchived={model.includeArchived} />
        ))}
      </ul>
      <nav aria-label="Search pages" className="mt-4 flex gap-3 text-sm">
        {model.result.page > 1 && <Link className="underline" href={pageHref(model, model.result.page - 1)}>Previous</Link>}
        {model.result.hasNext && <Link className="underline" href={pageHref(model, model.result.page + 1)}>Next</Link>}
      </nav>
    </>
  );
}
```

- [ ] **Step 6: Implement page and navigation entry**

Create `src/app/w/[workspaceId]/search/page.tsx`：

```tsx
import { SearchForm } from "@/components/search/search-form";
import { SearchResults } from "@/components/search/search-results";
import { getSearchPageModel } from "@/server/search-read";

export default async function WorkspaceSearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams?: Promise<{ q?: string; scope?: string; source?: string; archived?: string; page?: string }>;
}) {
  const { workspaceId } = await params;
  const query = await searchParams;
  const parsedPage = Number.parseInt(query?.page ?? "1", 10);
  const model = await getSearchPageModel(workspaceId, {
    q: query?.q ?? "",
    scope: query?.scope === "all" ? "all" : "workspace",
    sourceId: query?.source ? query.source : null,
    includeArchived: query?.archived === "1",
    page: Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1,
  });
  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="text-2xl font-semibold text-kh-text">Search</h1>
      <p className="mt-1 text-sm text-kh-text-muted">{model.workspaceName}</p>
      <div className="mt-5">
        <SearchForm
          workspaceId={model.workspaceId}
          q={model.q}
          scope={model.scope}
          sourceId={model.sourceId}
          includeArchived={model.includeArchived}
          sources={model.sources}
        />
      </div>
      <div className="mt-6">
        <SearchResults model={model} />
      </div>
    </main>
  );
}
```

In `src/components/shell/primary-nav.tsx`, change icon imports to:

```tsx
import { BookOpenText, Database, Search, Settings } from "lucide-react";
```

Insert after Knowledge in the `items` array:

```tsx
    ...(access.actions.canSearch ? [{
      name: "Search",
      href: `/w/${workspaceId}/search`,
      Icon: Search,
    }] : []),
```

- [ ] **Step 7: Run E2E and typecheck; confirm PASS**

```bash
npm run typecheck
npm run lint
npm run test:e2e -- tests/e2e/phase4-search.spec.ts
```

Expected: all pass, including all 5 E2E tests.

- [ ] **Step 8: Commit**

```bash
git add src/server/search-read.ts 'src/app/w/[workspaceId]/search/page.tsx' src/components/search \
        src/components/shell/primary-nav.tsx scripts/db/seed.ts tests/e2e/phase4-search.spec.ts
git commit -m "feat: add Phase 4 workspace search page" -m "Claude-Session: https://claude.ai/code/session_01DaDE1g3jt2U6eQ79yUoHjJ"
```

---

### Task 6: Complete Acceptance and Verification Record

**Files:**
- Create: `docs/superpowers/verification/2026-09-16-phase-4-discovery-read-api-verification.md`

**Interfaces:**
- Consumes: All Task 1–5 deliverables
- Produces: Reproducible Phase 4 acceptance record and performance baseline

- [ ] **Step 1: Run the complete local gate**

```bash
make verify
npm run test:integration
npm run test:e2e
```

Expected: all pass. Fix every failure; do not mark failures as passed in the verification record.

- [ ] **Step 2: Rerun performance baseline**

Rerun the spec §4.2 baseline (20,000 mixed Chinese/English documents, 276 MB) on the local MariaDB container; record cold/warm query timings. Build the corpus in a **disposable database**, delete it afterwards, and do not contaminate dev or test databases.

- [ ] **Step 3: Write verification record**

Create `docs/superpowers/verification/2026-09-16-phase-4-discovery-read-api-verification.md`, containing at least:

```markdown
# Phase 4 Discovery & Read API — Verification

| Item | Content |
| --- | --- |
| Date | <actual execution date> |
| Spec | docs/superpowers/specs/2026-09-16-phase-4-discovery-read-api-design.md |
| Plan | docs/superpowers/plans/2026-09-16-phase-4-discovery-read-api.md |

## Commands and Results

| Command | Result |
| --- | --- |
| `make verify` | <PASS/FAIL and summary> |
| `npm run test:integration` | <PASS/FAIL and test count> |
| `npm run test:e2e` | <PASS/FAIL and test count> |

## Requirement Mapping

<For each U1–U6, I1–I12, E1–E5 in spec §9, list the corresponding test files and results>

## Performance Baseline

| Query | Current measurement | Spec §4.2 baseline |
| --- | --- | --- |
| Body LIKE (cold) | <ms> | 2,272 ms |
| Body LIKE (warm) | <ms> | 1,940 ms |
| Title LIKE | <ms> | 3 ms |

Upgrade trigger: production p95 exceeds 1 second (spec §10).

## Prerequisite Status

Phase 3 Product Acceptance: <PASS / incomplete> (product closure spec §27)
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/verification/2026-09-16-phase-4-discovery-read-api-verification.md
git commit -m "docs: record Phase 4 verification evidence" -m "Claude-Session: https://claude.ai/code/session_01DaDE1g3jt2U6eQ79yUoHjJ"
```

---

## Self-Review Results

**Spec coverage:**

| Spec section | Corresponding task |
| --- | --- |
| §5.1 Matching Is Reading | Task 4(service takes only Workspaces with `document.read`)、I2/I3 |
| §5.2 Authorized Scope Computation | Task 4 `scopedWorkspace` / `readableWorkspaces` |
| §5.3 Authorization Failure Presentation | Task 5 `getSearchPageModel` `notFound()`; Task 2 tripwire test |
| §5.4 Source Filtering | Task 3 SQL、I9 |
| §5.5 Archive Semantics | Task 3（node/document/source）、Task 4（Workspace lifecycle）、I6/I7 |
| §5.6 Match Only Current Revision | Task 3 SQL `current_revision_id` join, I8 |
| §6.1 Query Parsing and Escaping | Task 1、U1/U2、I12 |
| §6.2 SQL | Task 3 |
| §6.3 Ordering | Task 3 SQL、I10 |
| §6.4 Snippet and Highlighting | Task 1 `highlightSnippet`、Task 3 SQL、Task 5 `<mark>` |
| §6.5 Pagination | Task 4、Task 5、I11 |
| §6.6 Timeout | Task 3 `SearchTimeoutError`、Task 5 timeout screen |
| §7.1–7.3 Files and Pages | Task 5 |
| §7.4 Navigation Visibility | Task 2 `canSearch`、Task 5 navigation、E5 |
| §8 Error Handling | Task 3、Task 4、Task 5 |
| §9 Test Plan | Task 1–5 respective tests |
| §10 Performance Acceptance | Task 6 |
| §11 Acceptance Criteria | Task 6 |

**Placeholder scan:** No TBD/TODO; every code step provides complete pasteable content. Task 6's verification template intentionally keeps angle-bracket fields such as `<actual execution date>` because those measurements arise only during execution, not from unresolved design.

**Type consistency:** `KnowledgeSearchRow` (defined in Task 3) is reused by Task 4 `KnowledgeSearchResult.hits` and Task 5 `SearchResultRow`; `canSearch` (Task 2) is reused by Task 5 read model and navigation; `toLikePattern` / `highlightSnippet` / `parseSearchQuery` (Task 1) are used by Task 3, Task 5, and Task 4 respectively, with consistent names and signatures.

**Known spec deviation (intentional and recorded):** The first clause of spec §9.3 E5 is unreachable; Task 2 unit tests cover derivation, and E2E verifies only non-member 404.
