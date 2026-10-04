# Insights and Home design consistency

Insights uses the shared PageHeader and kh-page layout, with shadow-free segmented period controls. Typography, spacing and radii follow existing design scales; ordinary control shadows and unused styles are removed. Home search uses the Input primitive for borders, sizing and focus treatment.

## Verification

These are historical verification results from the original comparison PR:

- Each PR branched independently from main `668aa03f`.
- Full unit suite: 1,658 tests passed.
- Lint, typecheck and Next production build passed.
- Browser verification: Personal statistics, detail links, 7/30-day switching, refresh, light/dark themes and mobile layout; Home search and the existing overview.

## Before and after screenshots

Before uses main `668aa03f`; After uses the respective comparison branch. Captures use equivalent isolated data and state, desktop 1280×900 and mobile 390×844, in the light theme. Timestamps and UUIDs are generated per test run. Settings uses a fixed Team-owner persona; Audit comparison data includes two workspace-renaming events. These historical comparisons are separate from the freshly captured main README screenshots.

### profile

| View | Before | After |
|---|---|---|
| desktop | ![Before profile desktop](before/profile-desktop.png) | ![After profile desktop](after/profile-desktop.png) |
| mobile | ![Before profile mobile](before/profile-mobile.png) | ![After profile mobile](after/profile-mobile.png) |

### home

| View | Before | After |
|---|---|---|
| desktop | ![Before home desktop](before/home-desktop.png) | ![After home desktop](after/home-desktop.png) |
| mobile | ![Before home mobile](before/home-mobile.png) | ![After home mobile](after/home-mobile.png) |
