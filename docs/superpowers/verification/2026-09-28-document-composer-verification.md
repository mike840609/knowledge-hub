# Document composer verification

Date: 2026-09-29

- Spec: `docs/superpowers/specs/2026-09-28-document-composer-design.md`
- Plan: `docs/superpowers/plans/2026-09-28-document-composer.md`
- Branch: `feat/document-composer`
- Commit verified: `870adc083ee8c4d59025aac2b8ed0fadf7f7f42b` (`fix(ui): create and upload on the new-document page can no longer race`)

## Environment

- Node.js `v24.6.0`, npm `11.5.1`.
- MariaDB 10.11 via `make db-up` (container `hcm-km-phase0-mariadb-1`, `127.0.0.1:3307`).
- Playwright config: `tests/e2e` root, `fullyParallel: false`, `workers: 1` (`playwright.config.ts`).

## Results

| Gate | Command | Result |
| --- | --- | --- |
| Unit + typecheck + lint + build | `make verify` | exit 0; unit 55 files, 455 tests passed; build lists `ƒ /w/[workspaceId]/knowledge/[sourceId]/[documentId]/edit` and `ƒ /w/[workspaceId]/knowledge/new` |
| E2E, full suite | `make test-e2e` | exit 0; 100 passed, including all 9 `document-composer.spec.ts` cases and the `phase5-authoring.spec.ts` "sidebar names the document by its new title" case (see below) |

Only one `make test-e2e` run was needed: the known-intermittent
`phase5-authoring.spec.ts` sidebar case passed on this run, so the brief's
re-run contingency (triggered only if that case is the sole failure) did not
apply.

## Composer unit tests (from the `make verify` run)

| File | Cases |
| --- | --- |
| `tests/unit/authored-title.test.ts` | 11 |
| `tests/unit/document-draft.test.ts` | 8 |
| `tests/unit/form-keys.test.ts` | 7 |
| `tests/unit/document-location.test.ts` | 2 |

`authored-title.test.ts` covers `resolveAuthoredTitle` (spec §8): metadata
priority, opening H1 (with inline formatting stripped to plain text), an H1
not at the opening position falling to `TYPED`, an image-only H1 with empty
alt falling to `TYPED` while non-empty alt is taken, BOM and leading blank
lines, a metadata title that is empty or non-string falling through, typed
title trimming, and the all-empty case. `document-draft.test.ts` covers the
draft store (spec §5) against an injected fake `Storage`: writes only when
changed, deletes on revert to the initial value, malformed JSON and version
mismatch both read back as no draft, a throwing `Storage` does not leak, and
edit/new keys do not collide. `form-keys.test.ts` covers `formKeyIntent`
(spec §6): save, toggle-preview, exit-preview and cancel intents, and IME
composition suppressing both Enter and Escape.

## Composer E2E cases (`tests/e2e/document-composer.spec.ts`)

All 9 passed:

1. a document that opens with an H1 is named by it, with no title field
2. deleting the opening H1 brings back the title field, filled with it
3. a frontmatter title survives editing the H1
4. preview shows the saved look and returns to the same text and caret
5. an unsaved edit survives leaving and is offered back on return
6. a restored draft on a document someone changed meanwhile conflicts instead of overwriting
7. Cancel asks before discarding changes, and discarding clears the draft
8. a new document can be named by its H1 alone
9. an upload in flight disables Create, so the two cannot race

## Step 1: Firefox `Ctrl⇧P` — not performed

Not performed, and not automatable with the tools available here: Playwright
delivers key events to page content only, never to the browser chrome, so a
Playwright-driven Firefox run cannot observe whether `Ctrl⇧P` opens a private
window — the one thing this check exists to find out. No Firefox install and
no key change were made on this basis.

This remains open for a person to do by hand: open the editor in Firefox,
place the caret in the text, press `Ctrl⇧P` (Windows/Linux) or `⌘⇧P` (macOS),
and note (a) whether the preview toggles and (b) whether a private window
also opens. Recorded in spec §6 as `2026-09-29：尚未在 Firefox 實測（見
verification 紀錄）。`

## Known intermittent failure: `phase5-authoring.spec.ts` sidebar case

`tests/e2e/phase5-authoring.spec.ts` — "after a save, the sidebar names the
document by its new title" — has a pre-existing intermittent failure,
measured by repeated runs (`--repeat-each=40`) at four points in this
branch's history
(`.superpowers/sdd/2026-09-28-document-composer/bisect-phase5-80-report.md`):

| commit | failed/40 |
| --- | --- |
| `060b8eb` (`main`, before this branch) | 3/40 |
| `5c8d86a` | 7/40 |
| `f54a300` | 6/40 |
| `870adc0` (branch HEAD) | 7/40 |

Every failure shares the same signature: the post-save `heading` assertion
passes, and the following `getByRole("treeitem", …)` assertion times out at
15s waiting for the sidebar to show the new name. The failure is present on
`main` before this branch's first commit, so it is not introduced by this
branch. Across the four measured points the rate is non-zero throughout and
in the same double-digit-or-near-it neighborhood at three of the four; with
n=40 per point the confidence intervals are wide and overlapping, so a rise
between `060b8eb` and the later commits is suggestive but not statistically
established, and no mechanism for it was found in this branch's diff. It is
left open as a separate, pre-existing defect — not fixed here, and not a
flake: the report above gives a reproducible signature, not noise without a
description.

## Spec §8 completion criteria → evidence

| Criterion | Evidence |
| --- | --- |
| Title resolution: metadata → opening H1 → typed, in that order | `authored-title.test.ts`; `document-composer.spec.ts` cases 1–3, 8 |
| Draft persisted per tab, restored on return, silent on any storage failure | `document-draft.test.ts`; `document-composer.spec.ts` cases 5–6 |
| Stale draft conflicts through the existing 409 path rather than overwriting | `document-composer.spec.ts` case 6 |
| Cancel confirms before discarding; no key discards a draft | `document-composer.spec.ts` case 7; `form-keys.test.ts` |
| Preview toggles by button and by `⌘/Ctrl⇧P`; returns to the same text and caret; `Esc` in preview returns to editing | `document-composer.spec.ts` case 4; `form-keys.test.ts` |
| New-document typed-create and upload are mutually exclusive | `document-composer.spec.ts` case 9 |
| `make verify` and `make test-e2e` pass | Results table above |

## Notes

- No files outside `docs/` and `README.md` were changed for this task.
- Numbers above are from the single `make verify` and single `make test-e2e`
  run recorded in this document; nothing here is claimed from memory or from
  an earlier session.

## Follow-up fixes after the final review

Three follow-ups were fixed before merge: the textarea re-fits its height when
the column rewraps (a `ResizeObserver` on width, plus `document.fonts.ready`);
the preview draws a title above the content only when the content does not
open with its own heading (the reader's rule); and "Upload .md" is a real
button, so keyboard focus shows the contract's one focus ring and the file
input is only the picker it opens. Covered by two new cases in
`document-composer.spec.ts` ("the text re-fits its height when the column
rewraps", "Upload .md is a focusable button that opens the file picker") and a
one-heading assertion added to the frontmatter case.

| Command | Exit | Result |
| --- | --- | --- |
| `make verify` | 0 | 457/457 unit tests; typecheck, lint, build clean |
| `make test-e2e` (run 1) | 2 | 104 passed, 1 failed — the phase5-authoring sidebar case above |
| `make test-e2e` (run 2) | 2 | 104 passed, 1 failed — the same case |
| sidebar case, `--repeat-each=40` | 1 | 5 failed / 35 passed (12.5%) |

Two consecutive full-run failures of the same case prompted the repeat
measurement: 5/40 sits inside the 3/40–7/40 range measured at main and every
earlier commit of this branch, so these fixes show no sign of raising its
rate. Every other case, including the two new ones, passed in both runs.

## Dropped navigation from `/edit` back to the document

CI on the rebased branch failed in `document-composer.spec.ts`: after leaving
the editor by a sidebar click, or after another tab's save, the URL stayed on
`/edit`. An instrumented probe (click target, every fetch, `pushState`,
navigation events) showed the same thing each time: the click hit the link and
was not prevented, the navigation's RSC request returned 200 within ~30 ms, and
the router never applied it — no `pushState`; a second click navigated at once.

| Measurement | Result |
| --- | --- |
| Sidebar click from `/edit` to its document, this branch, 40 repeats | 3 failed |
| Same probe on `main` (old editor), 40 repeats | 4 failed, identical signature |
| phase5 save-then-return tests, `main`, 30 repeats each | 0/60 failed |
| Same tests, this branch, 30 repeats each | 0/60 failed |
| Composer stale-draft test with the leaving test, 30 repeats each | 4 failed, all at "URL left `/edit`" after the other tab's save |

So the router drops a navigation from `/edit` back to its document now and
then, under load, on `main` too. It is not fixed here; it needs its own
investigation. This branch made one consequence worse: since the final-review
fix F3, `busy` stays set after a successful save, so a dropped navigation left
a disabled editor. The composer therefore finishes the journey with a full
load if it is still mounted 3 s after a successful save (spec §7). The two
draft tests leave the editor by a full load, since they test the draft, not
sidebar navigation.

New case "a save whose client navigation never lands still ends on the
document" holds the document's RSC fetch so the client navigation cannot land,
and passes only through the full-load fallback.

| Command | Exit | Result |
| --- | --- | --- |
| leaving, stale-draft and never-lands cases, `--repeat-each=30` | 0 | 90/90 passed |
| `make verify` | 0 | unit, typecheck, lint, build clean |
| `make test-e2e` | 0 | 106/106 passed |

CI then failed the same way on Cancel (a confirmed discard left the URL on
`/edit`): Cancel is the third path from `/edit` back to the document. Save and
Cancel now share one `leave(href)` — client navigation, then a full load if the
composer is still mounted after 3 s — and a new case holds the RSC fetch and
presses Cancel.

| Command | Exit | Result |
| --- | --- | --- |
| leaving, stale-draft, both never-lands and both Cancel cases, `--repeat-each=30` | 0 | 150/150 passed |
| `make verify` | 0 | unit, typecheck, lint, build clean |
| `make test-e2e` | 0 | 107/107 passed |

## Rendered editing (spec §11)

Date: 2026-09-29

Spec §11 (the composer edits the rendered document, with its Markdown one
keystroke away) is implemented on this branch. Everything below was run or
measured for this record on `224ccaa` (`test(e2e): the other specs write
Markdown through the source view`), with only this commit's documentation
edits on top. Environment as above: Node.js `v24.6.0`, npm `11.5.1`, MariaDB
10.11 (`hcm-km-phase0-mariadb-1`), Playwright `workers: 1`. The raw logs are
kept locally under `.superpowers/` (git-ignored).

The "Step 1: Firefox `Ctrl⇧P`" item above no longer applies: spec §11.6
removed `⌘⇧P`. Its replacement, `⌘/Ctrl /`, is listed under "What was not
verified" below.

### Commands and results

| Gate | Command | Exit | Result |
| --- | --- | --- | --- |
| Unit + typecheck + lint + build | `make verify` | 0 | 57 files, 542 tests passed; `tsc --noEmit`, `eslint .` and `next build` clean |
| E2E, full suite | `make test-e2e` | 0 | 126 passed (2.1 min), including all 35 `document-composer.spec.ts` cases and the `phase5-authoring.spec.ts` "sidebar names the document by its new title" case, which passed on this run, so the re-run contingency for that known intermittent case did not apply |
| Composer spec, 15 repeats | `npx tsx scripts/test/e2e.ts tests/e2e/document-composer.spec.ts --repeat-each=15` | 0 | 525 passed of 525 (35 cases × 15), 16.1 min |
| Round-trip corpus | `npx vitest run --config vitest.config.ts tests/unit/markdown-editor.test.ts` | 0 | 48 passed: 17 "leaves … as it was", 8 rewritten, and the tests of the image-title patch, `parsedIntact`, the image policy, edit detection (creating and replacing are not edits, typing is), the editable element, the two `⌘/Ctrl Enter` cases (the key adds nothing in a code block or table), output, and the failed-open and failed-replacement paths |

### Bundle: what the editor costs on `/edit` and `/new`

Method. `next build` was run (`npm run build`, exit 0 each) on three commits,
each in its own detached `git worktree` under `/tmp/hcm-km-bundle/` with the
main checkout's `node_modules` symlinked in, so the three builds differ only
in source:

- `91a8542`, the last commit before any Milkdown work (the plan document);
- `a5ffe06`, the last commit before the composer was wired to the editor: the
  editor files and the `@milkdown/*` dependencies are in the tree, and no
  route imports them (`git grep` at that commit finds no importer in `src`
  outside the editor directory);
- `224ccaa`, the commit verified here.

The exact figures are gzip bytes: for each route, every `.js` file that
`.next/app-build-manifest.json` lists for `/layout` plus the route, each
compressed with Node's `zlib.gzipSync` (default level) and summed
(a throwaway script in the git-ignored `.superpowers/` directory, not committed). Next's own "First
Load JS" column is also gzip, in decimal kB (1 kB = 1,000 B); in all 12
builds measured for this record the printed figure equals the byte sum
rounded down to whole kB. Raw (uncompressed) first-load size was not
measured. The lazy-chunk table further down gives both raw and gzip.

| Route | `91a8542` | `a5ffe06` | `224ccaa` | `224ccaa` − `a5ffe06` |
| --- | --- | --- | --- | --- |
| reading `…/[documentId]` | 183,663 B | 183,662 B | 184,141 B | +479 B |
| edit `…/[documentId]/edit` | 164,190 B | 164,185 B | 169,391 B | +5,206 B |
| new `…/knowledge/new` | 164,926 B | 164,925 B | 170,130 B | +5,205 B |

Next's printed "First Load JS" for the same three builds: reading 183 / 183 /
184 kB, edit 164 / 164 / 169 kB, new 164 / 164 / 170 kB.

Two things that limit how far these numbers can be pushed:

- **Build-to-build variation.** The same source (`224ccaa`) built in the main
  checkout instead gives 183,363 / 168,618 / 169,359 B (Next prints 183 / 168
  / 169 kB), about 0.8 kB less than in the worktree. And `a5ffe06` built for
  Task 3 in a different worktree directory gave 183,256 / 164,637 / 165,377 B,
  so a like-for-like pair from that run showed reading +850 B, edit +4,760 B,
  new +4,761 B. Builds of identical source in different directories move by
  several hundred bytes. Read the deltas as a range, not as exact costs. The
  cause of the variation was not investigated.
- **The reading page grew, by 0.5 to 0.85 kB gzip (0.26% to 0.46%).** No editor
  code reaches it: no first-load chunk of any route (68 chunks in the `224ccaa`
  build) contains `milkdown`, `prosemirror`, `ProseMirror` or
  `kh-selection-toolbar`. What changed is how webpack split a library that both
  the reader and the editor's toolbar use (`@floating-ui`). In the `a5ffe06`
  build the reading page loads one 53,334 B chunk; in `224ccaa` that is a
  6,393 B chunk plus a 47,276 B one (+335 B), and the webpack runtime file grew
  from 1,703 B to 1,838 B (+135 B). This was accepted rather
  than forced back to zero with a `splitChunks` override.

The editor itself is three lazy chunks. They are reachable only through the
`next/dynamic` import in `document-composer.tsx` (the only dynamic import in
`src`), so they load when the composer renders on `/edit` or `/new`, and they
are in no route's first-load list. Neither `91a8542` nor `a5ffe06` has any
chunk that contains those strings.

| Lazy chunk (`224ccaa`) | Raw | gzip | Strings found in it |
| --- | --- | --- | --- |
| `3510.fe4f16b8c0976f92.js` | 248,581 B | 76,703 B | `milkdown`, `prosemirror` |
| `ce4d20c7.8b8cfb5568627a1b.js` | 97,264 B | 30,928 B | `prosemirror` |
| `6343.f33f63afec681740.js` | 8,057 B | 3,453 B | `kh-selection-toolbar` |
| total | 353,902 B | 111,084 B | |

The rendered-editing plan (`2026-09-29-rendered-editing.md`, Task 5) expected
the reading page's figure not to have grown. It did, by the amounts above, and
that expectation is waived here: forcing the split back would need a
`splitChunks` override in `next.config`, a larger and riskier change than
under 1 kB gzip on one route.

### Browser spike (the Task 3 gate)

Spec §11.8 made a browser run the gate before the composer could depend on the
editor. It ran on `d5bb839` (the first commit that mounts the editor) and
passed; it was not repeated by hand at `HEAD`, where the same behaviours are
covered by the composer e2e cases (525 of 525 above).

- **Mount and hydration.** No console, page or hydration error on mount.
- **One editor.** Exactly one `.ProseMirror` element, in a production build and
  in `next dev` under React Strict Mode (the double effect does not build two).
- **Toolbar.** Positioned 8 px above the selection and not clipped by the
  reading column.
- **Repeat.** 420 of 420 at `--repeat-each=15` on the 28 cases the spec had
  then.

### Round trip: what stays and what is rewritten

`tests/unit/markdown-editor.test.ts` opens each writing in the editor and
compares what it writes back (`getMarkdown()`) with the input. The list is the
documentation of what a first edit changes, and a regression guard. This is
the list as it stands, copied from that file; all 25 cases pass (the
"Round-trip corpus" row above).

```ts
// Written as inputs and outputs, so the list is the documentation of what the
// editor rewrites on the first edit (composer spec §11.8) and a regression guard.
const unchanged: Record<string, string> = {
  "heading and paragraph": "# Title\n\nSome text with **bold**, _emphasis_ and `code`.\n",
  "dash list, nested": "- one\n- two\n  - nested\n",
  "ordered list": "1. a\n2. b\n3. c\n",
  "task list": "- [ ] todo\n- [x] done\n",
  "code fence with language": "```ts\nconst a = 1;\n```\n",
  "link": "[site](https://example.com)\n",
  "link with title": "[site](https://example.com \"the title\")\n",
  "autolink": "<https://example.com>\n",
  "image": "![alt text](/a.png)\n",
  "image with title": "![alt](/a.png \"cap\")\n",
  "image inside a paragraph": "text ![alt](/a.png) more\n",
  "blockquote": "> quoted\n> more\n",
  "rule": "before\n\n---\n\nafter\n",
  "html block": "<div class=\"note\">hello</div>\n\nafter\n",
  "inline html": "text <kbd>Ctrl</kbd> more\n",
  "footnote": "text[^1]\n\n[^1]: the note\n",
  "CJK text": "# 標題\n\n這是**粗體**，還有`程式碼`。\n",
};
const rewritten: Record<string, [input: string, output: string]> = {
  "star list becomes dash": ["* one\n* two\n", "- one\n- two\n"],
  "table separator is shortened": ["| a | b |\n|---|---|\n| 1 | 2 |\n", "| a | b |\n| - | - |\n| 1 | 2 |\n"],
  "two trailing spaces become a backslash break": ["line one  \nline two\n", "line one\\\nline two\n"],
  "setext heading becomes ATX": ["Title\n=====\n\ntext\n", "# Title\n\ntext\n"],
  "a redundant escape is dropped": ["a and 1\\. not a list\n", "a and 1. not a list\n"],
  "a star rule becomes dashes": ["a\n\n***\n\nb\n", "a\n\n---\n\nb\n"],
  "a wikilink is escaped": ["see [[Other Page]] here\n", "see \\[\\[Other Page]] here\n"],
  // mdast-util-to-markdown 2.1.2 (the locked version) escapes every underscore in text; 2.1.3 keeps one between two letters (與_斜體\_，).
  "underscores in text are escaped, including one between CJK letters": ["與_斜體_，\n", "與\\_斜體\\_，\n"],
};
```

- **Stay as written (17):** heading and paragraph, dash list (nested), ordered
  list, task list, code fence with a language, link, link with title,
  autolink, image, image with title, image inside a paragraph, blockquote,
  rule (`---`), HTML block, inline HTML, footnote, CJK text.
- **Rewritten (8):** a `*` list becomes `-`; a table separator `|---|---|`
  becomes `| - | - |`; two trailing spaces at a line end become a backslash
  break; a setext heading becomes ATX (`#`); a redundant escape (`1\.`) is
  dropped; a `***` rule becomes `---`; a wikilink `[[X]]` is written
  `\[\[X]]` (it displays the same and no longer reads as a wikilink); every
  underscore in text is escaped, including one between CJK letters (with the
  locked `mdast-util-to-markdown` 2.1.2; 2.1.3 would keep the inner one, and
  the test flags a bump).
- **Also rewritten, measured after the corpus was fixed and not pinned by a
  test.** An aligned table has its cells padded; an indented code block becomes
  a fenced one; a `~~~` fence becomes a ```` ``` ```` fence; the closing `##`
  of `## Title ##` is dropped; reference links are inlined and their
  definitions removed. A reference-style image `![alt][ref]` makes the open
  fail with `EditorParseError`, so the composer falls back to the Markdown
  source, safely. These are the writings to look for when a real imported
  document is compared before and after saving (item 3 below).
- **Image without a title.** Milkdown 7.22.2 parses `![alt](url)` with an mdast
  `title` of `null`, which ProseMirror's attribute validation rejects, so the
  parse throws and the whole document comes out empty. The patch is a remark
  plugin (`editor-core.ts`) that turns a `null` image title into an empty string
  before parsing. The corpus test "opens an image that has no title" pins it.
  If a parse ever does come out empty for a non-empty document,
  the composer falls back to the Markdown source and shows a one-line notice
  (spec §11.5).
- **Output settings.** The editor writes list markers as `-` and rules as
  `---` (`bullet: "-"`, `rule: "-"` on `remarkStringifyOptionsCtx`). Milkdown's
  defaults are `*` and `***`, which spec §11.4 gives as the reason for
  overriding them: most documents in the project would otherwise be rewritten
  whole on their first edit.

### What was not verified

Items 1 to 3 were not performed and need a person. Items 4 to 12 are known
limits and deferrals, recorded as they stand. Item 13 was not run.

1. **Firefox `Ctrl /`.** Not performed; needs a person. Open the editor in
   Firefox, put the caret in the text, press `Ctrl+/`, and note (a) whether
   the editor switches between rendered and Markdown and (b) whether Firefox
   does anything else with the key.
2. **Chinese (注音) input in the rendered editor, including the typing
   conversions.** Not performed; needs a person. In the rendered editor,
   type `# ` and `- ` while an input method is composing and check that the
   heading and list conversions do not fire mid-composition and that the
   composed text is intact.
3. **A real imported document.** Not performed; needs a person. Open a real
   imported document in the editor, compare how it looks with the reading
   page, save it, and compare the two revisions before and after.
4. The link box hides, and its text is cleared, when the browser tab or
   window loses focus while it is open (a blur with no `relatedTarget`). A fix
   idea exists (ignore the blur while `document.hasFocus()` is false; it needs
   a real-browser timing check) and is not done.
5. A code block that ends the document has no keyboard exit in rendered mode.
   Tables exit on Enter, and `⌘Enter` is left to the form since `4ea0fbf`.
   `@milkdown/plugin-trailing` is the option if it ever matters.
6. `next/dynamic` caches the result of the editor-chunk loader, so a transient
   chunk failure leaves rendered mode off until the page is reloaded (Markdown
   mode still works). A chunk request that stalls keeps the Markdown textarea
   disabled for up to webpack's roughly 120 s timeout.
7. The guard added in `ad3f5f5` (`keep()` ignores writes once the composer is
   leaving) has no test of its own. The window it closes is the up to 3 s of
   navigation after Cancel or "Load latest"; the e2e case for the editor
   path (a debounced emission after Cancel) is covered separately.
8. `jsdom` 29 requires Node `^20.19 || ^22.13 || >=24`, while `package.json`
   `engines` is `>=20.9 <25`. CI resolves Node 20 to a current 20.x, which is
   fine.
9. The router issue on `main` (a client navigation from `/edit` that is
   dropped) and the `phase5-authoring.spec.ts` "sidebar names the document by
   its new title" flake (about 7% to 17% of runs) predate this work and are
   unrelated to it; they get a separate issue. The flake did not fail in the
   full run above.
10. The impeccable "side-tab" finding on
    `src/components/knowledge/markdown-prose.ts` (the blockquote's
    `border-l-2`, moved verbatim from the reader) is left standing. A person has to
    decide whether to add an ignore for it.
11. A change typed in the rendered editor and reverted inside the 200 ms
    debounce (type a letter, press Backspace) leaves the document marked as
    changed: the editor reports two edits and never a new value, so nothing
    clears the flag. The same follows a revert made in the source view. The
    effect is a `beforeunload` prompt, `Esc` doing nothing and Cancel asking to
    confirm, on a document that has not changed. It cannot lose text, and
    saving sends the original text. Not fixed.
12. The selection toolbar appears and disappears instantly, without the
    enter/leave transition the design language §9 asks of overlays (recorded
    in spec §11.4).
13. `make test-integration` (the CI `integration` job) was not run for this
    record.
