# Shared personal document inline review — verification

Implementation: 2026-10-09. Final verification: 2026-10-10. Implementation branch: `codex/shared-document-inline-review`.

## Delivered scope

- Additive MariaDB migration 017, review thread/comment repositories and persistent rolling-hour write ledger. Scope derives from Document → Source → PERSONAL Workspace.
- Live share token review reads for anonymous and signed-in holders; trusted caller required for thread creation and replies. Owner reads, replies, resolve/reopen and hide/unhide use derived ownership independently of token expiry.
- Source-serialized quotas, creation/reply unique idempotency keys, canonical hashes and exact replay before stale-revision rejection; no Markdown/revision writes from review paths.
- AST UTF-16 selection anchors, bounded conservative relocation, unknown-field allowlisting, hidden thread suppression and outdated historical-quote exclusion. Unsupported renderer-dependent selections fail closed.
- Private/no-store review HTTP, same-origin POST validation and explicit no-session 401 versus unavailable-provider 503. The native Request URL preserves the original authority when NextRequest normalizes loopback hosts; hostname aliases remain distinct.
- Reviewer rail/mobile drawer, owner moderation, plain-text comment rendering, filters/timestamps and bidirectional current-quote/discussion navigation. CSS Highlight API highlights supported current selections without modifying Markdown DOM; quote buttons remain available in browsers without that API.
- Test-only separate persona servers, no-session reader and unconfigured identity origin; no browser-provided user identity.

Tests consolidate the planned access/write/owner integration cases in `document-review-service.test.ts`; actual Folder Sync and revocation races are independently covered in `document-review-sync.test.ts`. The existing anonymous renderer/non-expansion guards remain intact.

## Observed validation

| Check | Result |
| --- | --- |
| Final whole unit run | PASS — 172 files, 2,058 tests |
| Focused HTTP tests including real NextRequest origin normalization | PASS — 11 tests |
| Latest whole MariaDB integration run | PASS — 75 files, 695 tests |
| Typecheck after native Request URL fix | PASS |
| Whole ESLint after highlight integration | PASS |
| `make verify` final combined gate | PASS — unit tests, TypeScript, ESLint, production build |
| Focused reviewer/owner/anchor browser flows | PASS — 7 tests; expanded identity/workspace regression: 20 tests |
| Whole browser regression suite | PASS — 292 passed, 2 skipped, 0 failed (294 tests) |
| Personal-only rollout smoke | PASS — 3 tests, including both cases skipped in the Team-enabled suite |

Whole MariaDB coverage includes exact concurrent retries, reordered JSON fields, changed-payload conflicts, cross-document isolation, revoked retries, archived owner moderation, hidden body/quote/reason suppression, audit rollback, 200 visible threads, 20 open threads per creator, 100 lifetime replies including hidden replies, and persisted hourly rate limits. Real Folder Sync preserves discussion identity, reanchors unchanged passages, suppresses removed quotes and rejects new stale-revision writes.

The first browser runs exposed `Origin:null` under the share page's no-referrer policy and NextRequest loopback normalization. Review fetches now explicitly use origin-only referrers (never the token path), and server validation reads the original native Request URL. All eight review routes explicitly use force-dynamic to avoid Next auto-mode Request proxies and preserve request-bound behavior. A rebuilt browser run passed all seven focused flows. Passage navigation focuses the element before setting its Range so focus cannot collapse the selected quote.

Final browser regression also confirmed the original anonymous share flow. Review fixtures use a dedicated trusted `reviewOwner` persona to preserve existing new-user empty-state tests. Anchor assertions wait for actual Markdown rendering; identity harness assertions verify the deliberate `503 AUTH_UNAVAILABLE` contract. Desktop and 390px mobile screenshots were inspected, including the completed drawer animation. After the fixture change, 27 focused identity/harness unit tests passed; the final E2E build reran TypeScript and lint checks. Two personal-only cases were skipped in the Team-enabled suite; both passed in the separate personal smoke run. The existing new-note draft smoke now opens the current Drafts tab before finding its resume link, replacing its obsolete standalone-region selector. Generated unrelated UI comparison screenshots were removed from the change.

## Rollout and rollback

1. Back up the database, apply additive migration 017, then deploy the application.
2. Set `KM_PUBLIC_ORIGIN` to the origin browsers use (for example `https://km.example.com`) on any deployment behind the Gateway. Without it every review request, anonymous reads and owner moderation included, is refused with `403 REVIEW_ORIGIN_DENIED`, because the server compares `Origin` with its bind address. This was found in review on 2026-10-10 and is covered by unit tests only; no run has yet gone through a real proxy.
3. Keep `KM_REVIEW_WRITES_ENABLED=false` by default. Existing reads and owner moderation remain available with writes disabled. Turning the flag off blocks new threads and all new replies, including owner replies; exact successful retries create no new data.
4. Corporate Gateway passive authentication, spoofed-header stripping, upstream protection, real verified session reader and nonce/cookie login continuation remain separate company deployment gates. Local persona success does not prove enterprise authentication.
5. For rollback, disable new writes first and roll back application code as needed. Preserve review and audit tables. Schema deletion requires separate maintenance and backup authorization; no destructive automatic down migration exists.
6. Hiding is projection redaction, not physical erasure of stored rows or backups.

Operator ledger cleanup defaults to dry-run:

```sh
npx tsx scripts/admin/cleanup-document-review-write-events.ts --target=dev
npx tsx scripts/admin/cleanup-document-review-write-events.ts --target=dev --apply
```

Cleanup retains at least 48 hours and deletes in batches of at most 1,000. It only removes expired rate-limit events, never discussion/audit history.

## Review

Independent reviews inspected service authorization/locking, schema and adapter uniqueness, safe projections, runtime input boundaries and DOM mapping. Findings corrected before final verification include unknown anchor metadata preservation, oversized end-offset acceptance, owner Origin checks after account provisioning, canonical request hashes, exact conflict codes and document-position ordering.

The implementation remains local and reviewable; this record does not authorize or claim a corporate rollout.

## UI refinement — 2026-10-10

Following user feedback, simplify the review surface toward familiar document comments: one card per thread, compact author identity and timestamp, quoted passage and comment body. Remove the nested panel border, routine Open/Current passage labels, repeated access/selection explanations and permanent empty reply fields. Replies expand on demand; character counts appear only near the limit. Filters use one menu; owner resolve remains a labeled icon, and hiding/restoring stays in the accessible options menu with the existing confirmation. Mobile uses one Comments drawer heading and a single action row. Failed loads retain a retry control, and unsuccessful passage selection shows a contextual hint.

Validation on the refined UI: 9 focused Playwright tests passed (including compact desktop/mobile layout, reply expansion/cancellation, moderation, passage mapping, auth boundaries and mobile failure recovery); 7 client/selection unit tests passed. The E2E runner rebuilt both normal and trusted-persona apps with TypeScript/ESLint checks. Mechanical design detector returned no findings, and actual desktop/mobile screenshots were inspected. Earlier whole-suite results above describe the implementation before this UI-only refinement; no backend changes were made in this follow-up.

## Anonymous comment reading — 2026-10-10

User-approved access change: a live share token now grants read access to the current document and its visible discussion history, whether or not a reader is signed in. The exact query route uses an optional trusted caller and degrades absent/unavailable identity to anonymous read-only capabilities (`callerUserId: null`, `writesEnabled: false`). All creation/reply and owner routes retain mandatory authentication. Unexpected non-auth errors still fail rather than being swallowed. No broader Workspace/document/history/search access is granted.

Anonymous reads retain the same live-token validity checks, same-origin POST boundary, no-store responses, and reviewer projection redaction. Hidden threads, hidden reply bodies/reasons and outdated original quotes remain excluded. The share dialog and bilingual help explain that existing visible discussions are shared; the anonymous UI shows a concise sign-in-to-comment hint and no write controls.

Final validation for this access change: `make verify` passed with 172 unit files / 2,062 tests, TypeScript, ESLint and production build. Whole MariaDB integration passed with 75 files / 696 tests. Ten affected browser flows passed, including anonymous/no-session/unconfigured-SSO comment reads, refusal of anonymous thread/reply writes, revoked-token rejection, original anonymous document sharing, current anchors, owner moderation and mobile recovery.

The unconfigured-SSO browser case exposed identity-provider construction before optional-session handling. The query boundary now falls back only for typed authentication failures to a dedicated `reviewReadService()` projection, independent of identity-provider construction. Its exposed port is query-only; mutation boundaries continue to fail closed. A regression unit test covers this exact construction failure. Owner disclosure selectors also filter for visible controls to avoid matching a retained hidden route subtree. Earlier whole-browser results above precede this access change; the ten affected browser flows were rerun on the final implementation.

## Requested independent review — 2026-10-10

Two independent review passes inspected all local review changes: (1) security, service, schema and transactions; (2) UI, renderer mapping, document contracts and test coverage. No concrete security/service/schema findings were identified. One P2 UI defect was confirmed: renderer-generated accessibility text in external links and structural newlines in tight nested lists caused the global canonical DOM check to reject otherwise supported selections, even in unrelated paragraphs.

The defect was reproduced first with two failing unit regressions. The fix consistently excludes renderer-only accessibility/icon text from leaf comparison, selection offsets and highlight traversal, and removes tight-list structural trailing whitespace from leaf comparison. Added coverage includes after-link and spanning-link offsets, nested parent/child selection and highlights, and a real browser document containing both an external reference and a nested list. The independent UI reviewer rechecked the fix and independently observed all eight mapping tests passing; no concrete consequential residual was found.

Combined result after correction: `make verify` PASS (172 unit files / 2,065 tests, TypeScript, ESLint, production build); 10 affected Playwright flows PASS, including the new external-reference/nested-list regression. The earlier 696-test MariaDB result remains applicable because this correction changes only DOM mapping and tests. `git diff --check` PASS. No merge, commit, publication or production rollout was performed.

Unconfirmed performance observation: server `views()` reparses current Markdown per thread while holding the source lock. Worst-case large-document/200-thread latency has not been benchmarked; this is a coverage limit, not a confirmed review defect.

## Review follow-up correction — 2026-10-10

Addressed the repeated Markdown parsing observation: discussion views now use a request-scoped lazy anchor relocator, sharing one canonical block projection across threads in that query. No projection survives the query or crosses revisions. Existing matching, ambiguity, neighborhood, size limits and stale-quote redaction remain unchanged. A regression test verifies 200 mixed same/current-revision relocations invoke the Markdown parser once, and a separate revision invokes its own parse. This removes redundant parsing; worst-case end-to-end database/lock latency has not been benchmarked.

Validation: all 172 unit files / 2,066 tests passed; the focused anchor/DOM suite passed 18 tests; TypeScript, targeted ESLint and git diff --check passed. No browser or MariaDB rerun was performed for this internal projection reuse.

## 2026-10-10 review corrections

A review of the pull request found the defects below; these were corrected on the branch and run as follows.

- **Origin behind the Gateway.** Covered above under rollout step 2 (`KM_PUBLIC_ORIGIN`).
- **Reads held write locks.** The anonymous query and the owner's query locked the share link, the Source and the Workspace on every page load, so a reader could queue the owner's edits and Folder Sync. Reads now take no locks, as `readShared` never did; writes keep the §7 lock order. One MariaDB test holds all three rows `FOR UPDATE` in another connection and requires both queries to answer within three seconds.
- **Identity errors lost their reason.** `AUTH_UNAVAILABLE` replaced the readiness, session-reader and missing-field errors on every company-SSO route, with a message about document comments. The original error is now carried as `cause`, a failed readiness check logs its code, and the two messages name no feature. Status codes and error codes are unchanged.
- **The caller-less guard could not tell a required caller from `CallerContext | null`.** It now can; the unused `listForLink` is removed, and `queryForLink` is named as the one entry besides `readShared` that answers without a caller. `CLAUDE.md` says the same.
- **This specification contradicted its own 2026-10-10 amendment** in §3.1, §3.2, §4, §13.2 and the rollout checklist; those passages now agree that a live link reads visible discussion without signing in.
- **The link projection carried internal identifiers.** A link holder received `authorUserId`, `createdBy` and `documentId`, against share-link spec §6.1. The link projection now names people by display name only; the owner's projection keeps those fields. No component read them. A MariaDB test requires an anonymous query to contain no user, document, Source, Workspace or share-link ID.
- **Unread code removed.** `listForOwner`, `findByReplyKey`, `countReplies`, `creatorName`, four error codes nothing threw, and the `reviewLoginAvailable` flag and prop, a constant `false` that the panel accepted and never read; it returns with the login initiation it gates.

Run on the corrected tree: `make verify` (172 unit files / 2,099 tests, TypeScript, ESLint, production build) and the whole MariaDB integration suite (75 files / 697 tests) passed. The first CI browser run on these corrections failed two tests. One read `authorUserId` from a link response, the field the corrections remove; it now checks the author's display name and that the response holds no user ID. The other, in the recents palette, is outside this change and passed when run again locally. A local run then showed a third: the archive-moderation test read the thread immediately after clicking Confirm hide, which had only passed because the read used to queue behind the write's locks; it now asks until the write has landed. The four review browser files then passed five times over (50 runs), with the identity harness and recents files passing once. No whole browser suite was run locally, and nothing here has been exercised through a real Gateway. The per-thread and per-comment query pattern in the read path is unchanged and still unmeasured.
