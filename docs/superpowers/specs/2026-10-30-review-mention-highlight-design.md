# Mentions read as mentions in a discussion

Date: 2026-10-30. Amends `2026-10-29-review-mentions-design.md` (its non-goal
"chips that re-render when a user is renamed" is narrowed, not reversed — see
§3) and the share-link invariant in `CLAUDE.md` (§4).

## 1. Why

A mention is recorded (`review_comment_mentions`) and reaches the person's
Inbox, but in the discussion itself `@陳小明` is plain text: a reader cannot
tell a real mention from someone typing an `@`, and cannot tell *who* the name
is — two colleagues may share a Chinese name. The reader wants the mention to
stand out and to show who it is, as the `@` list did when it was written.

## 2. What the reader sees

- In a comment's text, each `@<name>` that names a person the comment really
  mentioned is set in the link colour (`text-kh-link`, `font-medium`). Any other
  `@…` stays plain text.
- Pointing at it (hover), focusing it (keyboard) or tapping it (touch) opens a
  small card with what the `@` list showed: `name` on the first line, then
  `name_en · emp_id` in secondary text (`name_en` omitted when null, as in the
  list). Nothing else: no `account`, no `org_code`, no link anywhere.
- Everywhere `ReviewThreadList` draws comments: the shared page (`/s/:token`,
  document and folder links), the owner's comments rail, and the Inbox split
  view. Signed-in and anonymous readers alike (**the user's decision,
  2026-10-30**).
- Not in: the Inbox list rows' excerpts, notification text, the composer while
  writing (the `@` list already shows who), the stacked cover's two-line preview
  (a plain `<p>`, not `CommentBody`).
- **Two people with one name in one comment** *(my call, confirmed by the
  user 2026-10-30)*: the composer allows it (`livePicks`,
  `mention-autocomplete.tsx`), but `review_comment_mentions` records who, not
  which `@` stood for whom, and this spec adds no migration. So every
  `@<name>` occurrence opens one card listing **everyone that comment
  mentioned under that name**, one row each (`name`, then `name_en · emp_id`).
  Guessing an order could show the wrong person's `emp_id` — the confusion
  this feature exists to remove. In the common case the list has one row and
  reads as the single-person card above.

## 3. Where the data comes from

- The table, not the text, decides who was mentioned (as in the mentions spec).
  Each `ReviewCommentView` gains
  `mentions?: { name: string; nameEn: string | null; empId: string }[]` —
  the people that comment's `review_comment_mentions` rows name, read from
  `users` **at read time**. A renamed person's card shows the new name.
- The text decides what is highlighted: only an exact `@` + current `name`
  occurrence in the body is drawn as a mention. After a rename the body still
  says the old name, so that mention is no longer highlighted (its Inbox
  delivery is unaffected). This is the narrowed non-goal: no chip re-renders
  the body; the body stays exactly what the writer wrote.
- Overlapping names (`@陳小明` and `@陳小明華`): match the longest name first
  at each position.
- A mention whose user row is gone is dropped from `mentions`.
- `mentions` is present only on a comment whose body the caller is shown. A
  deleted comment, a hidden comment shown to a reviewer as hidden, and every
  comment of a thread the caller does not get carry none. The owner, who sees
  hidden comments' bodies, gets their mentions. *(The same projection that
  decides whether `body` is shown decides `mentions`; no second rule.)*
- An edit can remove the `@name` text but cannot add or remove mention rows
  (mentions are never written by edits). A row whose text was edited away is
  simply not highlighted; it is still listed in `mentions`. *(Builder's call:
  filter `mentions` to names that occur in the body before sending, so a
  removed name's `name_en`/`emp_id` is not handed out. Recommended.)*

### Port change

`ReviewMentionRepository` is documented as "every method is keyed by the user
it acts for; none reaches another's rows". This feature needs the opposite
read: who a set of comments mentioned. Add one method,
`listMentionedUsersByComments(commentIds)`, returning
`{ commentId, mentionedUserId }[]`, and amend the port's comment: reads keyed
by a comment are allowed only from the review read paths, for comments the
caller is already being shown. The user lookup goes through the existing
`users` repository (batch it — `views` already does one `findById` per
comment author; do not add one per mention). `UserRepository.findByIds` does
not return `nameEn` today; widen it. No migration.

### Base

Built on `main` after the comment-layout PR (two-column comment rows,
`Avatar`, 2026-10-30) has merged; the mention button lives in that layout's
content column, inside `CommentBody`.

## 4. Access — the change this makes

Today `DocumentReviewService.queryForLink`, one of the two entries that serve
content without a caller, serves "the visible discussion and those fragments".
After this it also serves, **for each person a visible comment mentions**,
that person's `name`, `name_en` and `emp_id`, to anyone holding a live link.

- This is new: until now an anonymous reader received no fact about any person
  but comment authors' display names. Anyone a link reaches — including people
  outside the company if a link is forwarded — learns these three fields of the
  people mentioned in it. Accepted by the user on 2026-10-30.
- It is bounded by what the discussion already says: only people mentioned in
  comments the link already shows, never a lookup. No new entry, route or
  query parameter; the candidate search stays signed-in only.
  `tests/unit/share-link-single-exception.test.ts` needs no new exception.
- `CLAUDE.md`'s invariant paragraph changes from "which serves the visible
  discussion and those fragments" to say it also serves the mentioned people's
  `name`, `name_en` and `emp_id`, and points here. The mentions spec gets a
  one-line "amended by" note.

## 5. Rendering contract

- `CommentBody` already splits text into plain parts and `linkify` links. The
  mention split is applied to the plain parts only, so a URL containing `@`
  stays a link. Everything stays React text nodes: no HTML from a body, ever
  (`CLAUDE.md` "The reader never passes HTML through" applies by analogy).
- The highlighted name is a `button` (it opens something; it is not a link)
  with an accessible name such as "陳小明, mentioned" and `aria-haspopup`;
  the card is a Base UI Popover (already a dependency, as `Tooltip` uses Base
  UI) that opens on hover, focus and click/tap and closes on Escape and
  pointer-leave. Surface tokens as every floating surface: `rounded-lg`,
  `shadow-popover`, `bg-kh-bg`, `border-kh-border` (frontend design language
  §5, §6). *(Builder's call on exact delays and placement.)*
- Clicking it must not activate the card (`stopPropagation`, as links in a
  comment already do) and must not move the card under the pointer.
- In a compact (two-line clamped) preview the highlight is drawn; the button
  still works.
- No new colour, radius or spacing token.

## 6. Non-goals

Clicking through to a profile page; avatars or photos; `account` or `org_code`
in the card; highlighting mentions in the document body (Markdown); mentioning
in edits; re-writing old bodies after a rename; a "who was mentioned" list
apart from the text.

## 7. Testing

- Unit (service, against the in-memory repositories the existing review service
  tests use): a reviewer view carries `mentions` with current `name`,
  `name_en`, `emp_id`; a deleted comment and a hidden comment (reviewer view)
  carry none; the owner view carries a hidden comment's mentions; a removed
  user is dropped; the edit-removed name is filtered out (if the builder takes
  that call).
- Unit (rendered `ReviewThreadList`): only an exact `@name` of a mentioned
  person becomes a button; an unmentioned `@x`, an `@` inside a URL, and a
  renamed person's old text stay plain; longest-name-first; the card shows
  `name` then `name_en · emp_id`, and `emp_id` alone when `name_en` is null;
  two mentioned people sharing a name both appear in each occurrence's card;
  clicking the mention does not activate the card.
- Integration: `queryForLink` with no caller returns `mentions` for a visible
  comment and none for a hidden one.
- E2E (extend `zz-review-mentions.spec.ts`): an anonymous reader of `/s/:token`
  sees the mention highlighted and its card on hover and on keyboard focus.
