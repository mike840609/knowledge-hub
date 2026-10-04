# Action model — design specification

| Item | Content |
| --- | --- |
| Date | 2026-09-21 |
| Type | Design specification for pre-implementation review |
| Addresses | Contract Open items 1 (`⌘K`), 2 (toast/undo), 3 (guidance in empty and error states), 4 (context menu) |
| Reference contract | `docs/superpowers/specs/frontend-design-language.md` |
| Status | **Decided and implemented. Section 8 records three decisions and their outcomes.** |

## 1. Why these four items belong in one specification

They are four surfaces for the same missing model. The `⌘K` command palette, row context menus, the question “what can I do here?” in an empty state, and post-action toasts all need the same list: **who can do what to which target in which context**. Designing them separately would define that list four times and leave consistency to chance.

The product has no such list. Each action belongs to whichever screen happens to display it: editing to the document-header button, importing to an empty-state button, archiving to settings. Nothing can enumerate them together.

## 2. Current state (measured, not quoted)

Compared against `main` at `7275641`. Re-measurement matters because three of the four items describe the product incorrectly; building on them would inherit those errors.

**All UI-accessible mutations:**

```text
Knowledge   Create document              POST   /api/workspaces/:id/documents
            Edit document                PATCH  /api/documents/:id
Sources     Apply import preview         POST   /api/source-imports/:id/apply
Workspace   Archive / restore            POST   /api/workspaces/:id/archive|restore
            Rename                       PATCH  /api/workspaces/:id
Members     Add / change role / remove   …/members
Groups      Add / change role / remove   …/groups
Local only  Favorites and recent reading history (localStorage)
```

**Correction to Open item 4.** It says “rename, archive, and copy link all require opening the document page.”

- Rename document: **true**; this is the editor's title field.
- **Document archiving does not exist.** Neither the UI nor the HTTP API provides it; document routes expose only POST and PATCH. A document becomes `ARCHIVED` only through source re-sync, without a human entry point. (**2026-09-30 update:** the service layer always had `archiveDocument`/`restoreDocument` and folder equivalents; only the web entry point was missing. “No API” here means no HTTP route. Personal daily-driver slice A-1 added the entry points; see §10.)
- **Copy link does not exist.** The inspector's `Copy` button copies the document or source **ID**, for support rather than sharing.

**Correction to Open item 1.** `⌘K` does more than search: it is already a palette with document search, arrow-key selection, `aria-activedescendant`, and Enter to open a result. What it lacks is **anything besides documents**.

## 3. The finding that determines whether to proceed

A rough inventory of what the palette could contain today:

```text
Navigate   Knowledge · Sources · Settings · Switch workspace · Open document
Create     Add to Notes · Import knowledge
Document   Edit · Open details · Favorite · Show archived
Workspace  Archive · Restore · Settings tabs
```

About fourteen items, **mostly navigation**. The reference product's palette is valuable partly because it has hundreds of commands; ours would be a quick navigation tool with four additional operations.

That is still useful: quick navigation is a palette's main purpose. Name it honestly rather than imply parity. **A command palette does not create commands.** If the goal is to let readers act without hunting through screens, the preceding question is **which actions the product should offer**. That is a product decision, not a UI decision.

Section 8 puts this question first.

## 4. Model

One module owns the list. No other surface may independently enumerate actions.

```ts
type ActionId = "document.edit" | "document.favourite" | "knowledge.create" | …

type Action = {
  id: ActionId;
  label: string;                  // Imperative, e.g. "Edit document"
  group: "navigate" | "create" | "document" | "workspace";
  shortcut?: string;              // aria-keyshortcuts spelling
  /** Allowed surfaces: row menus select `row`; the palette selects `palette`. */
  surfaces: readonly ("palette" | "row" | "empty")[];
  /** Availability depends on caller capabilities and the target.
   *  This is never an authorization decision; see 4.2. */
  available: (context: ActionContext) => boolean;
  run: (context: ActionContext) => void | Promise<ActionResult>;
};
```

### 4.1 Availability has three axes

The UI currently reads only `access.actions.*`, the workspace-capability axis. That alone is insufficient. Conflating the axes is precisely the error identified in `CLAUDE.md`:

1. **Workspace capabilities**: `canWrite`, `canImport`, `canOpenSettings`, and so on.
2. **Source ownership**: `SOURCE_MANAGED` content is read-only in Hub regardless of caller capability. Workspace access and source ownership are separate questions and must not be conflated.
3. **Target state**: an archived workspace offers Restore rather than Archive.

### 4.2 The registry is not authorization

State this explicitly because palettes make the opposite assumption tempting:

> Possession of a `workspace_id`, `source_id`, or `document_id` grants no authority. URL parameters are navigation inputs, never authorization proof. The application service must re-verify policy regardless of what the UI allowed.

`available()` decides **what is displayed**; the service decides **what happens**. The server must still reject an action hidden by the palette. This specification introduces no endpoint that trusts caller assertions.

## 5. Three surfaces

**Palette (`⌘K`).** Preserve existing search behavior and add an action section above search results. Input filters both. Group actions by §4's `group`; an empty query shows actions and recent items rather than a blank surface.

**Row menu.** Reuse the existing `ui/menu` primitive, opened by a row's `⋯` button, **and** support right-click on the row. Right-click alone would exclude keyboard and touch users, which §10 forbids in the same sentence that requires arrow-key navigation.

**Empty states.** Open item 3 requests guidance rather than a bare heading. The registry answers directly: list actions whose `surfaces` includes `empty` and which are available here. That answers the reader's immediate question and removes the current need to hard-code two empty-state buttons.

## 6. Feedback: toast and undo

Currently feedback is `role="status"` text that pushes the layout when inserted. (§18 item 2 previously claimed the repository had no `aria-live`; that was incorrect. `role="status"` implies `aria-live="polite"`. The missing piece is this feedback layer, not announcement support.)

**Implemented.** A single toast region (`components/ui/toast.tsx`) is mounted by the app shell with `role="status"` and `aria-live="polite"`. It stays fixed in a corner without shifting layout, displays one message at a time, and dismisses on the next navigation. The region **always exists**, even with no message: inserting a live region alongside its content does not guarantee announcement.

**Offer undo only when a real inverse operation exists.** “Undo” that cannot restore the preceding state is misleading, and the codebase has no soft-delete mechanism to rely on. The complete implemented list:

| Action | Undo | Reason |
| --- | --- | --- |
| Archive / restore workspace | **Yes**, mutually inverse | Both endpoints exist |
| Rename workspace | **Yes**, restore the old name | Capture the previous name before submitting |
| Add member / group | **Yes**, remove | The inverse endpoint exists |
| Change member / group role | **Yes**, restore the previous role | The previous role is known |
| Remove member / group | **Yes**, re-grant | See below: inverse calls are not mirror images |
| Edit document | **No** | Creates a new revision; restore creates another revision, a feature rather than undo |
| Apply import | **No** | The specification provides neither force apply nor rollback |

**Inverse calls need not mirror forward calls.** Restoring a removed grant uses the **add** endpoint, not PATCH: `changeDirectMemberRole` and `changeGroupMappingRole` reject missing targets. It is a **new** grant, and audit records must describe it accordingly. `GrantRowActions` therefore accepts three callbacks rather than one `url`; a single URL could only guess the third operation. E2E asserts the **state** after undo, not toast text, because only state reveals this difference.

**Route feedback according to whether the reader must address it.** Errors stay next to the control (`GovernanceError`, capable of marking fields invalid); success is informational and goes to a toast. **Operations that navigate to their result show neither:** saving lands on the saved document, so another toast adds noise.

Keep two-step inline confirmation **only** for consequential operations that cannot be undone. When undo exists, act first and offer undo afterward. Workspace archive and grant removal previously required confirmation and no longer do: asking twice before reversible actions trains readers to dismiss the confirmations that matter.

## 7. Deliberately outside this specification

**Document archiving changes the domain, not merely the UI.** It requires an endpoint, lifecycle transition, a rule for conflicts between Hub archiving a `SOURCE_MANAGED` document and the next sync, and an audit record. It changes the knowledge module, not just `components/`. Handle it in its own specification if pursued.

The registry allows it to become a new entry later rather than requiring a redesign.

## 8. Decisions (2026-09-22)

1. **Proceed.** Even though §3's inventory is mostly navigation, navigation is a palette's primary purpose. The contract's §18 explicitly records it as a navigation tool and an open item, rather than pretending otherwise by adding nonfunctional commands.
2. **Leave document archiving unchanged.** Open item 4's premise that archive and copy link are misplaced is incorrect; neither existed. The contract has been rewritten. The registry permits adding them later as entries.
3. **Support right-click, with another entry point.** Every row also has a `⋯` trigger showing identical items. Right-click alone would exclude keyboard and touch users and violate §10's arrow-navigation rule. Implementation uses Base UI `ContextMenu`, so touch long-press opens it too.

### Two findings worth recording after implementation

**`⋯` floats without taking a column.** The first version gave it a control cell like the favorite star, causing every sidebar title to truncate differently for a usually invisible button. Absolute positioning over the row's own background preserves the previous layout. Consequently rows need background on `focus-within` too, so the floating button has a background when keyboard-focused.

**`document.details` appears only in the palette, not row menus.** The inspector describes the currently open document; placing it on another row would promise a panel for a target it cannot display.

## 9. Acceptance criteria if proceeding

- One module enumerates actions; no surface owns a separate list.
- Every action explains availability across all three axes in §4.1.
- New endpoints independently re-verify authorization and trust no client assertions.
- Toasts shift no layout. Every offered undo has a test asserting **restored state**, not merely toast appearance.
- Unavailable actions are absent from the palette **and** rejected by the server, with separate assertions.

## 10. Follow-up (2026-09-30): archive, folders, and registry additions

§8-2 deferred document archiving and said it could later become another entry. Personal daily-driver slice A-1 ([specification §7](2026-09-29-personal-daily-driver-design.md)) now does that. It mostly matches the prediction, but requires three additions:

- **`ActionTarget.sourceStatus`.** Previously `status` represented effective state: ACTIVE only when both document and source were ACTIVE, because archived sources permit no content changes. Restore must identify what was archived: an archived document in an active source may be restored; an archived source makes the service refuse until the source is restored. Carry both states separately.
- **`FolderTarget` and `ActionContext.folder`.** Folder rows have their own targets and the same availability axes: confirmed write capability, HUB_MANAGED ownership, target state, plus source state. Folder actions appear only on rows; the palette describes the document being read and has no folder target.
- **Two new effects.** `create-folder` requests a name; `folder-command` supports rename, archive, and restore. Document archive/restore uses the existing `command`, with a `label` for feedback.

**A-2 adds another effect and two entries (2026-09-30).** `move` requests a destination: `document.move` (“Move document…”) appears on rows and in the palette; `folder.move` (“Move folder…”) appears only on rows. Availability follows the three archive axes and additionally requires an ACTIVE source, since archived sources reject all content changes, including moves. Move appears before Archive, which stays last. The effect carries `sourceId`, title, and node identity: documents use `documentId` (all the palette has), folders use tree-node ID. The dialog locates the node in the tree. **Alt+↑/↓ reordering is not a registry action**: it has no menu or palette entry. It is a keyboard expression of the same move capability, so the tree handles it only when that row's registry includes Move.

**Three more undo rows (§6):** archive/restore document, archive/restore folder (mutually inverse; documents retain every revision and their position, and ARCHIVED is a lifecycle state rather than deletion), and rename folder (restore the previous name). **Creating a folder cannot be undone**: archiving it is not the same inverse operation.

**An exception to dismissal on next navigation.** Archiving the open document navigates to its list, where Undo must remain available. A toast may declare that its action navigates and survive all navigations within the next 3 seconds. This is plural: one push can cause several navigations as the router changes the URL and the destination redirects. E2E revealed that surviving just one navigation was insufficient.

**A side effect:** `requestWorkspaceAccessCheck` rechecks access for all 409 responses. During that check it suspends writes and flashes “Unable to confirm workspace.” Refusals such as a nonempty folder concern content, not authority. Therefore `FOLDER_NOT_EMPTY`, `INVALID_PARENT`, `TREE_CYCLE`, and `CROSS_SOURCE_MOVE` are excluded alongside `REVISION_CONFLICT`.
