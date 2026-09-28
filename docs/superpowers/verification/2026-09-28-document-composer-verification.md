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
