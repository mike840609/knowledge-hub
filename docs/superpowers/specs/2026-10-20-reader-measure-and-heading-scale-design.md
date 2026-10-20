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
