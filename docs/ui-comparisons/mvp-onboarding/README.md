# MVP first-use onboarding

The Home guide appears after the first imported folder, between the page header and personal statistics. Existing Home actions and the empty-folder import action remain available. The guide explains the folder-authoritative model and manual Preview → Apply updates, then links to reading, workspace search, and preparing AI context. Links do not record completion.

- `desktop.png`: 1440 × 1000, freshly applied two-document folder. Guidance uses the existing page width, token typography, quiet divider, and text links.
- `mobile.png`: 390 × 844. Guidance wraps into the single-column Home flow and the Hide guidance control remains beside its heading. The browser test asserts that the page has no horizontal overflow.

Captured by `tests/e2e/onboarding.spec.ts` against the production build with an isolated MariaDB database. Inspected both images for wrapping, hierarchy, and control placement. Hide guidance persists in owner-scoped `personal_items` under `prefs:onboarding`, surviving another browser context. CAS rejects stale writes; malformed values and inaccessible workspaces are refused. Guidance is intentionally introductory rather than a completion checklist.

Validation: 20 focused unit tests passed; feature E2E passed (one browser worker, port 3811), including real folder import, link navigation without dismissal, cross-context persistence, CAS 409, schema 400, and inaccessible-resource 404. Production build, lint, and TypeScript checks passed. Shared preference integration coverage additionally checks actual MariaDB CAS, restart persistence, and owner-only authorization.
