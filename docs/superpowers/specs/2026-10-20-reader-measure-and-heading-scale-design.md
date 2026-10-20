# Reader: a prose measure and a heading scale that steps

Desktop only. Applies wherever rendered Markdown is typeset with `MARKDOWN_PROSE`: the
reader, a shared page, and the rendered editor (they share the class so they cannot drift).
The Markdown source view is raw text being edited and is unchanged.

## Evidence (2026-10-20, Playwright, Inter 15px/28px)

| Surface | Text width | Latin chars/line | CJK chars/line |
| --- | --- | --- | --- |
| Editor, 1440 wide | 693px | 86 | 47 |
| Editor, 1920 wide | 812px | 101 | 55 |
| Shared page, any width | 804px | 100 | 54 |

- The reading column is 860px (`max-w-reading`, 804px of text after padding), and the
  text fills it. At the end of a line the eye has to sweep back the line's full width to
  the next line's start. At 800px that sweep is long enough to land on the wrong line,
  and a paragraph of mixed CJK and Latin text reads as a wall.
- Headings: `h1` 24px, `h2` 20px, `h3` 16px, `h4` 14px. Body text is 15px. An `h3`
  is 1px larger than the paragraph under it, and an `h4` is **smaller** than its
  paragraph. `h5` and `h6` have no rule, so Tailwind's preflight leaves them
  indistinguishable from a paragraph.

## 1. Measure

- New container token `measure` = **40rem (640px)**. At the measured advance widths
  (Latin ≈ 8.1px, CJK = 15px) that holds about 79 Latin or 42 CJK characters per line.
- It applies to **running text only**: `p`, `ul`, `ol`, `dl`, `blockquote` (callouts
  included) and `h1`–`h6`. The scroll-mt rule and every other rule in `MARKDOWN_PROSE`
  stay as they are.
- Tables, code blocks, Mermaid diagrams and the column itself keep the full reading
  column (860px). Their content is wide by nature, and a horizontal scroller in a
  640px box would hide more of it. Their right edge extending past the text's is
  deliberate.
- An image inside a paragraph follows the paragraph's measure. This is accepted.
- `kh-reading-column` stays 860px. It also holds message states and the page chrome,
  which are not prose.

## 2. Heading scale

| Element | Before | After |
| --- | --- | --- |
| `h1` | `display` 24px | unchanged |
| `h2` | `heading` 20px | unchanged |
| `h3` | `title` 16px | **`subheading` 17px / 26px** (new document token) |
| `h4` | `body` 14px | **`reading` 15px**, semibold |
| `h5` | none | `reading`, semibold, `mt-4` |
| `h6` | none | `reading`, semibold, `text-kh-text-muted`, `mt-4` |

- The steps become 24 / 20 / 17 / 15. Every level is at least as large as body text, and
  a level is told apart by size down to `h3` and by weight below that.
- 17px is the reference ladder's measured size (`tailwind.config.ts`: "17px 0"). The new
  token is not interpolated. Its 26px leading keeps a heading on the 2px grid the other
  document sizes use.
- The new token is a document size, beside `reading` and `display`. The UI scale is
  unchanged.

## 3. Contract

`frontend-design-language.md` is amended in place:

- the token table's Type (document) and Container rows,
- §7's container list, which gains `kh-measure`.

`tests/unit/design-tokens.test.ts` names the containers and is updated with it.

## 4. Acceptance

- Unit: `MARKDOWN_PROSE` limits each text element to `max-w-measure` and leaves `table`
  and `pre` alone. The heading classes map to the table above. The token scale names
  `measure` (40rem) and `subheading` (17px/26px).
- E2E, from a browser at 1440 and 1920, in the reader, the editor and on a shared page:
  - a paragraph's box is at most 640px wide, and a table may be wider;
  - computed font sizes are `h3` 17px and `h4`, `h5`, `h6` at least 15px;
  - every heading is at least as large as body text.

## 5. Follow-ups on the same page (added 2026-10-20)

The same evaluation found two more things on the editable document page, the view most
documents are read in.

- **An external link in the editor says it leaves.** The reader appends lucide's
  `ExternalLink` to an `http`, `https` or protocol-relative link (`isExternalHref`). The
  editor drew no mark, so a wikilink and a link off-site looked the same. The editor now
  draws the same glyph as a CSS `::after` mask (`/icons/external-link.svg`, the pattern
  `check.svg` uses) in the link's colour. Being a pseudo-element, it is in neither the
  Markdown written back nor the text the caret walks.
- **Less chrome between the page's top and its first line.**
  - The Markdown toggle used to sit on a row of its own above the article and pushed the
    title down about 60px. It now sits with the page's actions in the pinned line, after
    the save status and before Share (`DocumentHeader`'s `editorActions`, which was
    `saveStatus`). That keeps it reachable while scrolling, and `⌘/` is unchanged.
  - **Edit code** under each code block is shown when the block is pointed at, when it
    has keyboard focus, and while the code is being edited. It is always shown where
    nothing can point (`hover: none`). It is never removed from the page or the
    accessibility tree, only made transparent. While the code is not being edited it sits
    over the block's lower right corner and takes no room of its own. While editing, it is
    in the flow as before.
- **The editor draws a code block as the reader does.** The editor shows the reader's
  block (`InlineCodePreview` → `MarkdownRenderer`), but `.kh-editor pre`, the rule for
  the raw code being edited, also reached the reader's `<pre>` inside it. It drew a second
  border, background and 16px margins inside the first box. With the Edit code line, the
  editor's page ran about 44px longer per block than the page it saves (measured: the
  following `hr` at 493 against 449). The rule now skips `[data-inline-code-preview]`.
  The editor and the reader place the block, its height and the next paragraph at the
  same offsets.
- **A block's first line is not indented.** `MARKDOWN_PROSE` gave every `code` the
  inline-code chip, padding included, so in both views the first line of every block sat
  4px right of the others. The chip is now `:not(pre) > code`.

Acceptance: `tests/e2e/zz-reader-chrome.spec.ts`.
