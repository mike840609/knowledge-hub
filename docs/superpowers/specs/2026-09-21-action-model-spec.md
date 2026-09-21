# Action Model — Design Spec

| Item | Value |
| --- | --- |
| Date | 2026-09-21 |
| Type | Design spec, for review before code |
| Answers | Contract open items 1 (`⌘K`), 2 (toast/undo), 3 (empty/error guidance), 4 (context menus) |
| Contract | `docs/superpowers/specs/frontend-design-language.md` |
| Status | **Proposed. Not agreed.** Section 8 is the part that needs a decision. |

## 1. Why these four items are one spec

They are four exits from the same missing thing. `⌘K` as a command palette, a
context menu on a row, "what can I do here" in an empty state, and the toast
that reports what an action did all need the same list: **what can be done,
by whom, to what, right now**. Written separately, that list gets designed
four times and agrees with itself by accident.

This product has no such list. Every action is bound to the surface that
happens to show it — editing lives on a button in the document header,
importing on a button in an empty state, archiving in a settings panel — and
nothing can enumerate them.

## 2. What is actually there today

Measured against `main` @ `7275641`, because three of the four items describe
the product slightly wrongly and a spec built on that would inherit the error.

**Mutations reachable from the UI**, in full:

```text
Knowledge   create a document          POST /api/workspaces/:id/documents
            edit a document            PATCH /api/documents/:id
Sources     apply an import preview    POST /api/source-imports/:id/apply
Workspace   archive / restore          POST /api/workspaces/:id/archive|restore
            rename                     PATCH /api/workspaces/:id
Members     add / change role / remove  …/members
Groups      add / change role / remove  …/groups
Local only  favourite a document, remember recents (localStorage)
```

**Corrections to open item 4.** It reads "renaming, archiving and copying a
link all require opening the document first".

- Renaming a document: true, it is the title field in the editor.
- **Archiving a document does not exist.** Not in the UI, not in the API. The
  document routes are POST and PATCH only. Documents reach `ARCHIVED` through
  a source re-sync, never through a person.
- **Copying a link does not exist.** The `Copy` button in the Inspector
  copies a document or source **ID**, which is a support affordance, not a
  share one.

**Correction to open item 1.** `⌘K` does not only "execute search" — it opens
a palette that searches documents, moves by arrow key, has
`aria-activedescendant`, and opens a hit. What it lacks is anything that is
not a document.

## 3. The finding that should decide whether to do this at all

Count what a palette could offer today, generously:

```text
navigation   Knowledge · Sources · Settings · switch workspace · open a document
creation     Add to Notes · Import knowledge
document     Edit · Open details · Favourite · Show archived
workspace    Archive · Restore · Settings tabs
```

Roughly fourteen entries, and **the majority are navigation**. The reference
product's palette is valuable because the product has a hundred commands;
ours would be a fast way to go somewhere, plus four things to do.

That is still worth something — "go somewhere fast" is most of what a palette
is used for — but it should be named honestly rather than sold as parity. **A
command palette does not create commands.** If the goal is that a reader can
act without hunting, the prior question is which actions this product should
have, and that is a product decision, not a UI one.

Section 8 puts that question first.

## 4. The model

One module owns the list. Nothing else enumerates actions.

```ts
type ActionId = "document.edit" | "document.favourite" | "knowledge.create" | …

type Action = {
  id: ActionId;
  label: string;                  // imperative: "Edit document"
  group: "navigate" | "create" | "document" | "workspace";
  shortcut?: string;              // aria-keyshortcuts spelling
  /** Where it may appear. A row menu shows `row`; the palette shows `palette`. */
  surfaces: readonly ("palette" | "row" | "empty")[];
  /** Whether the action is offered, given what the caller can do and what the
   *  target is. Never a security decision — see below. */
  available: (context: ActionContext) => boolean;
  run: (context: ActionContext) => void | Promise<ActionResult>;
};
```

### 4.1 Availability has three axes, not one

The UI already reads `access.actions.*` for workspace capability. That alone
is not enough, and conflating the axes is the mistake `CLAUDE.md` names:

1. **Workspace capability** — `canWrite`, `canImport`, `canOpenSettings`…
2. **Source ownership** — `SOURCE_MANAGED` content is read-only in the Hub
   however much capability the caller has. "Workspace access and source
   ownership are separate questions and must not be conflated."
3. **Target state** — an archived workspace offers Restore, not Archive.

### 4.2 The registry is not authorization

Stated here because a palette makes it tempting to think otherwise:

> Possessing a `workspace_id`, `source_id` or `document_id` grants nothing.
> URL parameters are navigation inputs, never authorization proof, and the
> application service must re-verify policy regardless of what the UI allowed.

`available()` decides **what to show**. The service decides **what happens**.
An action hidden from the palette must still be refused by the server, and
this spec adds no endpoint that trusts the caller's claim about itself.

## 5. The three surfaces

**Palette (`⌘K`).** Keeps its current search behaviour and gains an action
section above the hits. Typing filters both. Actions are grouped by §4's
`group`; the empty query shows actions and recents rather than nothing.

**Row menu.** The existing `ui/menu` primitive, opened from a row's `⋯`
button **and** by right-click on the row. Right-click alone would hide the
actions from keyboard and touch, which §10 forbids in the same breath as it
requires arrow-key movement.

**Empty state.** Open item 3 asks for guidance rather than a bare heading.
The registry answers it directly: an empty state lists the actions whose
`surfaces` include `empty` and that are available here, which is the same
question a reader is asking. This also removes the one place the current
empty state has to hard-code two buttons.

## 6. Feedback: toast and undo

Current state is a `role="status"` paragraph that shifts layout when it
appears. (§18 item 2 once said no `aria-live` region exists; that was wrong —
`role="status"` carries an implicit `aria-live="polite"`. The gap is the
layer, not the announcement.)

Proposed: one toast region, `role="status"` `aria-live="polite"`, fixed to a
corner so it displaces nothing, one toast at a time, dismissed on the next
navigation.

**Undo is offered only where the inverse already exists as a real operation.**
An "Undo" that cannot restore the prior state is a lie, and this codebase has
no soft-delete to lean on. Today that means:

| action | undo | why |
| --- | --- | --- |
| archive workspace | **yes** — restore | the inverse endpoint exists |
| change a member's role | **yes** — set it back | previous role is known |
| remove a member or group | **yes** — re-add | the grant is reconstructible |
| edit a document | **no** | creates a revision; reverting is a new revision, which is a feature, not an undo |
| apply an import | **no** | the spec's own rule: no force apply, no rollback |

Two-step inline confirmation stays **only** where undo is impossible and the
consequence is large. Where undo exists, act and offer undo — the reference
behaviour, and what the contract's §18 item 2 asks for.

## 7. What this spec does not decide

**Document archive is a domain change, not a UI feature.** Adding it means an
endpoint, a lifecycle transition, a rule for what happens when a
`SOURCE_MANAGED` document is archived in the Hub and the next sync disagrees,
and an audit entry. It touches the knowledge module, not `components/`. It is
out of scope here and should be its own spec if it is wanted.

The registry is designed so that adding it later is a new entry, not a
redesign.

## 8. What needs a decision before any code

1. **Is a mostly-navigational palette worth building now?** §3 is the honest
   count. If the answer is "not yet", items 1 and 4 should be deferred
   explicitly rather than left looking like pending work — and items 2 and 3
   can still proceed, because the toast layer and empty-state guidance do not
   depend on the palette.
2. **Should document archive exist?** If yes, it is a prior domain spec and
   this one waits for it. If no, open item 4 should be reworded, because its
   premise is a product capability that was never built.
3. **Right-click on rows, or only the `⋯` button?** Right-click is the
   reference behaviour and costs a `contextmenu` handler; the button alone is
   less discoverable but has no surprise.

## 9. Completion criteria, if it proceeds

- One module enumerates actions; no surface has its own list.
- Every action states availability across all three axes of §4.1.
- No endpoint added by this work trusts a client claim; each re-verifies.
- The toast region displaces no layout, and every undo offered restores the
  prior state in a test that asserts the state, not the toast.
- An action unavailable to the caller is absent from the palette **and**
  refused by the server, asserted separately.
