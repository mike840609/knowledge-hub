# Sources and Settings presentation

Sources provides a Needs attention filter and sorting by attention, name or latest successful sync. Pending Apply guidance is clearer, and Import scope shows exclusion counts and when rules are saved. Settings uses Active/Archived labels, collapsible member/group forms, compact lists and explanations of direct versus SSO permissions. Audit uses a timeline with loaded-event target filters and expandable technical details. Mobile member/group layouts stack vertically while preserving roles and actions.

## Verification

These are historical verification results from the original comparison PR:

- Each PR branched independently from main `668aa03f`.
- Full unit suite: 1,658 tests passed.
- Lint, typecheck and Next production build passed.
- Browser verification: Source status and successful-sync time, pending-preview navigation, team administration, role ceilings, permission revocation, archived races, folder import, desktop and mobile layouts.

## Before and after screenshots

Before uses main `668aa03f`; After uses the respective comparison branch. Captures use equivalent isolated data and state, desktop 1280×900 and mobile 390×844, in the light theme. Timestamps and UUIDs are generated per test run. Settings uses a fixed Team-owner persona; Audit comparison data includes two workspace-renaming events. These historical comparisons are separate from the freshly captured main README screenshots.

### sources

| View | Before | After |
|---|---|---|
| desktop | ![Before sources desktop](before/sources-desktop.png) | ![After sources desktop](after/sources-desktop.png) |
| mobile | ![Before sources mobile](before/sources-mobile.png) | ![After sources mobile](after/sources-mobile.png) |

### sources-import

| View | Before | After |
|---|---|---|
| desktop | ![Before sources-import desktop](before/sources-import-desktop.png) | ![After sources-import desktop](after/sources-import-desktop.png) |
| mobile | ![Before sources-import mobile](before/sources-import-mobile.png) | ![After sources-import mobile](after/sources-import-mobile.png) |

### settings-general

| View | Before | After |
|---|---|---|
| desktop | ![Before settings-general desktop](before/settings-general-desktop.png) | ![After settings-general desktop](after/settings-general-desktop.png) |
| mobile | ![Before settings-general mobile](before/settings-general-mobile.png) | ![After settings-general mobile](after/settings-general-mobile.png) |

### settings-members

| View | Before | After |
|---|---|---|
| desktop | ![Before settings-members desktop](before/settings-members-desktop.png) | ![After settings-members desktop](after/settings-members-desktop.png) |
| mobile | ![Before settings-members mobile](before/settings-members-mobile.png) | ![After settings-members mobile](after/settings-members-mobile.png) |

### settings-groups

| View | Before | After |
|---|---|---|
| desktop | ![Before settings-groups desktop](before/settings-groups-desktop.png) | ![After settings-groups desktop](after/settings-groups-desktop.png) |
| mobile | ![Before settings-groups mobile](before/settings-groups-mobile.png) | ![After settings-groups mobile](after/settings-groups-mobile.png) |

### settings-audit

| View | Before | After |
|---|---|---|
| desktop | ![Before settings-audit desktop](before/settings-audit-desktop.png) | ![After settings-audit desktop](after/settings-audit-desktop.png) |
| mobile | ![Before settings-audit mobile](before/settings-audit-mobile.png) | ![After settings-audit mobile](after/settings-audit-mobile.png) |
