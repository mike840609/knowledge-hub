# Copy for Agent selection flow

Available and selected documents are presented separately. Selected items show their title, source, path and “Outside current results” status, and can be removed individually. Candidate lists have a bounded height; the action area is sticky on desktop and follows the content on mobile. Clearing the selection cancels pending requests; any selection change still invalidates the preview.

## Verification

These are historical verification results from the original comparison PR:

- Each PR branched independently from main `668aa03f`.
- Full unit suite: 1,658 tests passed.
- Lint, typecheck and Next production build passed.
- Browser verification: Hidden selected items remain in context, individual removal, disabled empty selection, saved revision provenance, preview invalidation and clipboard fallback.

## Before and after screenshots

Before uses main `668aa03f`; After uses the respective comparison branch. Captures use equivalent isolated data and state, desktop 1280×900 and mobile 390×844, in the light theme. Timestamps and UUIDs are generated per test run. Settings uses a fixed Team-owner persona; Audit comparison data includes two workspace-renaming events. These historical comparisons are separate from the freshly captured main README screenshots.

### agent-context

| View | Before | After |
|---|---|---|
| desktop | ![Before agent-context desktop](before/agent-context-desktop.png) | ![After agent-context desktop](after/agent-context-desktop.png) |
| mobile | ![Before agent-context mobile](before/agent-context-mobile.png) | ![After agent-context mobile](after/agent-context-mobile.png) |
