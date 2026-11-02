# Mentions after CJK text

| Item | Details |
| --- | --- |
| Date | 2026-11-02 |
| Status | Agreed with the user on 2026-11-02 |
| Amends | `2026-10-29-review-mentions-design.md` (the `@` trigger), `2026-10-30-review-mention-highlight-design.md` (where a highlighted mention starts) |

## Intent

The shipped mentions open the `@` list only after a space or at the start of the
text: the trigger was `(?:^|\s)@`. **Chinese writers type `請@王小明`, not
`請 @王小明`**, so in the product's primary language the list did not open unless
the writer inserted a space the language does not use.

This amendment changes where a mention may start: in the composer, in the
composer's count of which picks the text still holds, and in the discussion's
highlight. It does not change the mention table, the notification model, the
follow rule, the candidate search, owner mentions, folder links, or how a
highlighted mention looks.

### History

This branch first also drew mentions as highlighted `@displayName` runs. While
it was open, `2026-10-30-review-mention-highlight-design.md` (#312) shipped a
fuller version of the same thing on `main`: a mention is a button showing who
the person is. On rebasing, this branch's highlight (a second splitter in
`src/lib/mention-text.ts`, `ReviewCommentView.mentions` as display names and
`reviewMentions.listByCommentIds`) was dropped in favour of `main`'s. Only the
trigger and the start rule below remain.

## Behaviour

### When the `@` list opens

`mentionTrigger(text, caret)` returns the `@` token when the character before
it is not `[A-Za-z0-9_@]` and the `@` is not inside a URL (the run of
non-whitespace before it contains no `://`):

| Text before the caret | Opens? |
| --- | --- |
| `請@王` | yes — the previous character is CJK |
| `(@Amy` | yes — the previous character is punctuation |
| `look @Amy` | yes — the previous character is a space |
| `@Amy` at the start | yes |
| `name@example` | no — the previous character is an ASCII letter |
| `foo_bar@x` | no — the previous character is an underscore |
| `@@Amy` | no — the previous character is `@` |
| `@Amy Chen` (space in the query) | no list; the token stops at whitespace |
| `https://medium.com/@john` | no — the `@` is inside a URL; Enter there would otherwise replace part of the address with a name |
| `https://x.test/ @jo` | yes — the URL ended at the space |
| `A/@B` | yes — a slash alone is punctuation |

The query is at most 32 code points; the list still waits for one non-empty
character. A bare `@` opens the trigger but shows nothing until the next
character, as before. The existing English E2E (`Please look @groupAd`) is
unchanged.

### One start rule in three places

`startsMention(text, at)` in `src/modules/knowledge/domain/mention-text.ts`
holds that rule, and it decides where a mention starts in:

1. `mentionTrigger` — whether the list opens;
2. `mentionedIds` (its `occurrences`) — whether a pick is still in the text when
   the comment is sent, so `x@陳小明` keeps no pick;
3. `splitMentions` — which `@name` runs the discussion draws as mentions, on the
   server (which people a view carries) and in the renderer.

Without (3), a comment holding both `@Ann` and `x@Ann` would draw both as
mentions, though only one was written as one.

## Authorization

No change. The trigger is a client-side suggestion rule and grants nothing. The
start rule only narrows which runs are drawn as mentions; it adds no field to
any view.

## Testing

- Unit: `mentionTrigger` after CJK, punctuation, space, start, ASCII letter,
  underscore, `@`, inside and after a URL, whitespace in the query, the 32/33 code-point boundary and a
  caret before the text (`tests/unit/mention-trigger.test.ts`).
- Unit: `mentionedIds` keeps no pick for `x@…`, `foo_bar@…`, `@@…`, a URL
  (`tests/unit/mention-autocomplete.test.tsx`).
- Unit: `splitMentions` starts after CJK and punctuation and not after a
  letter, digit, `_` or `@`, nor inside a URL (`tests/unit/review-mention.test.ts`).
- E2E (`tests/e2e/zz-review-mentions.spec.ts`): typing `請@groupAd` opens the
  people list and inserts `@Phase3 groupAdmin`; after the owner revokes the
  link, the mention is not unread and All activity shows "A shared
  discussion" / "This link is no longer available." with no link and none of
  the comment's words.

## Non-goals

Rename-stable labels, mentions in the document body, and everything listed as a
non-goal in the two amended specs.
