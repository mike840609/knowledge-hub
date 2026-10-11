# Navigation surface comparison

The same seeded document, at 1440 × 1000, before and after the navigation
surface changes. Screenshots were captured after switching themes through
the account menu; only the document location retains the accent selection.

| Theme | Before | After |
| --- | --- | --- |
| Light | [Screenshot](before-light.png) | [Screenshot](after-light.png) |
| Dark | [Screenshot](before-dark.png) | [Screenshot](after-dark.png) |

The colour scheme and surface roles are defined in
[the design language](../../superpowers/specs/frontend-design-language.md#navigation-colour-scheme).

To refresh the after screenshots, set `KM_SIDEBAR_SCREENSHOTS` to an output
directory and run `npm run test:e2e -- zz-sidebar-comparison.spec.ts`.
