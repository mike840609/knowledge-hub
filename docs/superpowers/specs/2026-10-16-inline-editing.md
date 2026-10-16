# Direct document editing — first increment

Writable, active Hub documents open an inline Milkdown editor on the canonical document URL. Opening a document neither focuses the editor nor writes a revision. Historical queries, archived sources/documents/workspaces, external sources and viewers remain read-only. Legacy `/edit` bookmarks redirect to the canonical document.

Use the reader frame, share actions, inspector, outline and backlinks. The title still follows metadata → opening H1 → typed title. Native borderless title and Markdown fields are intentional design-contract §3 exceptions, matching DocumentComposer's document surface rather than form controls.

Save changed snapshots after three seconds of inactivity, with a fifteen-second maximum wait during continuous input. Composition and authorization pauses take priority; an in-flight request always finishes before the next starts. Serialize PATCH requests against the last acknowledged revision; typing remains enabled during requests. Keep recovery text locally on each change; synchronize account recovery on failure or leaving, and deduplicate empty recovery clears after successful saves. Preserve recovery text independently of document persistence, stop on errors/conflicts, and require an explicit decision before publishing recovered drafts. Discarding recovery requires confirmation. A plain visit must not publish recovered content or normalized Markdown.

Comment creation and passage locations wait while the editor has unsaved content; existing discussions remain accessible. Update the title, timestamp and revision list locally after saves. Coalesce server-owned metadata and navigation refreshes into one thirty-second window, or refresh earlier when Details is opened, without replacing the editor. Do not rewrite immutable revisions or introduce collaborative merge semantics in this increment.

Verification covers no-write visits, save/reload, slow network typing, conflicts, recovery, readonly history, source fallback, and composition. Existing manual-save E2E scenarios need migration to the new interaction contract; new-document creation still uses its explicit Create workflow.

Normal saves show no status. A request still pending after one second shows Saving; its success is confirmed for two seconds. Failures and recovery remain visible in a stable toolbar slot.

## Typing-first keyboard behavior

Page and folder commands are invoked through explicit controls or the command palette. Remove global and row F (favorite), M (move), C (create), D (discussions), and R (rename) bindings and their visual/accessibility hints. Plain slash no longer opens global search; the editor retains its own slash behavior. Cmd/Ctrl+K opens the palette only when the event has not already been handled by the editor, and never during IME composition. Row arrows and J/K navigation remain local to the tree. Discussion buttons remain available on owner and shared pages.
