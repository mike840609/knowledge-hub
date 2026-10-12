# PR #168 review follow-up — 2026-10-12

## Scope and integration

Merged `origin/main` (including #167, `9c2dc6b`) into `codex/shared-review-comment-rail`. The sole conflict in `src/app/s/[token]/page.tsx` keeps main's SaveShareButton and wrapping header actions together with the review layout's `kh-share-heading` scope. No review permission or persistence/API contracts were broadened.

## Findings addressed

1. Revision mismatch now disables only new selection and passage mapping; replies retain server-derived write authorization.
2. Escape inside either comment form prevents panel/modal dismissal. Compact desktop cards retain their reply form state.
3. Focusing the expansion control does not remove it. Explicit activation moves focus to the stable thread section before expansion.
4. Range resolvers project Markdown once and produce reusable DOM ranges. Resize measurements no longer parse Markdown per thread. A 400-paragraph/20-range test checks the projection call count and mismatch safeguards.
5. The rail remeasures its origin after React commits, including composer insertion; a browser assertion checks active-card alignment while the composer is open.
6. The Comments entry's accessible name includes the thread count.
7. Query errors/retry and stale-revision notices remain visible while collapsed. Supported selection exposes a Comment entry that captures its anchor before opening the rail/drawer.
8. Canonical review spec §4.0.1 and the frontend design language now record the approved reading-first layout, geometry, themes, focus and stale-revision behavior. This is a follow-up amendment; the original implementation lacked that written amendment.

Minor corrections include registered `rounded-sm`, symmetric article gutters, a single drawer-completion focus owner (also checked with reduced motion), an explicit ready/expanded test helper, and unit cases for a single card, dense same-passage cards and the active final card.

## Validation

- Full unit suite: 180 files / 2,146 tests passed.
- Full integration suite against an isolated MariaDB database: 79 files / 716 tests passed.
- Full-project ESLint passed; `git diff --check` passed.
- The E2E harness builds both local and trusted-SSO applications in production mode, including type checking.
- Browser suite covers shared review, anchors, owner moderation, responsive layout and saved shares, including keyboard/drafts, outdated threads, collapsed selection/notices, composer alignment, reduced-motion focus and mobile SaveShareButton interaction. Final integrated-tree run: 21/21 passed; artifact run `4414eed8-9946-4210-9acb-706481a89bb9` (72.30 seconds including both builds).
- First browser pass: 19 passed / 2 failed. The new helper could not find an inert background entry after modal opening; it now explicitly locates that background entry for expanded-state checks. The new save interaction test left a saved item behind; it now cleans that item in `finally`. Existing saved-share count assertions were retained. A second pass exposed a missing Origin on that cleanup request; the server correctly rejected it, and the test now supplies Origin.
- The visual detector's sole warning is the pre-existing literal `<img class="ProseMirror-separator">` inside a CSS comment at `globals.css:229`; it is not a rendered image.

GitHub's full gate is rerun on the updated PR head. Earlier pre-merge CI results are not used as evidence for this integration.
