# Stable Knowledge sidebar navigation

## Intent and scope

The user reports that the left document tree jumps vertically while browsing
articles with Favorites expanded. They selected approach A below and requested
the fix. This short design is pending their approval before implementation.

Opening a document through Favorites or Recent should change the article and
selection indicators while preserving the reader's position in the explorer.
Keep the existing sidebar arrangement and shared scroll container. Do not
redesign Favorites, move Recent, or change article-pane scrolling.

## Evidence

`SourceSidebar` renders shortcuts and source trees inside the same scrolling
`nav`. `KnowledgeTree` expands ancestors when the selected document changes
and adjusts that nav's `scrollTop` to reveal its selected row. Its positioning
effect also depends on tree data, readiness, and a layout key containing shortcut
counts. These are plausible causes of the reported movement; browser reproduction
is still required before claiming the cause is verified.

## Approaches

- **A — navigation intent controls positioning (selected):** shortcut navigation
  preserves position and expansion; explicit reveal locates the article in the
  tree. This directly addresses unwanted movement without changing layout.
- **B — separate shortcut and tree scrollers (not selected):** keeps Favorites
  visible but still allows the tree to jump and divides the available height.

## Behavior

- Opening Favorites or Recent, including their Show all menus, must not
  automatically expand sources/folders or scroll the explorer to the selected
  tree row. Selection highlighting still updates wherever the row is visible.
- Clicking a tree document preserves the browsing position. Keyboard navigation
  retains the minimum scrolling needed to keep the focused row visible.
- Shortcut synchronization, Recent count changes, and tree-data refreshes do not
  independently request selection positioning. A delayed load must not override
  the shortcut-navigation intent.
- Provide an accessible **Show in document tree** action for the current article
  in the explorer's existing Documents options menu (proposed placement). It
  opens the target source and ancestor folders, waits for required tree data,
  and minimally scrolls the target into view. It works repeatedly for the same
  article and does not move the article pane.
- Preserve intentional positioning for direct entry and search navigation;
  scope shortcut intent to its actual destination so it cannot leak to later
  unrelated navigation. Modified clicks opening another tab retain normal link
  behavior and do not change the current tab's navigation intent.
- Preserve existing manual expansion/collapse, document filtering, and movement
  behavior. If layout shrinkage makes the old scroll offset impossible, normal
  browser clamping is acceptable; forced reveal of a distant row is not.

## Constraints and implementation discretion

Use the existing React navigation, persisted expansion state, menus, and tree
loading. No API, database, dependency, or sidebar width changes are needed.
The builder may choose the internal representation of navigation/reveal intent;
do not use arbitrary timeouts, smooth scrolling, or a blanket ban on keyboard
and explicitly requested positioning to hide the symptom.

## Verification

Reproduce with expanded Favorites and a tree long enough for target rows to be
offscreen. Cover successive favorite opens, Recent and Show all, collapsed
ancestors, cross-source navigation, delayed tree/shortcut loading, and passive
updates. Assert stable explorer offset and expansion where the original offset
remains valid, with the article and selection updating correctly. Check explicit
reveal, repeated reveal, direct/search entry, and keyboard navigation still work.
Use focused behavioral regression tests and browser geometry checks; report any
environment limitation rather than claiming an unperformed browser verification.
