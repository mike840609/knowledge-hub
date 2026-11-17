# Editor: links, paste and the page's name (Notion parity, fifth group)

The 2026-11-20 gap analysis listed what is left between the edit page's links and
paste and Notion's. This spec decides each. It amends
`2026-11-19-paste-and-links-design.md` (decisions 3 and 4, and its "Out of scope"
on addresses in pasted text) and the `[[` list of the daily-driver spec §6.1
(`2026-09-29-personal-daily-driver-design.md`). Everything is written through the rendered editor and read back
through the link extractor, as the wikilink rule (CLAUDE.md) asks. No colour,
radius or elevation token is added.

## Decisions

1. **`[[` offers to create the page.** When a query nothing answers to is typed,
   the list ends with a row, `Create page "Name"`, reached with the arrow keys
   and chosen with Enter, Tab or a press. "Nothing answers to it" means: the
   list is whole (a list cut at the most recent documents may hold the very page,
   and a second one would be a duplicate), the name can be written as a link
   (`isWritableAsWikiLink`), and no title in the list matches it as the list
   matches (full-width letters folded) or as the resolver does. Choosing writes
   the `[[Name]]` node at once, as a pick does, and makes the page in the
   background: `POST /api/workspaces/:id/documents` with the title and an empty
   body, the Workspace's default Hub source at its top, the place a new note goes.
   The link resolves from the moment the page exists; no write waits on the
   request. If it fails (a read-only member, a lost connection), the link stays,
   as typed text would, and a toast says "Couldn't create the page". Only the
   authorization the endpoint already checks decides who may create: the list
   grants nothing and discloses nothing it did not.
2. **The browser tab names the page.** On a document page the tab reads
   `Title · Knowledge Hub`, following the title as it is typed (the unsaved
   title, like the breadcrumb, which already followed it), and goes back to the
   app's name when the page is left. Before, the tab said "Knowledge Hub" on every
   page.
3. **A typed `[text](url)` keeps the text's formatting.** `[**bold**](url)` is a
   bold link, not a plain one; the rule links the text where it stands instead of
   writing it again.
4. **An address in pasted text is linked, in both paste paths.** Plain text with
   an address in a sentence or on any line pastes one paragraph per line (as
   before) with each address a link. Pasted Markdown has the addresses in its
   plain text linked after parsing. Code, a link already made, an inline node
   and an address that is not one (`http://` alone, `httpx://`) are left as they
   are; trailing punctuation stays out of the link and a `)` closing a `(` inside
   the address stays in. An address alone keeps the link toolbar's paste, and a
   table cell, which holds one line, keeps the text paste. Before, such an address
   was written `https\://…`, the defect the 2026-11-19 audit named.

## Out of scope, recorded

- A page made from `[[` goes to the top of the default source, not next to the
  document being written: a folder is a Source path, and the list knows only
  Workspace titles.
- Single newlines in Markdown pasted as Markdown still follow Markdown (the
  2026-11-19 decision stands); plain text with no Markdown in it already pastes
  one paragraph per line.
- Bold carrying past an autolinked address is the stored mark doing what it
  should. Pasting a list into the middle of a list item is a separate defect, not
  decided here.
- `@` mentions and a link preview: no embeds, and the mention needs a Markdown
  form and an authorization design (2026-10-27 audit).

## Verification

- `tests/unit/wikilink-suggest.test.ts` ("creating a page…"): the row, its keys
  and press, the failure, and the five cases that offer no row.
- `tests/unit/editor-markdown-paste.test.ts`: addresses in sentences, lines,
  parentheses and Markdown, the negatives, and the bold link.
- `tests/e2e/zz-links-and-paste.spec.ts`: a page made from `[[`, and found in the
  link targets afterwards; an address in a pasted sentence in the saved
  Markdown; the tab title and the breadcrumb following the title field.
- `make verify`.
