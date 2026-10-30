# Review Mention Highlight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A real `@name` mention in a discussion comment is drawn in the link colour and opens a card with the mentioned person's `name`, `name_en`, `emp_id`, for signed-in and anonymous readers alike.

**Architecture:** The review read path (`DocumentReviewService.views`) attaches, per shown comment, the people its `review_comment_mentions` rows name (read live from `users`), filtered to those whose `@name` the body still contains. One pure splitter in the knowledge domain decides what counts as a mention occurrence; the server uses it to filter, `CommentBody` uses it to render buttons that open a Base UI Popover.

**Tech Stack:** Next.js 15, React, TypeScript, MariaDB, Vitest (unit jsdom + integration), Playwright, `@base-ui-components/react` 1.0.0-rc.0 (`popover`).

**Spec:** `docs/superpowers/specs/2026-10-30-review-mention-highlight-design.md`

## Global Constraints

- Base: `main` after PR #311 (comment layout: avatar column + content column, `Avatar`, `CommentBody`) has merged. Branch `feat/review-mention-highlight`.
- Card shows exactly `name`, then `name_en · emp_id` (`name_en` omitted when null). Never `account`, `org_code`, a user id, or a link.
- Mentioned people are carried only on a comment whose body the caller is shown: not on deleted comments, not on hidden comments in a reviewer view; yes on hidden comments in the owner view.
- No migration. No new route, query parameter or anonymous entry; `tests/unit/share-link-single-exception.test.ts` must pass unchanged.
- Body text is never emitted as markup; every part is a React text node.
- Highlight: `font-medium text-kh-link`. Card surface: `rounded-lg shadow-popover bg-kh-bg border border-kh-border`. No new colour, radius or spacing token (rhythm scale tops out at `6`).
- Not highlighted: stacked cover preview, Inbox list excerpts, notifications, composer.
- `user_id`s never leave the server in this feature.
- Run `npm` through `/bin/sh -c` or `make` and check the real exit code; never pipe a test run into `tail` and trust `$?`.

## Review Focus

1. Two mentioned people sharing a name in one comment → every `@name` occurrence's card lists both (Task 3 test `same-name people share one card`).
2. `@name` followed by a letter (`@陳小明華` when only 陳小明 is mentioned) → not a mention; whole-name rule (Task 1 test `a longer word is not the shorter name`).
3. An `@` inside a URL (`https://x.y/@陳小明`) → stays part of the link, not a mention button (Task 3 test `an @ inside a link stays the link`).
4. Mention text edited out of the body → that person's `name_en`/`emp_id` absent from the response (Task 2 test `a mention edited out of the body is not sent`).
5. Clicking a mention in a compact preview card → opens the card's popover only; the discussion card is not activated and does not move (Task 3 test `clicking a mention does not activate the card`).

---

### Task 1: The mention splitter (domain, pure)

**Files:**
- Modify: `src/modules/knowledge/domain/review-mention.ts`
- Test: `tests/unit/review-mention.test.ts` (extend)

**Interfaces:**
- Produces:
  - `export type MentionedPerson = { name: string; nameEn: string | null; empId: string }`
  - `export type MentionPart = { text: string; people?: MentionedPerson[] }` — `people` set only on a mention occurrence; `text` then is `@` + name.
  - `export function splitMentions(text: string, people: readonly MentionedPerson[]): MentionPart[]` — concatenating every `part.text` gives back `text` exactly.

- [ ] **Step 1: Write the failing tests** in `tests/unit/review-mention.test.ts`, `describe("splitMentions")`:
  - `marks a whole @name`: `splitMentions("@陳小明 please check", [chen])` → `[{ text: "@陳小明", people: [chen] }, { text: " please check" }]`.
  - `ends at punctuation or end`: `"cc @Ann, @Ann"` with `ann` → two mention parts, text `@Ann` each.
  - `a longer word is not the shorter name`: `"@陳小明華 hi"` with only `chen` (name 陳小明) → one plain part.
  - `longest name first`: people `陳小明` and `陳小明華`, text `"@陳小明華 and @陳小明"` → first mention part's people are `[陳小明華 person]`, second `[chen]`.
  - `same-name people share every occurrence`: two people both named `Ann` (empIds `E1`, `E2`), text `"@Ann and @Ann"` → both mention parts have `people` of length 2 in input order.
  - `unmentioned @ stays plain`: `"mail @Bob"` with `[chen]` → `[{ text: "mail @Bob" }]`.
  - `round-trips`: for each case above, `parts.map(p => p.text).join("") === text`.
  - `no people, one part`: `splitMentions("a @b", [])` → `[{ text: "a @b" }]`; `splitMentions("", [chen])` → `[]`.

- [ ] **Step 2: Run** `npx vitest run --config vitest.config.ts tests/unit/review-mention.test.ts` — Expected: FAIL, `splitMentions` is not exported.

- [ ] **Step 3: Implement** `splitMentions` in `review-mention.ts`. Group people by `name`; candidate names sorted longest first. Scan for `@`; at each, take the first candidate with `text.startsWith("@" + name, i)` whose following character is `undefined` or matches `/[\s\p{P}]/u` (the composer's whole-name rule, `occurrences` in `src/components/knowledge/mention-autocomplete.tsx`); emit the plain run before it and `{ text: "@" + name, people: group }`. Leave the composer's own copy alone.

- [ ] **Step 4: Run** the same command — Expected: PASS.

- [ ] **Step 5: Commit** `feat(review): split a comment into text and mention occurrences`.

---

### Task 2: Mentioned people on the read path (+ the access docs)

**Files:**
- Modify: `src/modules/knowledge/ports/review-mention-repository.ts`
- Modify: `src/infrastructure/database/mariadb/repositories/review-mentions.ts`
- Modify: `src/modules/identity/ports/user-repository.ts:8`, `src/infrastructure/database/mariadb/repositories/users.ts:49-59`
- Modify: `src/modules/knowledge/domain/document-review.ts:16` (`ReviewCommentView`)
- Modify: `src/modules/knowledge/application/document-review-service.ts:370-386` (`views`)
- Modify: `CLAUDE.md` (share-link paragraph, "Exactly two entries…" sentence), `docs/superpowers/specs/2026-10-29-review-mentions-design.md` (one "Amended by 2026-10-30-review-mention-highlight-design.md" line under its title and next to the chips non-goal)
- Test: `tests/integration/review-mentions.test.ts` (extend; reuse its `fixture()`)

**Interfaces:**
- Consumes: `MentionedPerson`, `splitMentions` (Task 1).
- Produces:
  - `ReviewMentionRepository.listMentionedUsersByComments(commentIds: readonly string[]): Promise<{ commentId: string; mentionedUserId: string }[]>` — empty input → `[]` without a query. Port comment amended: reads keyed by comment are for the review read paths only, on comments the caller is already shown.
  - `UserRepository.findByIds(ids): Promise<Array<UserIdentity & { nameEn: string | null }>>` (SELECT adds `name_en`; existing callers unaffected).
  - `ReviewCommentView.mentions?: MentionedPerson[]` — present (possibly omitted when empty — *builder's call*, be consistent) on shown comments; the client reads `comment.mentions ?? []`.

- [ ] **Step 1: Write the failing integration tests** in `tests/integration/review-mentions.test.ts`, `describe("mentioned people on the discussion")`, using the fixture's users (give Alice `name_en: "Alice Wang"` via `pool.query("UPDATE users SET name_en=? WHERE id=?")`, Bob none):
  - `a link reader without a caller sees who a comment mentions`: a comment `"@Alice @Bob look"` mentioning both → `queryForLink(null, token)` comment `.mentions` equals `[{ name: "Alice", nameEn: "Alice Wang", empId: <alice emp_id> }, { name: "Bob", nameEn: null, empId: <bob emp_id> }]` (order-insensitive).
  - `reads the person as they are now`: after writing, set Alice's `name_en` to `"Alice Lin"` → her entry's `nameEn` is `"Alice Lin"`.
  - `a renamed person is no longer highlighted`: after writing, rename Alice → her entry is absent (the body still says `@Alice`, which no longer matches).
  - `a mention edited out of the body is not sent`: author edits the comment to `"@Bob look"` → only Bob remains.
  - `a hidden comment carries none to a reviewer but does to the owner`: owner hides the comment → `queryForLink` comment has no `mentions`; `queryForOwner` comment has both.
  - `a deleted comment carries none`.
  - `listMentionedUsersByComments([])` returns `[]`; with two comment ids returns rows for both, nothing for a random id.

- [ ] **Step 2: Run** `make db-up` then `/bin/sh -c 'npx vitest run --config vitest.integration.config.ts tests/integration/review-mentions.test.ts'` — Expected: FAIL (`mentions` undefined / method missing).

- [ ] **Step 3: Implement.** Repository: `SELECT comment_id, mentioned_user_id FROM review_comment_mentions WHERE comment_id IN (…)`. `findByIds`: add `name_en` to the SELECT and the mapped row. `views`: after projecting a thread, for the comments whose projected `body` is the real body (not deleted; not reviewer-hidden — i.e. reviewer view: `visibility !== "HIDDEN" && !deleted`; owner view: `!deleted`), collect ids; one `listMentionedUsersByComments` and one `findByIds` per call to `views` (not per thread or comment); attach `mentions = people whose splitMentions(body, people) yields a mention part`. Drop rows whose user is gone.

- [ ] **Step 4: Run** the integration file — Expected: PASS. Then the whole integration suite `make test-integration` — Expected: PASS (memory: per-file runs have missed shape regressions).

- [ ] **Step 5: Update the docs.** In `CLAUDE.md`, change "`DocumentReviewService.queryForLink`, which serves the visible discussion and those fragments" to also name "and, for each person a visible comment mentions, that person's `name`, `name_en` and `emp_id` (`docs/superpowers/specs/2026-10-30-review-mention-highlight-design.md`)". Add the amended-by lines to the mentions spec. Run `/bin/sh -c 'npx vitest run --config vitest.config.ts tests/unit/share-link-single-exception.test.ts'` — Expected: PASS unchanged.

- [ ] **Step 6: Commit** `feat(review): discussions carry the people each comment mentions`.

---

### Task 3: Mentions drawn and their card

**Files:**
- Modify: `src/components/knowledge/review-thread-list.tsx` (`CommentBody` and its call site in the comment row)
- Modify: `docs/superpowers/specs/frontend-design-language.md` (one sentence in "Shared article discussion layout": a mention in a comment is `text-kh-link` `font-medium` and opens a popover-surface card; no new token)
- Test: `tests/unit/review-thread-list.test.tsx` (extend), `tests/e2e/zz-review-mentions.spec.ts` (extend)

**Interfaces:**
- Consumes: `splitMentions`, `MentionedPerson` (Task 1); `ReviewCommentView.mentions` (Task 2).
- Produces: `CommentBody({ body, compact, onClamped, mentions }: { …; mentions?: readonly MentionedPerson[] })`.

- [ ] **Step 1: Write the failing unit tests** in `tests/unit/review-thread-list.test.tsx` (extend its `thread()` helper with an optional `mentions`), `describe("mentions")`:
  - `a mentioned name is a button`: body `"@陳小明 please check"`, mentions `[{ name: "陳小明", nameEn: "Ming Chen", empId: "E1234" }]` → one `button` with accessible name `"陳小明, mentioned"`, text `@陳小明`, class contains `text-kh-link`; the rest is text.
  - `the card shows name then name_en · emp_id`: focus the button (and separately `pointerenter`, and `click`) → a popup containing `陳小明` and `Ming Chen · E1234`; Escape closes it.
  - `emp_id alone without name_en`: `nameEn: null` → `E1234` with no leading `·`.
  - `same-name people share one card`: two people named `Ann` (`E1`, `E2`) → each occurrence's card lists both rows.
  - `an @ inside a link stays the link`: body `"see https://x.y/@陳小明"` with 陳小明 mentioned → one `a[href]`, no mention button.
  - `unmentioned and renamed names stay text`: `@Bob` with no Bob in mentions → no button.
  - `clicking a mention does not activate the card`: compact card with `onActivate` spy → click the mention → spy not called.
  - `no markup from the body`: body `"<b>@陳小明</b>"` → no `b` element; the text `<b>` is present.

- [ ] **Step 2: Run** `npx vitest run --config vitest.config.ts tests/unit/review-thread-list.test.tsx` — Expected: FAIL.

- [ ] **Step 3: Implement.** In `CommentBody`, run `splitMentions` over each non-`href` part from `linkify`; a mention part becomes `Popover.Root` (`@base-ui-components/react/popover`, `openOnHover`) whose `Popover.Trigger` is a `button type="button"` (`font-medium text-kh-link kh-focus-ring`, `aria-label={`${name}, mentioned`}`, `onClick` stops propagation); `Popover.Portal`/`Positioner`/`Popup` with the surface classes in Global Constraints, one row per person: `name` (`font-medium`), then `[nameEn, empId].filter(Boolean).join(" · ")` in `text-caption text-kh-text-muted`. Pass `comment.mentions` from the comment row; the stacked cover is untouched. Keep the clamp measurement working (the button is inline).

- [ ] **Step 4: Run** the unit file — Expected: PASS. Then `/bin/sh -c './node_modules/.bin/tsc --noEmit && ./node_modules/.bin/eslint src tests'` — Expected: exit 0.

- [ ] **Step 5: Write the e2e** in `tests/e2e/zz-review-mentions.spec.ts`: `an anonymous reader sees a mention highlighted and who it is` — a signed-in writer mentions a user through a link (reuse the spec's existing setup), then a fresh context with no session opens `/s/:token`, opens Comments, hovers the `@name` button → popup shows that user's `name` and `emp_id`; Tab to it → popup shows; Escape closes.

- [ ] **Step 6: Run** `/bin/sh -c 'npm run test:e2e -- tests/e2e/zz-review-mentions.spec.ts tests/e2e/review-layout.spec.ts tests/e2e/shared-review.spec.ts'` — Expected: all pass.

- [ ] **Step 7: Commit** `feat(review): a mention reads as a mention and shows who it is`.

---

### Task 4: Whole-branch gate

- [ ] **Step 1:** `make verify` (if it fails only on ignored `.superpowers/` scripts, run `./node_modules/.bin/eslint src tests` and `make build` separately) — Expected: exit 0.
- [ ] **Step 2:** `make test-integration` and the review e2e set: `review-layout shared-review review-comment-edit-delete owner-review zz-review-reply-follow review-next-discussion zz-review-mentions review-tablet-comment document-review-anchors review-anchors-wider` — Expected: all pass.
- [ ] **Step 3:** In the running dev server, screenshot a share-link discussion with a mention, card closed and open, light and dark.
