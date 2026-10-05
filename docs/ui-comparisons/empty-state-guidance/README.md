# Contextual empty states and getting started

New users can enter any major page and find its purpose and next action. Existing content with zero matches gets a recovery action instead of an import prompt. Actions use the shell’s confirmed workspace capabilities.

- **Knowledge:** explain browsing and reading; prioritize import in My Space, with note creation as the secondary action. Empty sources explain review/apply and link to Sources.
- **Search:** distinguish an empty personal workspace from a no-hit query. Remove filters while preserving the keyword and scope. Errors remain visible, and successful live search results do not fetch another document list.
- **Copy for Agent:** a small SVG example shows selected documents becoming a Markdown preview. Explain the select → prepare → review → copy flow. When a document filter has no matches, Clear search retains selected documents.
- **Graph:** a small SVG example shows linked and unlinked documents. Distinguish no documents, documents without links, and filters excluding all documents. Explain `[[Document title]]`, saving notes or reimporting files, and offer an existing document to open.
- **Shares:** guide first share creation from a document; filtered empty results offer Show all shares.
- **Insights:** explain what produces statistics. Pending previews lead to review/apply; archived-only content leads to archived articles. A completely empty space avoids a dashboard of zero-value charts.
- **Import result:** explain the next step and promote the existing Read this update link after a successful import.
- **Home:** Getting started in Home actions reopens the guide using the latest dismissal version, preserving completion. Users who create a note first can follow read/search/context links before importing a folder.

The two diagrams use existing semantic colors and are explicitly labeled as examples. They appear only for first-use states; filtered zero-result states retain compact icons.

Baseline screenshots use main commit `19e50725` in a separate worktree. Updated screenshots use the new-user browser test in an isolated database and production build. Viewports: desktop 1440 × 1000; mobile 390 × 844. The tests check mobile horizontal overflow.

## Desktop comparisons

| Page | Before | After |
| --- | --- | --- |
| Knowledge | ![Before Knowledge](before-knowledge-desktop.png) | ![After Knowledge](after-knowledge-desktop.png) |
| Search | ![Before Search](before-search-desktop.png) | ![After Search](after-search-desktop.png) |
| Copy for Agent | ![Before Copy for Agent](before-agent-context-desktop.png) | ![After Copy for Agent](after-agent-context-desktop.png) |
| Graph | ![Before Graph](before-graph-desktop.png) | ![After Graph](after-graph-desktop.png) |
| Shares | ![Before Shares](before-shares-desktop.png) | ![After Shares](after-shares-desktop.png) |
| Insights | ![Before Insights](before-profile-desktop.png) | ![After Insights](after-profile-desktop.png) |

## Mobile comparisons

| Page | Before | After |
| --- | --- | --- |
| Knowledge | ![Before Knowledge mobile](before-knowledge-mobile.png) | ![After Knowledge mobile](after-knowledge-mobile.png) |
| Search | ![Before Search mobile](before-search-mobile.png) | ![After Search mobile](after-search-mobile.png) |
| Copy for Agent | ![Before Copy for Agent mobile](before-agent-context-mobile.png) | ![After Copy for Agent mobile](after-agent-context-mobile.png) |
| Graph | ![Before Graph mobile](before-graph-mobile.png) | ![After Graph mobile](after-graph-mobile.png) |
| Shares | ![Before Shares mobile](before-shares-mobile.png) | ![After Shares mobile](after-shares-mobile.png) |
| Insights | ![Before Insights mobile](before-profile-mobile.png) | ![After Insights mobile](after-profile-mobile.png) |

## Getting started and import result

| Flow | Before | After |
| --- | --- | --- |
| Home actions | ![Home actions before](before-home-menu.png) | ![Getting started menu](after-home-menu.png) |
| Successful import | ![Import result before](before-import-next-step.png) | ![Import next step](after-import-next-step.png) |

Validation: typecheck and lint passed; 1770 unit tests passed; production build and 20 browser tests passed, covering the six first-use pages, guidance hide/reopen with progress preserved, import-to-reading, no-hit recovery, preserved context selections, graph distinctions, live and no-JavaScript search, saved searches, and access denial. The design detector reported no findings.

Illustration update validation: typecheck and lint passed; 13 affected unit tests passed; production build and 2 browser flows passed, including first-use desktop/mobile captures and retained search/context/guidance behavior.

## Complete state gallery

[All 19 desktop empty-state variants and 2 related guidance screens](GALLERY.md), including pending previews, archived-only insights, empty sources, filtered results, unlinked documents, and retained context selections. Captured at 1440 × 1000 in an isolated E2E database; production build and screenshot flow passed.
