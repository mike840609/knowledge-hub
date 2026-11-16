# Inline writing polish — before / after

Screenshots for the inline-writing PR, captured from the real app with the
development fixtures. Both versions ran against the same local MariaDB and the
same "My Space" user:

- **before**: `main` `d900e073`
- **after**: the PR branch `6981bccd`

Chromium 1280×860 at device scale 2; the page images are cropped to the
document column (the explorer removed). Toolbar and link-card images are
element screenshots at their own size.

| Pair | What the same interaction does |
| --- | --- |
| `before-emoji`, `after-emoji`, `after-emoji-inserted` | Type ` :grin` at the end of a line. Before: the raw code stays. After: the emoji list opens with `grinning face` first; choosing it inserts 😀. |
| `before-clear-toolbar` / `after-clear-toolbar`, `before-clear` / `after-clear-after` | Select the word `bold`. Before: the toolbar has no Clear formatting and the word stays bold. After: the toolbar has `Tx`; pressing it leaves the word plain. |
| `before-link-card` / `after-link-card`, `after-link-copied` | Put the caret in a link. Before: Open, Edit, Remove. After: Copy first, and after a press the card says Copied. |

The `:name: ` auto-conversion and the `Mod-\` shortcut are the same behaviour
without a pointer and are covered by the unit tests instead of a still.
