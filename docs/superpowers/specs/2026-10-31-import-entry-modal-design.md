# Import folder: open over Sources instead of a page

Date: 2026-10-31
Status: Approved (2026-10-31)
Size: small change (short design)

## Intent

Importing a folder starts on the Sources page, but pressing **Import folder** replaces the list with a dedicated page. The setup is short and one-off, and losing the list makes the action feel heavier than it is. Keep the reader on Sources, open the setup as a modal, and leave the Preview as the addressable page it already is.

## What happens today

- Sources → **Import folder** navigates to `/w/:workspaceId/sources/import` as a full page.
- Choosing a folder uploads and finalizes in the browser; completion pushes `/w/:workspaceId/sources/imports/:snapshotId`.
- The Preview is resumable for 30 minutes and is linked from Home, Sources rows, profile sync, and freshness reminders; it must remain a page.
- `pagehide` aborts an in-flight import; unmounting the form does the same.

## Goals

- The Sources list stays rendered behind the import setup; Cancel / Esc returns to the same scroll position.
- Every existing entry keeps working: Sources header, Sources empty state, Home, help, sidebar, direct URL.
- Preview and Apply are unchanged.

## Non-goals

- Changing the upload / finalize / apply protocol or preview expiry.
- Moving the Preview into a modal or drawer.
- Changing **Update from folder** on a source detail (revisit later).
- Background imports that survive navigation.

## Anti-goals

- A second, divergent import form for the modal.
- Hiding the state of an in-flight import, or letting a stray click abort it silently.

## Approaches considered

**A. Modal over Sources (chosen).** Notion-style. Keeps the list mounted, the form fits at ~640px, and the scrim naturally blocks navigation while the upload runs.

**B. Right drawer (Linear-style peek).** The list stays visible, but exclusions (up to 50 paths) get cramped in a 420–480px panel. During upload the list stays clickable and any click would abort the import, so it would need to be locked anyway. On mobile the drawer collapses to the same full-screen sheet as A.

**C. Inline panel.** No overlay, but it lengthens the Sources page and gives progress and errors no clear boundary.

A wins because this is a one-off creation task, not inspecting an existing item. The list's only job is to be there when the reader comes back.

## Decided behavior

- The Sources header button and the Sources empty-state action open the modal.
- The URL becomes `/sources/import` while the modal is open (intercepting route), so Back closes it; refresh and direct links show the full page. Other entries (Home, help, sidebar, direct URL) keep the full page.
- The modal contains the existing form: source name, choose folder, exclusions (collapsed), sample wiki.
- Choosing a folder keeps the modal open and shows preparing / uploading / finalizing progress in place.
- While busy, the dialog cannot be dismissed (× disabled, Esc and backdrop ignored). **Cancel import** aborts, returns to idle, and then the modal can close.
- On success, navigate to the Preview page; the modal disappears with the route change.
- Mobile: the same modal, near-full-screen, scrolling inside the popup.

## Implementation shape

- Add `sources/layout.tsx` rendering `{children}` and a `@modal` slot; add `sources/@modal/default.tsx` returning null.
- Add `sources/@modal/(.)import/page.tsx` resolving the same workspace model and import limits, rendering the dialog; keep `sources/import/page.tsx` as the full-page fallback.
- Extract the shared body so the two routes do not fork: reuse `FolderImportForm` with a dialog presentation; the dialog owns title, description, close button, and calls `router.back()`.
- Add one callback (e.g. `onBusyChange`) so the dialog can lock dismissal; do not move import state out of the form.
- No API, schema, or Preview changes.

## Constraints

- The directory picker needs a user gesture; the modal's Choose folder remains that gesture.
- Upload and finalize are browser-side; closing the tab still aborts (existing behavior). Client-side Back during upload also aborts; blocking that is out of scope.
- Preview expiry and all existing deep links stay untouched.

## Open for the builder

- Exact dialog width (target ~40rem) and whether the exclusions block scrolls with the body.
- Whether busy-close should be blocked (proposed) or ask “Stop importing?”.
- Whether a later change should give **Update from folder** the same treatment.

## Verification

- Unit: both Sources entries open the dialog; close returns; busy blocks close; success pushes Preview.
- E2E: Sources → Import folder shows the modal with the list still present; `/sources/import` directly renders the full page; the sample folder reaches Preview; Back closes the modal.
- `npm run typecheck`, `npm run lint`, the relevant unit and e2e suites.
