# Shared review UX fixes — verification (2026-11-24)

Evidence from local runs on branch `claude/bold-hopper-g94jl2` (base `22bc2cc`), Linux, MariaDB on 127.0.0.1:3307.
Design: [inline review spec](../specs/2026-10-09-shared-personal-document-inline-review-design.md), 2026-11-24 amendments.
No CI result is claimed here.

Screenshots are 1280×720 (phone: 390×844) at deviceScaleFactor 2, light theme, taken by a temporary
Playwright spec run through `scripts/test/e2e.ts`: *before* on a `git worktree` of `origin/main` (`22bc2cc`),
*after* on this branch. The spec was deleted afterwards.

## 1. A keyboard way to start a comment

Tab from the title. Before, focus skips past the article (no stop in it); after, each paragraph has a
**Comment on paragraph** button in the article's left padding, and Enter opens the composer, focused.

| Before | After |
|---|---|
| ![Desktop, Tab from the title: no stop in the article](2026-11-24-shared-review-ux/fix1-desktop-before.png) | ![Desktop, Tab from the title: the first paragraph's Comment button is focused](2026-11-24-shared-review-ux/fix1-desktop-after.png) |
| ![Desktop, Enter: nothing to comment on](2026-11-24-shared-review-ux/fix1-desktop-enter-before.png) | ![Desktop, Enter: the composer opens on the paragraph, focused](2026-11-24-shared-review-ux/fix1-desktop-enter-after.png) |
| ![Phone, Tab from the title](2026-11-24-shared-review-ux/fix1-phone-before.png) | ![Phone, Tab from the title: the paragraph's button is focused](2026-11-24-shared-review-ux/fix1-phone-after.png) |

## 2. The passage stays marked while the comment is written

| Before | After |
|---|---|
| ![Composer open; the passage is not marked](2026-11-24-shared-review-ux/fix2-desktop-before.png) | ![Composer open; the passage is marked with the draft highlight](2026-11-24-shared-review-ux/fix2-desktop-after.png) |

## 3. The header actions stay under the pointer

The red dot is where the pointer was when Comments was clicked (1280px), drawn before the click.

| | Before | After |
|---|---|---|
| Closed | ![Closed, before](2026-11-24-shared-review-ux/fix3-closed-before.png) | ![Closed, after](2026-11-24-shared-review-ux/fix3-closed-after.png) |
| Open | ![Open, before: the dot is over Download](2026-11-24-shared-review-ux/fix3-open-before.png) | ![Open, after: the dot is still over Comments](2026-11-24-shared-review-ux/fix3-open-after.png) |

## 4. Failures say what to do; Cancel asks

| | Before | After |
|---|---|---|
| (a) failed post | ![Plain "Something went wrong."](2026-11-24-shared-review-ux/fix4a-post-error-before.png) | ![Danger-coloured alert with icon: "Couldn't post your comment. Something went wrong. Try again."](2026-11-24-shared-review-ux/fix4a-post-error-after.png) |
| (b) panel load error | ![No Retry in the open panel](2026-11-24-shared-review-ux/fix4b-load-error-before.png) | ![Retry beside the error](2026-11-24-shared-review-ux/fix4b-load-error-after.png) |
| (c) document changed | ![No way to refresh](2026-11-24-shared-review-ux/fix4c-changed-before.png) | ![Refresh page beside the notice](2026-11-24-shared-review-ux/fix4c-changed-after.png) |
| (d) Cancel with text | ![The text is gone at once](2026-11-24-shared-review-ux/fix4d-cancel-before.png) | ![Discard this comment? Keep writing / Discard comment](2026-11-24-shared-review-ux/fix4d-cancel-after.png) |

## 5. Sign-in keeps the passage; sign-in said once

The *returned* shots carry the tab's `sessionStorage` from the anonymous origin to the signed-in persona's
origin by hand (one origin in production; separate ports in the e2e harness).

| | Before | After |
|---|---|---|
| Anonymous panel | ![Sign in to add a comment. above Sign in to comment](2026-11-24-shared-review-ux/fix5-anonymous-before.png) | ![Sign in to comment, once](2026-11-24-shared-review-ux/fix5-anonymous-after.png) |
| Back signed in | ![At the top, no composer](2026-11-24-shared-review-ux/fix5-returned-before.png) | ![Composer open on the chosen passage, focused](2026-11-24-shared-review-ux/fix5-returned-after.png) |

## 6. A card jumped to clears the rail's toolbar

1280×520, Next open pressed twice.

| Before | After |
|---|---|
| ![The card's quote and author line under the toolbar](2026-11-24-shared-review-ux/fix6-next-open-before.png) | ![The card below the toolbar, whole](2026-11-24-shared-review-ux/fix6-next-open-after.png) |

## Checks

| Check | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit -p .` | exit 0 |
| Lint | `npm run lint` (`eslint .`) | exit 0 |
| Unit | `npx vitest run --config vitest.config.ts` | exit 0; 420 files, 5657 tests |
| E2E | `npx tsx scripts/test/e2e.ts tests/e2e/shared-review.spec.ts tests/e2e/review-*.spec.ts tests/e2e/zz-review-mentions.spec.ts tests/e2e/share-comment-notify.spec.ts tests/e2e/share-page-header.spec.ts tests/e2e/owner-review.spec.ts tests/e2e/shared-review-keyboard.spec.ts tests/e2e/shared-review-errors.spec.ts --trace off` | exit 0; 90 passed (plus the 6 screenshot tests) |
| New e2e against `origin/main` | the new and changed specs copied into the `22bc2cc` worktree | 12 failed, 12 passed: every new case fails except the no-button guard for anonymous readers and the marker-path clearance case (a regression guard; main already ended clear there) |

`tests/unit/share-link-single-exception.test.ts` passes unchanged: no new caller-less entry. The paragraph
button and the kept sign-in passage reach only the composer; every write is still the existing
trusted-caller request.
