# Rename a source — design

**Date:** 2026-10-26
**Status:** Proposed
**Scope:** let a reader rename a source's display label in place, without touching the folder tree,
documents, sync, or links.

## Intent

A source is the top-level entry in Sources, and its name is what the reader sees in the list,
detail header, health page, and archive dialog. The import flow already asks for a name, but it
defaults to the picked folder's name, so sources often end up called `obsidian-vault` or
`notes-2024`. Renaming is a small correction tool: it tidies the label the reader navigates by.

## Goals

- Change only `knowledge_sources.name`. Documents, shares, URLs, import history, and the folder
  tree keep using `source_id`; nothing moves.
- Rename in place on the source detail header: click the name, edit, **Enter or blur saves, Esc
  cancels**. This is the Linear-style primary path.
- Also expose **Rename source** in the existing source actions menu, which appears on both the
  list row and the detail header. The menu opens the same small name dialog (it does not own the
  row title, so a dialog is the honest entry point there).
- Validate the same way the import flow does: trim, 1–512 characters. Duplicate names are allowed,
  matching what import already permits.
- Authorize with the source-actions gate already used by Archive: `workspace.actions.canImport`
  plus the workspace membership check inside the unit of work.
- Archived sources can be renamed; it is only a label.

## Non-goals

- Renaming the folder tree's root node, or any projected folder. That is a different object.
- Renaming from a bulk action, inline on the list row, or through the `/update` import page.
- Unique-name enforcement, audit entries, or a rename history.
- Any schema change or `syncVersion` bump. A re-sync sends `proposedSourceName: null`, so a
  renamed source keeps its new name.

## Constraints

- `knowledge_sources.name` is `VARCHAR(512)`, non-unique.
- The source detail header is a server component; the editable name has to be a small client
  component.
- The existing lifecycle menu (`SourceLifecycleActions`) is used in both places and already gates
  on `canImport`; reuse it instead of adding a second menu.
- `SourceApplicationService` already owns source mutations; add the command there so the route
  stays a thin adapter.
- Do not bump `syncVersion`: a rename is cosmetic, and bumping would make an in-flight import fail
  with `SOURCE_VERSION_CONFLICT`.

## Approaches considered

**A. Rename only in the actions menu, with a dialog.** One entry point, consistent with Archive,
but needs a trip to the menu for the common case of "I'm looking at this source and the name is
wrong".

**B. Inline edit on the detail header only.** Closest to Linear's inline-title pattern and the
least UI, but tidying several sources means opening each one.

**C. A field on the existing `/update` page.** Reuses a page, but conflates renaming with
re-importing and is only reachable for folder-sync sources. Rejected.

**Chosen: B plus the list menu.** The header click is the primary path; the actions menu covers
tidying from the list. The detail header also carries the menu, so both routes are available while
viewing a source.

## Decisions already made

- **Label only.** The tree root and projected folders are untouched.
- **Inline on the header, dialog from the menu.** Coordination between a row's menu and its title
  would need shared client state for little gain; the dialog is one component reused by both menus.
- **Enter or blur saves, Esc cancels.** Keeps the Linear feel while being forgiving on click-away.
- **Duplicates allowed.** Matches import; no unique index exists or is added.
- **Same permission as Archive.** No new permission bit.
- **No `syncVersion` bump, no migration, no audit event.**

## What is left to the builder

- Extract a `SourceNameEditor` client component for the header (display → input, focus + select,
  saving state, a danger toast for a rejected save while the typed value stays on screen).
- Add a `RenameSourceDialog` following the existing `FolderNameDialog` pattern, mounted once where
  the source actions render.
- Add `renameSource(caller, sourceId, name)` to `SourceApplicationService`: `syncCallerIdentity` →
  `lockById` → `lockWorkspaceForMutation` → `sources.updateName`. Throw `SourceNotFoundError` for a
  missing source and a validation error for a bad name.
- Add `updateName(sourceId, name, actorId)` to the MariaDB source repository, updating `name`,
  `updated_by`, and `updated_at`.
- Add `POST /api/sources/[sourceId]/rename` with body `{ name }`, answering 204 on success and the
  usual error envelope otherwise.
- Tests: service validation and no-version-bump unit test, route test, repository integration test,
  and a component test for Enter/Esc/error behaviour.
