# User guide illustrations verification

- `npx tsc --noEmit`: passed.
- Targeted ESLint (illustration, help page, guide browser test): passed.
- `git diff --check`: passed.
- Impeccable detector for changed UI sources: no findings.
- `KM_GUIDE_SCREENSHOTS=/tmp/user-guide-illustrations npm run test:e2e -- tests/e2e/user-guide.spec.ts`: 1 browser test passed, including production build and isolated database cleanup (run `369eb626-111d-4bae-bada-93d1213484cd`).
- Browser test checks existing bilingual navigation, six named figures, translated content, all six figures at 390/1440px in light/dark themes, and no document horizontal overflow.
- Visually inspected desktop import, mobile sharing and mobile dark reading screenshots. Text remains legible, flow stacks on mobile, and diagrams follow the existing theme palette.

Screenshots are local artifacts in `/tmp/user-guide-illustrations/`; original guide information is retained in concise bullets and named expandable details. No product actions or permission rules changed.

## Copy refinement verification

- Both locales now have 17 primary bullets instead of 36 long numbered entries.
- Advanced rules and recovery explanations remain available in 10 named native
  disclosures per locale; important Apply/public-sharing/export guidance stays visible.
- TypeScript, targeted ESLint, diff whitespace check and UI detector passed again.
- Production build and guide browser test passed in run
  `1591f58e-94b3-46cd-af7b-1cbbefc440ec` (1/1 test).
- Added behavior checks: details start closed, Enter opens an English recovery
  disclosure, and clicking the Chinese exclusions summary reveals its rules.
- Inspected updated desktop and mobile page screenshots in
  `/tmp/user-guide-simplified/`; desktop now shows three short bullets below each
  initial workflow diagram, with advanced details collapsed.

## Layout refinement verification

- TypeScript, targeted ESLint, UI detector and whitespace checks passed.
- Production build and expanded guide browser test passed (1/1), run
  `78a2e907-20b7-42a8-bf02-e449f6362a39`.
- The test verifies the desktop chapter navigation stays inside the viewport after
  scrolling to Insights, and that the mobile chapter menu opens and navigates to
  the reading anchor. Existing bilingual disclosure checks still pass.
- All six figures checked at 390/1440px in both themes without horizontal overflow.
- Visually inspected desktop viewport, mobile viewport and the lighter Insights
  section. Screenshots: `/tmp/user-guide-layout/desktop-zh.png`,
  `/tmp/user-guide-layout/mobile-zh.png`, `/tmp/user-guide-layout/insights-section.png`.
- Full desktop capture: `/tmp/user-guide-layout/desktop-full-zh.png`.

## Chapter navigation verification

- Bilingual short labels, current-section styling / `aria-current=location`, and
  mobile auto-close with target-heading focus implemented in a client component.
- TypeScript, targeted ESLint, UI detector and diff whitespace check passed.
- Final production build and expanded guide browser test passed (1/1), run
  `f081e02b-1697-47c0-9308-0e87532cf34e`.
- Browser assertions cover passive-scroll current-section updates, last-section
  marking at the bottom, desktop sticky position, mobile pointer and Enter
  navigation, automatic menu closure and heading focus, plus prior translations,
  disclosures and responsive/light-dark checks.
- Earlier runs exposed native fragment navigation overriding synchronous focus;
  heading focus now follows the native jump in the next animation frame. A final
  section aligned to the viewport bottom can leave page padding below it, so
  bottom detection uses the final section's visible boundary. The test also uses
  a middle section for passive-scroll checks, avoiding ambiguous end-of-page
  alignment, and independently asserts final-section marking.
- Updated screenshots visually inspected in `/tmp/user-guide-navigation/`:
  `desktop-zh.png`, `desktop-active-zh.png`, `mobile-selected-zh.png`.

## Contextual link verification

- Added bilingual action links next to first-import and sync guidance, plus Sources
  and knowledge_id links inside the exclusions/renaming disclosure.
- TypeScript, targeted ESLint, UI detector and diff whitespace checks passed.
- Initial browser launch was blocked by occupied port 3101; no existing service was
  terminated. Reran using `KM_E2E_PORT=3127` and isolated database.
- Production build and guide browser test passed (1/1), run
  `64014e41-3ff3-4205-910b-c5f8d957910a`.
- Browser test clicks the English preview section, Chinese knowledge_id section,
  sample wiki group and Sources entry; asserts workspace-relative destinations,
  preserved guide language, example content and return navigation. All previous
  navigation/disclosure/theme/responsive checks remain passing.
- Visually inspected `/tmp/user-guide-context-links/quick-start-section.png`:
  contextual links appear directly after short instructions, before optional details.

## PR preparation on current main

- Moved the scoped guide changes to `codex/user-guide-illustrations`, based on
  `origin/main` at `a043544` (PR #168 was already merged). No merge conflicts.
- Installed the current lockfile with `npm ci`.
- Related import-guide unit tests: 29/29 passed.
- Production build and full guide browser case: passed (1/1), isolated port 3127,
  run `aa0fd356-446f-4d71-9963-7e36498fb593`.
- Standalone TypeScript, targeted ESLint and whitespace checks passed. The first
  standalone typecheck ran while the build regenerated `.next/types` and reported
  missing generated files; reran successfully after the build completed.
- Inspected the updated desktop screenshot at `/tmp/user-guide-pr/desktop-zh.png`.
  Existing light/dark, mobile, focus, disclosure and contextual link assertions passed.

## CI breadcrumb alignment fix

- PR #181 run `38324631861` failed only in the breadcrumb alignment browser case:
  Help's breadcrumb x=312 instead of the standard x=376 at 1440px. The e2e
  aggregate failed because that shard failed; other jobs passed.
- Cause: the guide's widened grid container also widened its PageHeader.
- Fix: keep header/introduction/actions in `kh-page`; place only the navigation
  and article grid in `kh-page-wide`, as required by the design contract.
- Existing breadcrumb test unchanged. Targeted ESLint and whitespace checks passed.
- Production build and both browser files passed (2/2): breadcrumb-alignment and
  user-guide, run `53340171-a71d-4fc2-8527-db95a02c57b2` on isolated port 3127.
- Updated desktop screenshot inspected at `/tmp/user-guide-ci-fix/desktop-zh.png`.
