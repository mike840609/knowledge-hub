# Folder Sync first wave: from synchronization to reading

**English** | [繁體中文](2026-10-03-folder-sync-first-wave-design.zh-TW.md)

Status: user confirmed the design; implementation plan awaiting review, not yet implemented.
Baseline: main `15c8b7786239735ece7112bb663760346b33a580` (PR #104).

## Goal and chosen direction

Implement the first-wave workflow requested by the user: import a folder → find and understand knowledge → inspect differences → apply confidently → return to read updates.
Keep existing lightweight lists, compact PageHeader, design tokens, and workspace authorization. Do not turn Home into a large card dashboard.

The first wave has five stages, all required for final delivery. Stages may be verified independently, but changing Home copy alone is not completion.
Reuse existing search, favorites, recent reading, graph, and sync buttons, completing connections between them rather than rebuilding them.

The user explicitly chose to defer images. This wave adds no image binary storage, rendering, or missing-image diagnostics; binary attachment service remains future work. Keep existing image security policy and do not claim complete local-image support.

## Code inventory

- `personal-home.tsx` currently emphasizes New note, Continue writing, and Recently edited.
- Personal Home already receives document summaries and drafts; recent reading is device-local, while favorites use account synchronization.
- `ImportPreview` provides paths, labels, and summaries, but no body diff.
- Apply returns sourceId/resultVersion/runId, but success navigates to source detail.
- `SyncRun.summary` stores counts and snapshotHash/planHash. Terminal staging lasts 24 hours and cannot serve as permanent history.
- Lists already have formal applied time, individual sync, progress, and Retry. Forms/lists need consistent states, cancellation, and error explanations.
- Attachments store metadata/hash only; upload accepts Markdown bytes only. The image renderer does not resolve source-relative paths to authorized asset endpoints.
- `PersonalService` validates draft/favorite keys but has no read-revision contract.

## Alternatives

Recommended: deliver stages of one sync-to-reading workflow. First establish permanent sync changes and revision references, then connect Home, success, history, and Updates to that data.

Alternative 1: change only Home and success messages. Smaller development effort, but no durable history or trustworthy unread updates; does not satisfy this wave.
Alternative 2: rewrite Home, import, and reader together. Excessive scope risks shortcuts, source read-only behavior, and authorization; rejected.

## 1. Reading-oriented My Space

Page order: Search → My folders → Continue reading → Updates → Favorites → other entry points.

- Search reuses workspace search and defaults to current My Space; no duplicate engine.
- Primary CTA is Import folder; New note, drafts, organize, and export retain clear secondary entry points.
- My folders lists only Folder Sync sources: name, last formal sync, awaiting-apply/failure/access-renewal hints, and Check for changes.
- Home folder actions reuse compact source-list actions, preserving 12°/10% hover and busy rotation, permission gates, and folder-selection fallback.
- Recently updated uses formally applied, currently readable article updates, never local drafts or scans as sync results.
- Same-title articles show source and relative path on Home, Updates, and search results.
- No sources guides import; no updates shows a quiet empty state, without fabricated demo data.
- Awaiting-apply information comes only from valid READY previews readable by the current user. Unreadable/invalid snapshots must not leak another user's information.

## 2. Content diff and sync safeguards

### Body, title, and metadata differences

Updated documents, including renamed/moved+updated, can expand read-only differences. Compare added/deleted lines and separately title/metadata. Pure moves may show before/after paths.
Do not modify source-managed documents or execute raw Markdown as HTML.

Fetch diffs lazily per article; never put every body in a 20,000-entry preview JSON. Read only the requested change from an authorized snapshot.
Old body comes from the plan's expected revision; new body from its staged upload key. Return basedOnVersion and revision references.
Expired previews or changed sources disable Apply and explain that differences reflect that scan and require another check.
Bound computation/output to 2,000 lines or 200 KiB of presentation. Beyond this, show truncation notice and read-only before/after text, avoiding unbounded quadratic work without deleting changes.

### Wrong folder and mass archiving

Show previous active document count, current count, matched count, archive count, and ratio.
Match canonical paths or existing stable external identities; confirmed moves must not count as low overlap. rootName is only a hint.

Any condition below is high risk:

- Existing documents but zero current documents.
- At least 5 archives and at least 30% of existing active documents.
- At least 5 existing documents, below 20% matches, and any planned archives.

High-risk previews clearly warn and require entering the source name before Apply to confirm intended scope. Archiving all of a small source also requires confirmation.
Validate risk and acknowledgment on the server, not merely through a checkbox. Bind acknowledgment to snapshot/plan hash; one preview's confirmation cannot authorize another.
Normal previews retain one-step Apply without generic confirmation. Initial thresholds are product settings subject to later usage feedback.

### States and recovery

Use consistent terms: Checking → Awaiting Apply → Synced / Failed / Folder access needed.
Rename the entry to Check for changes, with tooltip explaining that scanning alone changes nothing until Apply.
Lists and Home offer cancellation using existing AbortController/import cleanup, without canceling submitted Apply.
Scan failure states no changes applied and offers Retry/Choose folder. Apply failure describes transaction outcome or re-queried status; never universally claim no changes.
Distinguish expired preview from source version conflict and offer Check again for both. Lost Apply responses recover through existing idempotent results.

## 3. Permanent sync changes and reading after success

Add indexable run-change storage rather than full bodies in summary JSON. Each change retains:

- Run/source/workspace references and a sortable key.
- Kind, labels, before/after source paths, title at the time.
- documentId, beforeRevisionId, afterRevisionId; non-document changes fabricate no document reference.

Successful Apply writes changes and formal outcome in one transaction; rollback leaves no successful Updates. Retry/alreadyApplied creates no duplicate events.
History references canonical immutable revisions, supporting reading/comparison after snapshot cleanup. Persist necessary warning code/path summaries, not staging credentials or directory handles.
Do not invent per-document information for legacy history. Summary-only old runs explicitly say they have no article-change details.

Success navigates to the run summary, displaying additions, updates, moves, archives, warnings, and:

- Read this update: list this run's added/updated articles.
- Browse this folder: existing Knowledge explorer scoped to source.
- Back to My Space: PERSONAL returns Home; TEAM uses its workspace entry, without assuming PersonalHome.

APPLIED runs in source history open the same page. Articles can open historical revisions and differences without forcing current revision.
Archived articles follow existing includeArchived authorization. If a document/revision is genuinely unreadable, show unavailable without exposing content.

## 4. Markdown folder reading contract

Relative Markdown links and wikilinks reuse existing resolution/stable Document IDs. Add acceptance for same titles, subfolders, moves, and unresolved cases.

Reading quality in this wave covers Markdown text, titles/metadata, relative article links, wikilinks, disambiguation, and source paths. Images retain existing behavior, with unsupported parts explicitly listed in acceptance reporting.

## 5. Updates and source health

### Updates

Group by formal APPLIED run, filter by source/unread, and show added/updated counts, articles, source, paths, and time.
Determine content updates through revisions. Moves/archives are not automatically new reading content, but remain visible in run summaries.

Add account-level read-revision state tied to user/workspace/document. Server verifies that the revision belongs to that readable document.
After current reader body renders successfully, mark the current revision read. Historical reading marks only that historical revision, not current.
Use document revision sequence or equivalent stable ordering, not timestamps: reading a newer revision marks older events read; another update becomes unread.
An older read on another device/tab cannot regress progress. Do not repurpose favorites API; cross-device recent-reading sync remains future scope.
Home shows the latest 3 batches, at most 5 articles each. Full Updates uses cursor pagination (20 batches), avoiding loading all history on Home.

### Source health

Source detail provides Health, collecting current documents' unresolved links and latest valid import warnings.
Each item opens its article and shows reason/relative path. Diagnostics neither block ordinary reading nor automatically edit sources.
Paginate and batch-query existing links/warnings; avoid reparsing every Markdown body on Home.
All data follows source/workspace permissions and includes only documents readable by the current user.

## Delivery order and regression boundaries

1. Permanent run-change/read-revision contracts, migration, authorized reads.
2. Diff, high-risk confirmation, accurate states, cancellation/recovery, result page.
3. Connect Home/My folders/Updates to formal data.
4. Source health and Markdown/internal-link reading acceptance.
5. Full regression and before/after screenshots.

Preserve source-managed read-only behavior, workspace permission gates, keyboard navigation, favorites/drafts, Team source flows, and atomic Apply.
Do not add automatic background sync, CLI, MCP, AI Chat, Collections, new path/date search filters, or a share-management page. Image/attachment binaries are separate future work.

## Verification and screenshots

- Domain/unit: metadata diff, risk thresholds/empty folders/stable moves, states/cancellation, read-revision monotonicity, source path resolution.
- Real MariaDB integration: Apply rollback/idempotency, durable changes after staging cleanup, historical revisions, read-marker authorization, server-enforced risk acknowledgment.
- E2E: initial import → success summary → read → rescan → diff → high-risk refusal/confirmation → Apply → unread Updates → read status; same-title and relative-link cases.
- Full unit/integration, relevant Team/Personal E2E, typecheck/lint/production build. Report actual scope and unresolved failures.
- Before/after comparisons use baseline main `15c8b77`, identical demo data, 1440px light viewport, same browser/locale. Do not write demo fixtures into user data.
- Capture at least Home, preview body diff/high-risk warning, Apply summary, Updates, source health, and reader. Label new pages as absent before and compare the nearest original-flow screen.
- Hover/cancellation recordings are optional; screenshots do not replace functional verification.

Acceptance: users can import their own folder, find and understand articles, inspect later differences and avoid mistaken archives, identify new knowledge after Apply, and revisit sync history after staging cleanup.
