# Reader code blocks: language label and long-block collapse

Amends `2026-09-29-personal-daily-driver-design.md` §5 (code blocks). Everything there
stands — colour, limits, copy — and this adds two things beside it. Scope is the same:
the reader and a shared page (`MarkdownRenderer`); the composer and its loading
stand-in (`MarkdownBase`) stay plain.

## Why

- A coloured block does not say which grammar coloured it, and a plain one does not say
  whether it is plain because nothing was named or because the named language is not one
  the reader has. The fence already says; the page does not.
- A 200-line block is read as a wall: it pushes the rest of the document away, and the
  reader scrolls through it to reach the next paragraph.

Syntax-aware folding (by brace or indent) is **not** done: lowlight colours tokens and
builds no structure to fold, so it would need a parser per language, for a reader that
mostly wants to get past the block, not navigate inside it.

## 1. Language label

- The fence's language — the `language-x` class Markdown gives `<code>`, as written,
  so `ts` reads `ts` — is shown in the block's corner, before the copy button, in
  `text-caption`, `text-kh-text-muted`. A block that names none shows nothing.
- It is shown whether or not the reader has that grammar: it is what the author wrote,
  not a claim that it was coloured. Nothing is guessed.
- It is React text, never markup. A long word is truncated in CSS (`max-w-32`); the full
  word is its `title`.
- Like the copy button it is not printed.

## 2. Long-block collapse

- A block of more than **30 lines** opens collapsed: its scroller is held to the height of
  20 lines (`max-h-[31.5rem]` = 20 × `leading-6` + `py-3`) and scrolls vertically inside
  that. Below it, inside the box, a ghost button: `Show all N lines`, then
  `Show fewer lines`, with `aria-expanded` and `aria-controls` on the scroller.
- **Scrolled, not clipped.** The code stays in the page and reachable: find-in-page,
  a review anchor's highlight, keyboard and wheel all scroll it into view. `overflow: hidden`
  would hide a match or a comment's quote behind the fold.
- **Server-decided.** The line count is set on `<code>` as `data-lines` by a rehype pass
  (`rehypeCodeLines`, before the highlighter), so the page arrives collapsed and nothing
  moves when it hydrates. Counted the way the copy button copies: the newline Markdown
  adds is not a line.
- Copy still copies the whole block (`textContent` is unaffected by height).
- Printed, it is expanded and the button is hidden.
- Collapsing again brings the toggle back into view (`scrollIntoView({ block: "nearest" })`,
  after the shrink is committed), so the reader is not left far below a block that just shrank.

## 3. Structure

- `scrollable-pre.tsx` holds the box (`ScrollablePre`), with an optional scroller id,
  scroller class and footer; `markdown-base.tsx` imports it unchanged in behaviour.
- `code-block.tsx` (client) is the reader's block: state for expanded, the toggle, and
  the corner (label + `CopyCodeButton`). Only `markdown-renderer.tsx` uses it, so the
  composer's import closure (`composer-bundle.test.ts`) is unchanged.

## 4. Acceptance

- Unit: label shown as written for named fences (registered or not), absent for unnamed
  and indented code, escaped; `data-lines` counts correctly (trailing newline, empty block,
  no trailing newline); blocks over 30 lines render collapsed with the toggle, blocks at
  30 render without it; the composer stand-in has neither.
- E2E: a long block opens collapsed and scrollable, expands and collapses, copies the
  full text while collapsed; the label is visible.
