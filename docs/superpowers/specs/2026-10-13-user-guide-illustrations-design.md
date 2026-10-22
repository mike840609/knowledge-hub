# User guide illustrations

The in-app user guide currently presents six dense ordered lists. Add an inline,
bilingual figure before each list so readers can see the workflow or relationship
before reading the full instructions. Preserve existing content, links and access.

Use semantic HTML and the existing Lucide icons / design tokens, not screenshots
with tiny baked-in text. Figures are explanatory, explicitly labeled as diagrams,
and contain no fake interactive controls. Localize explanations in English and
Traditional Chinese while retaining actual English interface labels. Small screens
stack flows in reading order; light/dark themes use existing palette variables.

Coverage: root-folder selection and import stages; manual sync and Apply boundary;
recovery paths; reading navigation and account/device persistence; Insights period
scope; public sharing, sign-in for comments, collapsed discussion entry and saving
links. Do not imply automatic syncing, copied shared content or workspace access.

Verify the existing guide navigation and translations, all six figures, responsive
overflow and dark theme in the browser; run TypeScript and ESLint. This is a scoped
help-content refinement, with no changes to product actions or global tokens.

## Copy refinement

After desktop inspection, the added figures still duplicated the original long
lists. Keep primary actions short, remove facts already visible in the adjacent
figure, and move advanced explanations into native `details` disclosures with
specific bilingual summaries. Keep high-consequence guidance visible: choosing the
complete root, successful Apply, suspicious archives, uncertain Apply outcomes,
public link visibility and export exclusions. Preserve all recovery paths and
product constraints; disclosure changes presentation, not availability.

## Layout refinement

Use a wide guide container, with a 176px sticky chapter navigation beside the
reading column at xl widths. Below xl, show one native expandable chapter menu.
Keep import actions with the introduction, separate from in-page navigation.
Use existing spacing tokens: section boundaries combine margin and padding for
clearer separation, without adding a spacing scale. Concept/comparison figures
(reading, troubleshooting, Insights) use simple rules and less chrome; sequential
import, sync and sharing figures retain their frame. Verify navigation, disclosures,
light/dark, desktop/mobile overflow and capture whole-page/viewport evidence.

## Chapter navigation behavior

Short chapter labels are separate from full section headings. A small client-side
navigation component marks the currently read section with `aria-current=location`
and existing selected/primary tokens, updating on scroll, resize and content-size
changes. Do not move focus during passive scrolling. Native anchor navigation keeps
URLs and browser history; choosing a mobile chapter closes the menu before scrolling
and focuses the target heading. Modified clicks retain native browser behavior.

## Contextual links

Place bilingual, workspace-relative links next to relevant guidance: quick-start
links to the existing `sources/import#sample-wiki` group and preview guide section;
sync links to Sources for choosing an existing source; the exclusions/renaming
explanation links to Sources and the existing `keep-in-sync` identity guidance.
Preserve guide locale in guide links. Do not invent a source ID or route readers to
new-source import for existing-source exclusions. Links only navigate; no sync,
import or settings mutation is triggered.

## Header alignment correction

The guide's PageHeader, introduction and entry links retain the standard `kh-page`
container to honor the cross-page breadcrumb origin. Only the chapter-navigation
and article grid uses `kh-page-wide`, following the same composition as Graph.
The existing breadcrumb alignment test remains unchanged.

## Real screenshots (2026-10-22)

Amends the opening rule against screenshots. Each workflow chapter except
Troubleshooting now pairs its diagram with real screens: the diagram explains why,
the screen shows where. The original concern was tiny baked-in text, so screens
are cropped to the relevant region at 2x pixel density rather than whole windows,
and the control to use is outlined in the focus colour. Each screen exists in
light and dark and follows the app's `data-theme`; captions state the action in
the guide's language, and the caption doubles as alt text. A pictured page looks
exactly like the guide around it, so each screen is framed as a window (neutral
title bar with three dots and the page name, decorative and `aria-hidden`) and
lifted with `shadow-popover`, so its controls never read as the guide's own. The
window alone does that; no tray around it.

Screens come from a fresh account and the zh-TW sample wiki, captured by
`tests/e2e/user-guide-screenshots.spec.ts` (`make guide-screenshots`, skipped in
the normal suite). They are committed under `src/components/help/screens/` and
served through `next/image`. A pictured screen that changes is re-captured, not
hand-edited. The sample source has no remembered folder, so the sync screen
shows Update from folder; its caption says Check for changes appears beside it
when the browser remembers the folder.

## Diagrams and screens divide the work

Beside real screens, diagrams that imitated the interface showed the same page
twice, once real and once drawn. A screen now answers where and what to press; a
diagram only what a screen cannot show: order, cause and where a rule applies.
Reading no longer draws a sidebar and article; it contrasts Favorites (kept on the
account) with Recent (kept on this device). Sharing keeps its flow and drops the
drawn article and comments panel; selecting a passage to comment moves into the
flow's last step. Every diagram is flat on `bg-subtle`, with no border, caption bar
or shadow, so a framed, lifted window always means a real screen.
