# Insights: unread updates and reading coverage

| Item | Content |
| --- | --- |
| Date | 2026-10-08 |
| Type | Design specification |
| Why | Insights answers "how much do I have" and "how much did I read this week". It does not answer "what should I open next". Two figures that do are already derivable from stored data: synced documents that changed since I last read them, and how much of each synced folder I have ever opened. |
| Related | `docs/ui-comparisons/insights-reading-activity/README.md` (reading counts), `docs/superpowers/specs/frontend-design-language.md` §8 (chart colour) |
| Status | Implemented. `src/modules/personal/domain/personal-profile.ts`, `src/infrastructure/database/mariadb/repositories/personal-profile.ts`, `src/components/personal/personal-profile-view.tsx`, `reading-activity.tsx`, `profile.module.css`; tests `tests/unit/personal-profile-view.test.tsx`, `tests/integration/personal-profile.test.ts`. |

## 1. What it delivers

1. **Unread updates on Insights.** A row in *Your knowledge* with the count, linking to the existing `unread` document list.
2. **Reading coverage.** Each folder bar in *Where your knowledge lives* shows how many of its documents the reader has opened, and *Reading activity* states the library-wide figure as "n of m".

No migration, no new table, no new route, no new filter.

## 2. Definitions

Both figures are about the caller's own activity in their own Personal workspace. `PersonalProfileService.authorize` is unchanged and remains the only gate.

### 2.1 Unread updates

Unchanged. It is the count Home already shows (`counts.unread`): active documents in active folder-sync sources whose current revision was written by a recorded Added or Updated sync change and is newer than the revision the caller last read. Insights now shows the same number and links to the same list, so the two pages cannot disagree.

### 2.2 Viewed

A document is **viewed** when the caller has a `document_read_progress` row for it in this workspace: they opened it at least once, at any revision. This is the definition `counts.browsed` already uses.

- Per folder: `ProfileSource.viewed`, counted over the same documents as `ProfileSource.articles` (active, with a current revision, in an active folder-sync source). So `0 ≤ viewed ≤ articles`.
- All synced folders: `counts.syncedBrowsed`, so that the "n other folders" row can show `syncedBrowsed − Σ viewed` of the listed folders.
- Whole library: `counts.browsed` of `counts.articles`, both existing.

Viewed and unread are different questions and are meant to be read together. A document opened once and since updated by a sync is both viewed and unread. Coverage answers "have I ever looked at this folder"; unread answers "is what I read still current".

Coverage is all-time and does not move with the period selector, like the rest of the two upper sections.

## 3. Presentation

- *Your knowledge*: an **Unread updates** row above **Archived documents**, same row form. Shown at zero, so the section does not change shape.
- *Where your knowledge lives*: the folder bar keeps its length (documents in the folder relative to the largest folder). Inside it, the viewed share is drawn at full strength and the rest at reduced opacity. The label reads **"n of m viewed"** in place of "m documents". A folder with no documents reads "0 documents" and draws no bar.
- *Reading activity*: "Viewed in your current library" reads **"n of m documents, all time"**.
- *How counts work* gains a **Viewed** entry.

The bar introduces no colour. It is one series (`chart-2`) split into part and whole, which §8 of the design language now covers: the whole is the series colour at 35% opacity, and the figure is always given in text because the tint alone is below 3:1.

## 4. Not included

- A list of unviewed documents per folder. The folder row still opens the folder. Add an `unviewed` filter when someone asks for the list rather than the number.
- Coverage for personal notes: the reader wrote them.
- Coverage over time. There is no snapshot of past totals to draw it from.

## 5. Tests

| Requirement | Test |
| --- | --- |
| `viewed` counts each opened document once, per folder, and only the caller's reads | integration: "reports how much of each synced folder has been viewed" |
| Archived documents leave both `articles` and `viewed` | same |
| `syncedBrowsed` excludes personal notes; `browsed` includes them | same |
| Unread row links to the `unread` list; folder rows say "n of m viewed"; "other folders" row uses the remainder | unit: `personal-profile-view.test.tsx` |
| Empty library renders no `NaN` / `Infinity` | unit, existing case |
