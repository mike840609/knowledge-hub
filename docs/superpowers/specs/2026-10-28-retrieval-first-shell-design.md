# Retrieval-first shell design

## Intent

The product is used mainly to **find and organize existing knowledge**, not to author long documents. That makes Linear the model for the shell and the work surfaces, and Notion the model only for the page itself.

The reader chose this direction on 2026-10-28: quick retrieval / organization. This document records the three changes that follow from it.

## Goals

1. At 1024–1279px the explorer stops taking 288px of a 1024px window. It becomes a 40px strip that opens the same explorer in a left Drawer over the content.
2. Favorites and Recent in the explorer are open by default for a reader who has not collapsed them. An explicit collapse still persists.
3. Confirm the search / ⌘K palette already carries what retrieval needs: recents, actions, keyboard movement, and the full search page's filters; add nothing that duplicates it.

## Non-goals

- Replacing the two rails with a single sidebar. That is the larger structural change the reader explicitly excluded; this is the smaller move that buys the same width at the narrow desktop range.
- Notion authoring features (page width, templates, @ mentions, image captions) or Notion's data model (databases, columns, synced blocks, embeds, presence, cover images).
- More Linear issue constructs (cycles, estimates, roadmaps).

## Decisions

### 1024–1279: explorer as a drawer

- The inline 288px explorer is `xl` and up (1280+). At `lg`–`xl` the layout shows a 40px vertical strip with the same FolderTree button used by the inline collapsed state.
- The strip opens a left `Drawer` titled “Browse”; the same `SourceSidebar` instance renders inside it. A document link closes the drawer and navigates.
- Under 1024 the app shell’s existing Menu Drawer remains the only explorer. Above 1280 the existing inline explorer and its persisted collapse state are unchanged.
- The 176px primary rail is unchanged.

### Favorites and Recent open by default

- `kh:sidebar-favorites` and `kh:sidebar-recent` keep their persisted booleans, but the fallback changes from `false` to `true`.
- A reader who closes either section keeps it closed across reloads. The automatic “open when a new favorite is added” behavior stays.
- The sections still render only when they have rows.

### Search and palette

- The empty ⌘K palette already lists recent documents above the registry's actions, and the full search page already has scope, source, path, date, sort, saved searches and arrow-key result navigation.
- No new palette group is added in this pass: putting favorites above recents would change the established empty-palette target (the first row is the document opened before this one), and the current order is the retrieval-first one.
- The change is verified with the existing palette/search E2E suites rather than duplicated.

## Verification

- 1024 / 1279 / 1280 layout checks: strip visible, inline explorer absent, drawer opens and navigates; at 1280 inline explorer visible.
- Favorites / Recent visible on first arrival with a favorite and a recent document; closing them persists after reload.
- Existing `zz-recents-favorites`, search, and palette keyboard suites stay green.
- Typecheck, unit, integration, build, and E2E shards.
