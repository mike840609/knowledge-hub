# Personal Workspace Knowledge Links and Graph — Implementation Plan

**English** | [繁體中文](2026-09-29-personal-workspace-knowledge-graph.zh-TW.md)

| Item | Content |
| --- | --- |
| Date | 2026-09-29 |
| Design specification | [`2026-09-29-personal-workspace-knowledge-graph-design.md`](../specs/2026-09-29-personal-workspace-knowledge-graph-design.md)(all §n references below refer to it) |
| Prerequisites | Phase 0–5, document share links, and keyboard shortcuts (PR #52–#60) are already on `main` |
| Baseline | Before work: unit 427, integration 444, and e2e 91 all passed; `tsc --noEmit` and `eslint .` were clean. After completion: unit 590, integration 486, and e2e 105([verification](../verification/2026-09-29-personal-workspace-knowledge-graph-verification.md)) |
| Branch | `claude/keen-cannon-7axign`; One commit series per slice, independently revertible |

## 0. Shared Rules

- Run `make verify` (unit + typecheck + lint + build) **at the end of every slice**; DB slices also run `make test-integration`; UI slices also run the relevant e2e tests (`make test-e2e` requires `make browsers` and local MariaDB).
- **Write tests before implementation** for all pure functions (extraction, slugs, resolution, graphs, and layout): they hold this plan's core risks and are the easiest parts to pin down with tests.
- **Use only token names** (`text-body`, `rounded-md`, `shadow-popover`, …); `tests/unit/design-tokens.test.ts` and `eslint.config.mjs` reject violations.
- **Do not add a revision-producing path without indexing it**; `tests/integration/link-index-write-points.test.ts` (slice 2) enforces this through a source scan.
- Update the §Verification table (at the end of this file) after every slice, and produce a verification record at the end.

## 1. Slice 1 — TOC and Heading Anchors (No Data Changes)

| # | Task | Files | Tests |
| --- | --- | --- | --- |
| 1.1 | Explicitly declare `unified` and `remark-parse` (matching the existing lockfile versions), with shared parsing configuration `parseMarkdown(markdown)` (remark-parse + remark-gfm) | `package.json`, `src/shared/markdown/parse.ts` | `tests/unit/markdown-parse.test.ts` |
| 1.2 | `headingSlug`, `assignHeadingSlugs(tree)`(GitHub-compatible, CJK, duplicate suffixes) | `src/shared/markdown/heading-slug.ts` | `tests/unit/heading-slug.test.ts`: English, CJK, punctuation, duplicates, empty, overlong, inline code/emphasis/GFM strikethrough |
| 1.3 | `extractOutline(markdown)`(depth 1–4, limit 200, indentation depth) | `src/shared/markdown/outline.ts` | `tests/unit/markdown-outline.test.ts`: skipped heading levels, `#` within code fences, setext headings, empty documents |
| 1.4 | `remarkHeadingIds` plugin wired into `MarkdownRenderer`; add `scroll-mt-4` to headings | `src/components/knowledge/markdown-renderer.tsx` | `tests/unit/markdown-renderer-headings.test.tsx`: each rendered `id` matches `extractOutline` |
| 1.5 | `useActiveHeading(ids, scrollRoot)`(IntersectionObserver), `DocumentOutline`(`nav` + `ol`, `aria-current`, reduced motion) | `src/components/knowledge/use-active-heading.ts`, `document-outline.tsx` | Structural tests render components with `react-dom/server`; scroll synchronization is covered by e2e |
| 1.6 | Layout: rail (`min-[1280px]`, when inspector is closed), inspector “Outline” tab, narrow-screen `<details>`; the document page passes down the selected revision's outline | `document-inspector.tsx`, `[documentId]/page.tsx`, `document-viewer.tsx` | e2e `tests/e2e/reading-outline.spec.ts` |
| 1.7 | Scan existing `id=` usage to confirm no heading ID collisions (risk in §15) | — | One-time check; record results in verification |

**Acceptance:** See §13 slice 1. `make verify` passes; e2e: four headings produce four TOC entries, clicking the third changes `location.hash` and brings it into view, fewer than two headings shows no TOC, and historical revisions display their own TOC.

## 2. Slice 2 — Link Model and Index(migration 012)

| # | Task | Files | Tests |
| --- | --- | --- | --- |
| 2.1 | Domain: `extractDocumentLinks`, `ExtractedLink`, `LINK_EXTRACTOR_VERSION`, limit constants | `src/modules/knowledge/domain/document-links.ts` | `tests/unit/document-links-extract.test.ts`: every row of the §5 rules table (wikilink forms, aliases, fragments, `#^block`, ignore embeds, ignore inside code/inline code/html, `\|` in GFM tables, relative `.md`, URL encoding, ignore external/non-md/pure anchors, limits, line numbers, order) |
| 2.2 | Domain: `normalizeLinkKey`, `buildResolver(catalog)`(`resolveWiki`, `resolvePath`), deterministic ranking | `src/modules/knowledge/domain/link-resolution.ts` | `tests/unit/link-resolution.test.ts`: titles/filename stems, path suffixes, same-Source preference, exact-match preference, total tie-break ordering, relative `..`, root escapes, case-insensitive fallback, self-links, archived entries absent from catalog |
| 2.3 | Migration `012-document-link-index`(§7.1); register in `migrations/index.ts` | `migrations/012-document-link-index.ts`, `index.ts` | `tests/integration/link-index-schema.test.ts`: tables and FKs, `ck_kind`, `RESTRICT`, child insertion rejected when marker row is absent; synchronize the `phase1-migration-runner` version list |
| 2.4 | Port `DocumentLinkRepository`(`replaceForDocument`, `loadCatalog`, `loadValidEdges`, `countIndexState`, `listStaleDocuments`, `loadCurrentMarkdown` ) and MariaDB implementation; add to `KnowledgeRepositories`/`createRepositories` | `ports/document-link-repository.ts`, `repositories/document-links.ts`, `ports/unit-of-work.ts`, `repositories/index.ts` | `tests/integration/link-index-repository.test.ts`: replace rather than append, consistent `link_count`, validity (revision mismatch/outdated version), catalog contains only ACTIVE entries scoped to Workspace |
| 2.5 | Wire `links.replaceForDocument` into four write points (no rebuild on NOOP) | `create-document.ts`, `create-revision.ts`, `source-knowledge-projection-service.ts`(two locations) | `tests/integration/link-index-write-points.test.ts`: One for each of four paths; scan source so files with `revisions.insert(` must also contain `links.replaceForDocument`; add `links` to the `phase2-import-apply-perf` stub |
| 2.6 | Extract `requireVisibleDocument` (unchanged behavior), and use it in `KnowledgeQueryServiceImpl` | `application/internal/require-visible-document.ts`, `knowledge-query-service.ts` | Existing `phase1-query` and `phase1-workspace-access` remain unchanged and passing |
| 2.7 | `KnowledgeLinkService.getDocumentLinks`(outgoing calculated on demand, backlinks from edges, context, index state); register in composition root | `application/knowledge-link-service.ts`, `src/server/composition.ts` | `tests/integration/knowledge-link-service.test.ts`: reject non-members; cross-Workspace links do not resolve and are indistinguishable from nonexistent links; archived sources absent from backlinks; outgoing for historical revisions; context truncation; index links from `SOURCE_MANAGED` sources too |
| 2.8 | `scripts/db/reindex-document-links.ts`, `npm run db:reindex-document-links`, `make db-reindex-links`; message at the end of `db:migrate` | `scripts/db/`, `package.json`, `Makefile` | `tests/integration/link-index-reindex.test.ts`: reindex restores everything after index clearing; idempotent; when racing a concurrent save, the index always corresponds to the revision that ultimately becomes current (read revision only after locking the document) |
| 2.9 | Operations instructions: deployment order and reindex (migration → reindex → enable access) | `docs/operations/document-link-index-rollout.md` | — |
| 2.10 | Domain: Graph and backlink builders(`resolveEdges`, `buildWorkspaceGraph`, `buildLocalGraph`, `backlinksTo`)and `linkContext` — originally scheduled in slice 4, moved earlier because the service needs them | `link-graph.ts`, `link-context.ts` | `link-graph.test.ts`, `link-context.test.ts` |

**Acceptance:** See §13 slice 2. `make verify` and `make test-integration` pass.

## 3. Slice 3 — Link Rendering and Backlinks

| # | Task | Files | Tests |
| --- | --- | --- | --- |
| 3.1 | `remarkKnowledgeLinks` plugin: turn `[[…]]` into link nodes with `data-kh-wikilink`; add optional `links` prop to `MarkdownRenderer` (key → resolution result); output plain text without `links` | `src/shared/markdown/remark-knowledge-links.ts`, `markdown-renderer.tsx` | `tests/unit/markdown-renderer-links.test.tsx`: resolved/unresolved/ambiguous outputs; aliases, fragment→`#slug`; relative `.md` links; plain text without `links`; no conversion inside code; `data-*` attributes reach the `a` component |
| 3.2 | The document page calls `getDocumentLinks`, passing resolution results to the viewer; add `getDocumentLinkModel` alongside `getKnowledgeDocumentModel` | `src/server/link-graph-read.ts`, `[documentId]/page.tsx`, `document-viewer.tsx` | e2e |
| 3.3 | `DocumentLinksPanel`(inspector “Links” tab: Backlinks/Outgoing/Unresolved; index updating notice) | `document-links-panel.tsx`, `document-inspector.tsx` | Structural tests + e2e |
| 3.4 | `BacklinksFooter`(“Linked from N documents”, with context) | `backlinks-footer.tsx` | e2e |
| 3.5 | Action registry: `document.backlinks` (palette only); `kh:request-details` event carries `tab`, and inspector tabs become controlled | `action-registry.ts`, `action-menu.tsx`, `document-inspector.tsx` | `tests/unit/action-registry.test.ts`(+5) |
| 3.8 | Cross-document heading anchors: Next client navigation completes hash scrolling while the document is still a Suspense skeleton; instead scroll to the heading using the URL hash after document mount (found by e2e) | `use-scroll-to-hash.ts` | `reading-links.spec.ts` case 4 |
| 3.6 | Keep share pages as plain text and add a guard test: the `s/[token]` tree does not import the link service | `tests/unit/share-link-single-exception.test.ts`(one new case) | Same as left |
| 3.7 | Seed fixtures: add several mutually linked documents to Query Master for e2e and manual verification | `scripts/db/seed.ts` | e2e |

**Acceptance:** See §13 slice 3; `tests/e2e/reading-links.spec.ts`.

## 4. Slice 4 — Graph

| # | Task | Files | Tests |
| --- | --- | --- | --- |
| 4.1 | Explicitly add `d3-force` (server only) and `@types/d3-force` | `package.json` | — |
| 4.2 | Domain: `buildWorkspaceGraph`(nodes, merged edges, degree, orphans, unresolved nodes, limits and truncated), `buildLocalGraph`(BFS, depth, 60-node limit) | `src/modules/knowledge/domain/link-graph.ts` | `tests/unit/link-graph.test.ts` |
| 4.3 | `layoutGraph`(fixed seed, sorted by id, fixed ticks) | `src/lib/graph/layout.ts` | `tests/unit/graph-layout.test.ts`: same coordinates for same input, finite values, minimum non-overlap spacing, single-node/empty graphs, 1000-node time limit |
| 4.4 | `KnowledgeLinkService.getWorkspaceGraph`/`getLocalGraph` | `knowledge-link-service.ts` | `tests/integration/knowledge-link-graph.test.ts`: authorization, Source filtering, archived exclusions, cross-Workspace absence, limits |
| 4.5 | `GraphCanvas`(SVG, pan, zoom, hover highlighting, SVG `<a>` nodes), `GraphControls`, `GraphListView` | `src/components/knowledge/graph-*.tsx` | Structural tests + e2e |
| 4.6 | Page `/w/[workspaceId]/graph`(search params: `source`, `orphans`, `unresolved`, `focus`), `loading.tsx`, error boundary | `src/app/w/[workspaceId]/graph/` | e2e |
| 4.7 | inspector Local graph, “Open in graph”; primary navigation “Graph”; `navigate.graph` action | `document-links-panel.tsx`, `primary-nav.tsx`, `action-registry.ts` | Update registry tests |
| 4.8 | Empty state, index updating, truncated notices | `graph-*.tsx` | e2e |

**Acceptance:** §13 slice 4 and overall acceptance scenarios; `tests/e2e/workspace-graph.spec.ts`.

## 5. Wrap-up

- Add this specification and plan to README “Current status” and “Current canonical documents”; add a row to the roadmap document status table; add a short paragraph after Invariants in `CLAUDE.md` (link indexes are derived data, and new revision-producing paths must be indexed).
- Frontend Design Language §18: update item 1 (palette only navigates) to record the two new actions; leave the rest unchanged.
- Verification record `docs/superpowers/verification/2026-09-29-personal-workspace-knowledge-graph-verification.md`: What ran in each slice, results, measurements (§14), and unmet items.

## Verification(Fill as Work Progresses)

| Slice | unit | integration | e2e | build | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 TOC | 462(+35) | Unaffected | `reading-outline.spec.ts` 4/4 | Passed | 1.7 checked: application IDs (`tree-filter`, `search-q`, etc.) may match heading slugs, so outline lookup is scoped to `article` rather than page-wide `getElementById` |
| 2 Index | Main additions: extract 28, resolution 25, graph 19, context 8, write-points 2 | 444 → 485(link-index 18, reindex 5, service 18; later local graph adds 1 → 486) | Unaffected | Passed | Add `links` to performance test stubs and assert exactly one index write per document (verified that removing the hook causes failure) |
| 3 Rendering/Backlinks | Main additions: renderer links 19, registry +5, shared-page guard +1 | Unaffected | `reading-links.spec.ts` 5/5(including a real `/s/:token` with no `/w/` links) + outline 4/4 | Passed | Visually checked UI (rail, resolved/unresolved links, Linked from, Links tab); integration covers folder-sync relative `.md` links; no e2e import flow performed |
| 4 Graph | Main additions: graph-layout 11, graph-model 8 | 486(+1: local graph returned with getDocumentLinks) | `workspace-graph.spec.ts` 5/5; **Full suite 105/105** | Passed | Layout of 1000 nodes takes approximately 1.0 s; see verification §4 for the `prefetch` pitfall and e2e file order |
