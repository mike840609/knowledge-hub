# Editor Notion gaps — before / after

Screenshots for PR #357 (`feat/editor-notion-gaps`), captured from the real app
with the development fixtures. Both versions ran against the same local MariaDB
and the same "My Space" user:

- **before**: `d900e073` (`main`) on `http://127.0.0.1:3011`
- **after**: `b81a1cc6` (PR branch) on `http://127.0.0.1:3010`

Chromium 1280×860 at device scale 2; the app's own Tailwind build. The page was
cropped to the document column to remove the explorer; the `/` menu is captured
as its own element so the whole list is visible.

| Pair | What the same interaction does |
| --- | --- |
| `before-todo` / `after-todo` | Press the first to-do's box. Before: it stays unchecked (the box is decoration). After: it ticks. |
| `before-list-duplicate` / `after-list-duplicate` | Caret in the second item → block menu → Duplicate. Before: the whole list is duplicated. After: only that item. |
| `before-table` / `after-table`, `after-table-aligned` | The table actions. Before: add/delete only. After: a **Column alignment** field, and the first column centred. |
| `before-turn-into` / `after-turn-into`, `after-toggle` | The block menu's Turn into. Before: Text … Code. After: Toggle and Callout too, and the paragraph becomes a toggle with its words as the summary. |
| `before-slash-menu-full` / `after-slash-menu-full` | Type `/` on an empty line. Before: one flat list of 13. After: Basic blocks / Lists / Blocks / Links, and **Page link**. |

Two findings are behavioural and have no meaningful still image: pressing a
rendered code block enters its raw code (B4), and the peek panel's Edit opens
the document page instead of the legacy `/edit` hop (B7).
