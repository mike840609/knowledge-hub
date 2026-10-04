# Personal profile dashboard

`Insights` appears in Personal workspace navigation at `/w/{workspaceId}/profile`.
Home shows a compact row of four core counts with a View all insights link; it remains
the reading and import entry. Detailed statistics stay on Insights, which opens with a title and period selector
instead of a repeated identity header or the four Home counters. Team workspaces and other
users' Personal workspaces cannot access these statistics or their detail pages.

## Count definitions

- Articles: published documents in active sources; exclude drafts and archives.
- Synced folders: active Folder Sync sources, including empty folders.
- Favorites: the current user's favorites among active published articles.
- Unread updates: distinct active synced documents whose current revision has a
  permanent Added/Updated journal event newer than the user's read revision.
  Moves alone and legacy imports without journal entries do not invent unread events.
- Personal notes: Hub-managed published documents, including Markdown uploads.
- Archived: published documents that are archived or belong to archived sources,
  counted once.
- Recent changes: distinct documents per Added/Updated/Archived label from applied
  syncs in a rolling 7 or 30 × 24-hour window. Categories may overlap; these are
  recorded historical events rather than counts of current document status.
- Sync outcomes: the latest completed Applied/Failed attempt per active folder.
  Previewed runs do not replace the completed outcome.
- Awaiting Apply: the current user's unexpired, ready, blocker-free previews.
  Existing sources must remain active and match the preview's source version.
  Initial folder previews are included.

The distribution displays the largest three folders plus an aggregate for the
remaining folders, with the last successful sync time. Detail pages use UUID
keyset pagination (50 articles or sources per page) and display current saved
documents. Old syncs lacking permanent change records are identified explicitly.

Each repository response uses one SQL statement so aggregate totals, distribution
and paginated items share an InnoDB read view during concurrent syncs. Queries
read metadata and journal records, never entire Markdown bodies. No migrations
or additional dependencies are required.

## Verification

`tests/integration/personal-profile.test.ts` covers owner isolation, Team denial,
count definitions, source archives, unread revisions, private and stale previews,
legacy journals, pagination and concurrent writes.

`tests/e2e/personal-profile.spec.ts` covers real imports, favorites, reading an
update and returning through navigation, drilldowns, period selection, refresh,
preferences, light/dark/mobile layouts and denied Team access. Set
`KM_PROFILE_SCREENSHOTS` to write the desktop and mobile captures to a directory.
