# Creating a document: the Notion page habit

A new note is already created and opened in the editor as soon as it is asked
for (`new-note-starter.tsx`). A 2026-11-17 audit pressed Create the way a Notion
writer does and found five places where it still answers differently. This spec
decides each and amends the design-language contract. Nothing stored changes.

## Decisions

1. **The Notes source's `+` is always in sight.** Notion's new-page button does
   not wait for a hover, so this one no longer does either. The folder button
   beside it still shows on hover (`.kh-row-action`).
2. **A folder row has its own `+`, on hover.** It runs the folder's existing
   **New document here** action. Its accessible name is
   "New document in ‹folder›". It takes no tab stop, because the row's menu
   already offers the action to the keyboard.
3. **What is typed straight after Create becomes the title.** Two moments have
   no field with focus: the new-note page is still loading, and the editor is
   still mounting. Keys typed in either were lost, which kept only the tail of
   the title, such as "iately" from "Typed immediately".

   - **The buffer.** `typing-ahead.ts` keeps plain characters and Backspace
     from the press until the title field takes focus. Every entry starts it:
     the sidebar `+`, Home's button and its `C` key, and the action runner,
     which covers the palette, row menus and the folder `+`. It stops by
     itself after ten seconds.
   - **The starter page.** While the note is being made, the starter shows a
     title field with what was typed so far.
   - **On arrival.** The editor takes the text as the title and puts the caret
     after it.
   - **Enter.** Pressed in that time, Enter ends the title and the caret goes
     to the body, as Enter in the title does. Keys typed after it, before the
     editor is ready, are not kept.
   - **Not kept, recorded.** An IME composes only into a focused field, so
     composed text typed before the field exists is not kept.
4. **A saved title names the document everywhere at once.** A save that changes
   the title refreshes the tree, the breadcrumb and the tab straight away.
   Before, it waited for the 30-second metadata refresh, so the tree said
   "Untitled" after the title had been typed and saved.
5. **One name, one hint.**
   - **The button.** Home's button reads **Create document**, the name the
     sidebar, the palette and the `C` key already use. It used to read
     "New note".
   - **The empty-document hint.** An empty document now reads "Write, or
     press / for commands". The old hint, "Write here. Start with # to name
     the document.", came from before the title field existed.

## Out of scope, recorded

- An empty note left behind stays, as an empty Notion page does. Removing it is
  a delete, and documents are never deleted (CLAUDE.md, lifecycle).
- A keyboard shortcut beyond `C` on Home and the palette's Create document:
  browsers keep `Mod-n` for a new window.

## Verification

- `tests/unit/typing-ahead.test.ts` covers the buffer: characters, Backspace,
  modifiers, fields, Enter, and the new-note address.
- `tests/e2e/zz-creation-flow.spec.ts` covers:
  - the `+` drawn at rest;
  - a title typed straight after the press;
  - the tree naming the document right after the save;
  - the folder `+`;
  - the empty-document hint.
- The existing keyboard-shortcut, authoring, row-action, explorer and organize
  e2e specs.
