# Knowledge Hub — Phase 4 Discovery & Read API Design

**English** | [繁體中文](2026-09-16-phase-4-discovery-read-api-design.zh-TW.md)

| Item | Content |
| --- | --- |
| Date | 2026-09-16 |
| Document role | Phase 4 canonical design: Workspace-aware keyword discovery and read boundary |
| Decision basis | Phase 0 ADR (MariaDB 10.11), Phase 3 governance spec, Phase 3 product closure spec, and local measured baseline |
| Prerequisite | Phase 3 Product Acceptance PASS (product closure spec §27) |
| Project entry point | [README](../../../README.md) |

## 1. Decision Summary

Phase 4 provides Workspace-aware keyword search and a read boundary on existing canonical tables. Its only delivery surface is Human Web.

```text
The user enters keywords
→ the server computes the set of Workspaces the caller can read
→ one SQL query performs substring matching on current versions within that set
→ sort by title-hit count and update time
→ return paginated results with snippets
```

**No new schema, derived index, or external service.** Measurements determine this decision, rather than a convention that search must have an index; see §4 for the rationale.

## 2. Goals

- Workspace-aware keyword discovery that searches mixed Chinese/English content.
- Search results never leak content the caller cannot read.
- Default visibility identical to the Knowledge Tree (ACTIVE-only).
- Predictable performance limits and explicit upgrade triggers.

## 3. Non-goals

- HTTP JSON Read API and MCP: address these in Phase 7 when real Agent identity exists.
- Embedding／vector／semantic／hybrid retrieval：Phase 8。
- Simplified/traditional Chinese equivalence, synonyms, or relevance scoring (BM25, etc.).
- Metadata (frontmatter) field filters: no established key conventions exist; add them when real requirements emerge.
- Source/Document ACL: Phase 3 spec §13 already establishes Workspace as the sole authorization boundary.

## 4. Why LIKE Scan: Bedrock Facts and Measurements

### 4.1 Environment Facts (Measured Locally in a `mariadb:10.11` Container on 2026-09-16)

| Fact | Measured result | Impact |
| --- | --- | --- |
| Full-text parser plugin | `information_schema.ALL_PLUGINS` contains **no FTPARSER**, ngram, or Mroonga | InnoDB `FULLTEXT` can only use the built-in parser; an entire Chinese sentence becomes one token, making `MATCH ... AGAINST` unusable for Chinese |
| `innodb_ft_min_token_size` | 3 | Short terms are ignored |
| `LIKE` under `utf8mb4_bin` | Case-sensitive | Queries must explicitly use `COLLATE utf8mb4_unicode_ci`; columns remain `utf8mb4_bin` |
| `LIKE` under `utf8mb4_unicode_ci` | Case-insensitive; full-width example “ＳＷＦＰ” matches `swfp`; Chinese substrings match | Meets mixed Chinese/English requirements |
| Simplified vs traditional Chinese | Example “请假” **does not match** “請假” | Explicitly a non-goal, with tests preserving current behavior |
| `LIKE ? ESCAPE '!'` | Available | Independent of backslash settings in `sql_mode` |
| `LOCATE` / `SUBSTRING` | Counts **characters**, not bytes | Snippets do not split Chinese characters incorrectly |
| `SET STATEMENT max_statement_time=N FOR ...` | Available; timeout returns **errno 1969** | Timeouts can be caught precisely |

### 4.2 Performance Baseline

Corpus: 20,000 documents, 276 MB Markdown, mixed Chinese/English, `innodb_buffer_pool_size` = 128 MB (table larger than buffer pool).

| Query | Duration |
| --- | --- |
| Body `LIKE '%中文詞%'` (cold; Chinese keyword example) | 2,272 ms |
| Body `LIKE '%中文詞%'` (warm; Chinese keyword example) | 1,940 ms |
| Body `COLLATE utf8mb4_unicode_ci LIKE '%english%'` | 1,602 ms |
| Body `LOWER(markdown) LIKE '%english%'` | 2,501 ms |
| Title `COLLATE utf8mb4_unicode_ci LIKE '%中文詞%'` (Chinese keyword example) | 3 ms |

Conclusions:

- **Use `COLLATE ... LIKE` rather than `LOWER()`**: measured about 36% faster; `LOWER()` also cannot handle full-width characters.
- At 20k documents, a full-body scan takes about 1.6–2.5 seconds and **grows linearly with corpus size**. With an estimated first-year ceiling of 20k documents, this is an acceptable starting point.
- Title scan cost is negligible.

### 4.3 Difference from Convention

Conventionally, a search engine or custom n-gram index would be introduced immediately. At this scale, an index buys speed that is not yet needed, at the cost of maintenance on every write path and a risk of inconsistency between derived and canonical data. The Phase 0 ADR also leaves retrieval backend selection to Phase 8. Phase 4 therefore creates no index and instead defines explicit upgrade triggers (§10).

## 5. Search Scope and Authorization

### 5.1 Core Rule

**Matching is reading.** A hit tells the caller that a document contains a term, so search matches only within Workspaces with `document.read`. Discover-only Workspaces produce no hits, counts, or names.

This concretely implements the Phase 3 authorization clarification requiring Phase 4 search to reuse the same discover/read distinction.

### 5.2 Computing the Authorized Set

IDs in routes and query strings are always navigation scope, not proof of authorization.

- `scope=workspace`: authorize with `requireWorkspaceRead(caller, workspaceId)`.
- `scope=all`: obtain `WorkspaceQueryService.listWorkspaces(caller)` (already includes PERSONAL owner verification, union of group mappings, and My Space pinned-first ordering), evaluate each with `evaluateWorkspaceCapabilities`, and retain only those with `document.read`.

**Do not extract a separate `listAccessibleWorkspaces`**: Phase 3 product closure centralized aggregation in `listWorkspaces`; search reuses it directly to avoid duplication with `WorkspaceAdminService.navigation`.

### 5.3 Presenting Authorization Failure

Reuse the convention implemented by Phase 3 product closure (`src/server/workspace-settings-read.ts`):

```text
WORKSPACE_NOT_FOUND / WORKSPACE_ACCESS_DENIED / INSUFFICIENT_WORKSPACE_CAPABILITY
→ notFound()
```

No dedicated 403 screen is added. All four assignable roles currently include `document.read`, so discover-without-read is unreachable in the current role model; preserve the underlying distinction through §5.1 and the alarm tests in §9.1.

### 5.4 Source Filtering

SQL filters `sourceId` together with the authorized Workspace list. Sources outside the authorized scope return zero rows, exactly like nonexistent Sources, preventing this parameter from probing Source existence.

### 5.5 Archive Semantics

Default visibility exactly matches the Knowledge Tree: `knowledge_tree_nodes`, `knowledge_documents`, and `knowledge_sources` must all be ACTIVE.

| Scenario | Default | `archived=1` |
| --- | --- | --- |
| ARCHIVED Source/Document/Tree node | Excluded | Included |
| ARCHIVED Team Workspace (`scope=all`) | Excluded | Included |
| ARCHIVED Team Workspace (explicit `scope=workspace`) | Searchable | Searchable |

An explicitly selected archived Team remains searchable because Phase 3 spec §14.1 permits authorized reads of archived Teams; the page reuses the existing archived workspace banner. Read Workspace archive state directly from `WorkspaceNavigationItem.lifecycleState`, without an extra query.

### 5.6 Match Targets

Match only the title and Markdown body of each Document's **current version** (`current_revision_id`). Historical versions never enter search.

## 6. Query Semantics and SQL

### 6.1 Query Parsing (Pure Function, No DB)

`parseSearchQuery` lives in `src/modules/knowledge/domain/search-query.ts`:

- Split terms by whitespace; JavaScript `\s` already includes full-width space U+3000.
- Deduplicate repeated terms.
- Limits: `q` 200 characters, 5 terms, 64 characters per term; truncate or reject excess.
- Multiple terms use **AND**: each term must appear in the title or body.
- Boolean operators and quoted phrases are unsupported.
- Escape `!`, `%`, and `_` (prefix `!`); SQL uses `ESCAPE '!'`.
- Empty or whitespace-only queries do not access the DB.

### 6.2 SQL

`MariaDbKnowledgeSearchRepository` issues only one query. If the authorized Workspace list is empty, return empty results directly without sending SQL.

```sql
SET STATEMENT max_statement_time=5 FOR
SELECT d.id AS document_id, d.source_id, s.workspace_id, r.title,
       s.name AS source_name, w.name AS workspace_name, d.status, d.updated_at,
       CASE WHEN LOCATE(?, r.markdown COLLATE utf8mb4_unicode_ci) > 0
            THEN SUBSTRING(r.markdown,
                           GREATEST(LOCATE(?, r.markdown COLLATE utf8mb4_unicode_ci) - 60, 1), 160)
            ELSE SUBSTRING(r.markdown, 1, 160) END AS snippet,
       ((r.title COLLATE utf8mb4_unicode_ci LIKE ? ESCAPE '!') /* one item per term */) AS title_hits
FROM knowledge_documents d
JOIN knowledge_revisions r  ON r.id = d.current_revision_id
JOIN knowledge_tree_nodes n ON n.document_id = d.id
JOIN knowledge_sources s    ON s.id = d.source_id
JOIN workspaces w           ON w.id = s.workspace_id
WHERE s.workspace_id IN (?, ...)
  AND (? = 1 OR (d.status = 'ACTIVE' AND s.status = 'ACTIVE' AND n.status = 'ACTIVE'))
  AND (? = 1 OR d.source_id = ?)
  AND (r.title    COLLATE utf8mb4_unicode_ci LIKE ? ESCAPE '!'
    OR r.markdown COLLATE utf8mb4_unicode_ci LIKE ? ESCAPE '!')   /* repeat one group per term */
ORDER BY title_hits DESC, d.updated_at DESC, d.id ASC
LIMIT ? OFFSET ?
```

`uq_tree_one_document` in `knowledge_tree_nodes` guarantees at most one node per Document, so the JOIN does not multiply rows.

### 6.3 Sorting

1. Number of terms matching the title (more first)
2. `d.updated_at` (newer first)
3. `d.id` (ensures stable ordering)

### 6.4 Snippet

- Anchor on the **first query term**: if it matches the body, take 160 characters starting 60 characters before it.
- If the first term does not match the body (including title-only matches), take the first 160 body characters.
- Display plain text without rendering Markdown.
- Highlight matching terms with `<mark>`, using case-insensitive JS matching. **Known limitation:** JS does not convert full-width characters, so full-width matches may not be highlighted.

### 6.5 Pagination

- 20 rows per page; fetch 21 to determine whether a next page exists.
- `page` is capped at 50 (OFFSET 980 for page 50).
- **Do not compute total count**: `COUNT` requires another corpus scan, doubling response time.

### 6.6 Timeout

Wrap the query with `max_statement_time=5`. Convert timeout (errno 1969) locally in the search repository to `SearchTimeoutError`; the page displays “Search timed out; narrow the scope.” Do not change shared `mapDatabaseError` (which currently returns import-specific errors).

## 7. Module Wiring and UI

### 7.1 New Files

| File | Responsibility |
| --- | --- |
| `src/modules/knowledge/domain/search-query.ts` | `parseSearchQuery`, escaping, and highlight segmentation; pure functions |
| `src/modules/knowledge/ports/knowledge-search-repository.ts` | Search port |
| `src/modules/knowledge/application/knowledge-search-service.ts` | Parse → authorized set → repository → assemble results |
| `src/infrastructure/database/mariadb/repositories/knowledge-search.ts` | SQL from §6.2 |
| `src/server/search-read.ts` | Page read model, reusing try/catch + `notFound()` from `workspace-settings-read.ts` |
| `src/app/w/[workspaceId]/search/page.tsx` | Search page |
| `src/components/search/search-form.tsx` and others | Form and result rows |

### 7.2 Existing File Changes

- `src/modules/knowledge/ports/unit-of-work.ts`: add `search` to `KnowledgeRepositories`; wire it in `repositories/index.ts` as well.
- `src/server/composition.ts`: add `search` to the return value of `buildApplicationServices`.
- `src/server/workspace-admin.ts`: add `canSearch` to `WorkspaceActions`; derive it with `has("document.read")` in `deriveWorkspaceActions`.
- `src/components/shell/primary-nav.tsx`: show Search (lucide `Search` icon) according to `access.actions.canSearch`, following the Sources/Settings pattern.

### 7.3 Page Behavior

Route: `/w/[workspaceId]/search?q=&scope=workspace|all&source=&archived=1&page=`

- **Use GET for the form**: usable without JavaScript, with a directly shareable URL.
- **Fields**: keywords, scope (this Workspace/all), Source (shown only for single-Workspace scope), show archived.
- **Result rows**: title links to `/w/{workspaceId}/knowledge/{sourceId}/{documentId}`; archive mode preserves `includeArchived=true`. Below the title: Workspace · Source, a two-line snippet, and update time.
- **States**: dedicated presentations for no input, no results, timeout, and overly long input.
- **Pagination**: previous/next links preserve existing query parameters.
- Reuse `SourceListRow` styling: `kh-*` tokens, hover, and focus ring.

### 7.4 Navigation Visibility

Per product closure spec §9, server-generated actions determine navigation visibility; hiding navigation **is not** a security boundary. Server authorization still blocks direct URL entry.

## 8. Error Handling

| Scenario | Behavior |
| --- | --- |
| Workspace cannot be discovered | `notFound()` |
| Discoverable but unreadable | `notFound()` (§5.3) |
| Query timeout (errno 1969) | `SearchTimeoutError` → timeout screen, not 500 |
| Empty/whitespace-only query | No DB access; show initial state |
| `q` exceeds 200 characters | No DB access; show input-too-long message |

## 9. Test Plan

### 9.1 Unit Tests (No DB Required)

| # | Requirement source | Test |
| --- | --- | --- |
| U1 | §6.1 | `parseSearchQuery`: ordinary terms, full-width-space splitting, deduplication, over 5 terms, overlong term, empty string, whitespace-only |
| U2 | §6.1 | Escaping: `%`/`_`/`!` are escaped; searching `100%` in content containing `100%` does not turn it into a wildcard |
| U3 | §5.1, §5.3 | **Permission alarm**: fail if any role has `document.discover` without `document.read`, requiring a switch to `requireWorkspaceRead` in the same change |
| U4 | §6.4 | Highlight: mark matches, case-insensitive, no marking without matches |
| U5 | §5.2 | Authorized-set filtering: use a fake repository to verify exclusion of discover-only Workspaces |
| U6 | §7.2, §7.4 | `deriveWorkspaceActions`: `canSearch` is false without `document.read` (pure function; vitest environment is `node`, with no React rendering) |

### 9.2 Integration Tests `tests/integration/phase4-search.test.ts` (DB Required)

| # | Requirement source | Test |
| --- | --- | --- |
| I1 | §5.2 | Cross-Workspace search returns only content readable by the caller |
| I2 | §5.1 | Non-members find nothing, regardless of keyword precision |
| I3 | §5.2 | Workspaces authorized through SSO group mapping are searchable |
| I4 | §4.1 | Mixed Chinese/English examples: “請假” is searchable; `swfp`/`SWFP` are case-insensitive; full-width “ＳＷＦＰ” is searchable; simplified “请假” **is not found** (preserves current behavior) |
| I5 | §6.1 | AND semantics: one term in the title and another in the body count as a match; a missing term means no match |
| I6 | §5.5 | Archive defaults: archived Sources/Documents/Tree nodes are absent by default, appearing only with `archived=1` |
| I7 | §5.5 | Archived Team: searchable when explicitly selected; excluded from `scope=all` by default |
| I8 | §5.6 | Search only current versions: old-version content is absent, new-version content is found |
| I9 | §5.4 | Out-of-scope `sourceId` returns zero rows, like a nonexistent ID |
| I10 | §6.3 | Sort: title matches first, then update time and id |
| I11 | §6.5 | Pagination: fetch 21 to determine next-page existence; `page` cap |
| I12 | §6.1 | Wildcard injection: searching `100%` matches only the row containing `100%` |

### 9.3 E2E（Playwright）

| # | Test |
| --- | --- |
| E1 | Enter Search from sidebar navigation, type Chinese keywords, see results, and open a document |
| E2 | Results never contain `restricted-secret-body-9f31` from a Workspace without membership |
| E3 | Archive toggle; links preserve `includeArchived=true` |
| E4 | No-results empty state |
| E5 | Non-members entering the search URL directly receive 404 (§7.4: hiding navigation is not a security boundary). U6 covers deriving false `canSearch`; all four assignable roles include `document.read`, so hidden Search navigation is unreachable in the current role model and cannot be verified with E2E |

### 9.4 Fixture

Add a mixed Chinese/English document to Query Master in `scripts/db/seed.ts` (example title: “請假流程 SWFP Leave Policy”); mirror constants into the E2E spec following existing conventions (Playwright cannot resolve the `@/` alias).

## 10. Performance Acceptance and Upgrade Triggers

- Record verification using the §4.2 measurements as the baseline.
- **Upgrade trigger:** production search p95 exceeds 1 second.
- After triggering, evaluate upgrades in order: narrow scan scope first (for example, limit body matching to required fields or add prefilters), then consider a derived n-gram index table, and finally an external search engine. Per Phase 0 ADR, external engine selection remains with Phase 8.
- Create no derived index before triggering, avoiding consistency maintenance across write paths.

## 11. Acceptance Criteria

- Search results never include content for which the caller lacks `document.read` (I1, I2, E2).
- Default visibility matches the Knowledge Tree (I6).
- Mixed Chinese/English, full-width, and case behavior match §4.1 (I4).
- Timeouts return the timeout screen rather than 500 (§6.6).
- All §9 test cases pass.
- Start implementation only after Phase 3 Product Acceptance is PASS (product closure spec §27).
