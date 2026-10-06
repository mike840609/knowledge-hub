# Sample Wiki and Import Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a new reader import a ready-made sample wiki with one click from the import page, and read an in-app, bilingual guide on what a Markdown folder must look like to import well.

**Architecture:** Sample files are static assets in `public/sample-wiki/<locale>/` with a manifest. A button on the import page fetches them in the browser, builds `File` objects with a `webkitRelativePath`, and feeds the existing import flow (`handleFiles` → `runFolderImport`), so Preview and Apply are unchanged. The guide is a server-rendered page under the import route with two TSX content objects and limits read from the server's import configuration.

**Tech Stack:** Next.js 15 (App Router, server components), React, Vitest (`tests/unit`, jsdom where noted), Playwright (`tests/e2e`).

**Spec:** `docs/superpowers/specs/2026-10-06-sample-wiki-import-guide-design.md` (approved). Executors read both; the spec wins on conflict.

## Global Constraints

- The sample import goes through the **same** flow as a picked folder; no new server route, no new write path, no special case in the importer or its domain code.
- Control text on the import page and the guide's chrome is English; the sample wiki's **content** and the guide's **body** exist in English and Traditional Chinese (Taiwan usage, 繁體中文). Do not invent facts about any third-party wiki tool; name only Obsidian.
- The sample has exactly **seven files per locale**, the layout in the spec §2.2, **every link resolves**, and **exactly one deliberate diagnostic per locale** (`TITLE_CONFLICT` from `handbook/title-mismatch.md`). No attachments, no `.git`/`.obsidian`, no real company information.
- The guide reads its numeric limits from `importRuntimeConfig().limits` (`src/server/import-config.ts`); never hard-code them.
- Frontend: only tokens defined in `tailwind.config.ts` (`text-body`, `text-caption`, `text-heading`, `rounded-md`, …); colours only through CSS variables (`text-kh-*`, `bg-kh-*`); spacing on the 2px-base ladder; semantic HTML; visible focus via `kh-focus-ring`. Read `docs/superpowers/specs/frontend-design-language.md` §1–§9 and §15 before touching `src/components` or `src/app`.
- Do not weaken or delete existing tests. Never assert a toast with a bare `getByRole("status")`.
- Commands: use `make …` or `node_modules/.bin/…`, never bare `npm`/`npx` (an nvm shell function breaks them). Do not pipe command output in a way that hides an exit code. Before e2e: `lsof -nP -iTCP:3101 -sTCP:LISTEN`; if another worktree holds the port, wait, never kill it.
- `tests/e2e/onboarding.spec.ts` rewrites tracked files under `docs/ui-comparisons/mvp-onboarding/` on every run. Before each commit run `git status --short`; if those two PNGs appear, restore them with `git checkout -- docs/ui-comparisons/mvp-onboarding/` and never commit them.
- Commit messages end with `Claude-Session: https://claude.ai/code/session_01QnFD3TyBBPqjvZRJd15Ddq`. Do not push.

## File Structure

```text
Create  public/sample-wiki/manifest.json
Create  public/sample-wiki/en/**            7 Markdown files
Create  public/sample-wiki/zh-TW/**         7 Markdown files
Create  src/components/imports/sample-wiki.ts            loadSampleFiles(locale, fetcher)
Create  src/components/imports/sample-wiki-import.tsx    the "Try with a sample wiki" control
Modify  src/components/imports/folder-import-form.tsx    handleFiles accepts File[] and a source-name override; renders the control
Modify  src/app/w/[workspaceId]/sources/import/page.tsx  guide link
Create  src/app/w/[workspaceId]/sources/import/guide/page.tsx
Create  src/components/imports/import-guide-content.ts   the two content objects (en, zh-TW)
Create  tests/unit/sample-wiki.test.ts
Create  tests/unit/sample-wiki-loader.test.ts
Create  tests/unit/import-guide-content.test.ts
Create  tests/e2e/sample-wiki-import.spec.ts
Modify  README.md
Modify  docs/superpowers/specs/2026-10-06-sample-wiki-import-guide-design.md   status
```

---

### Task 1: Sample wiki assets, manifest and their guard tests

**Files:**
- Create: `public/sample-wiki/manifest.json`, `public/sample-wiki/en/**`, `public/sample-wiki/zh-TW/**`
- Test: `tests/unit/sample-wiki.test.ts`

**Interfaces:**
- Consumes: the project's own `resolveImportTitle` (`src/modules/sources/domain/import-title.ts`), `buildLinkResolver` / `normalizeLinkKey` / `resolveRelativeSourcePath` (`src/modules/knowledge/domain/link-resolution.ts`), the link extractor in `src/modules/knowledge/domain/document-links.ts`, `parseMarkdown`-style frontmatter handling used by the importer (find how `frontmatterTitle` and `firstH1` are produced for an import and reuse that exact code in the test), and `DEFAULT_IMPORT_LIMITS` (`src/modules/sources/domain/import-limits.ts`).
- Produces (for Task 2 and 3): `public/sample-wiki/manifest.json` with this exact shape:

```json
{
  "locales": {
    "en":    { "label": "English",  "sourceName": "Sample wiki",  "root": "sample-wiki-en",    "files": ["index.md", "handbook/onboarding.md", "handbook/leave-policy.md", "handbook/title-mismatch.md", "concepts/links.md", "concepts/sync.md", "reference/glossary.md"] },
    "zh-TW": { "label": "繁體中文", "sourceName": "範例知識庫", "root": "sample-wiki-zh-TW", "files": ["index.md", "handbook/onboarding.md", "handbook/leave-policy.md", "handbook/title-mismatch.md", "concepts/links.md", "concepts/sync.md", "reference/glossary.md"] }
  }
}
```
  The files for locale `L` live at `public/sample-wiki/<L>/<path>`; the browser imports them as `<root>/<path>`.

- [ ] **Step 1: Write the failing guard tests**

`tests/unit/sample-wiki.test.ts` (Node environment). Requirements, each one a test with a clear name:

1. the manifest lists exactly the files that exist under `public/sample-wiki/<locale>/` (walk the directory; no extra, none missing);
2. both locales list the same relative paths (same structure), exactly seven;
3. no path contains a `.git` or `.obsidian` segment; every file is `.md`; every file is below `DEFAULT_IMPORT_LIMITS.maxMarkdownFileBytes` (and in practice below 8 KiB — assert that too so the sample stays small);
4. **every link resolves**: for each locale build a catalog from the files exactly as the importer would see them (title via `resolveImportTitle` with the frontmatter title / first H1 the importer extracts, path as the source path), extract each document's links with the project's extractor, resolve them with `buildLinkResolver(...)`, and assert there is no `UNRESOLVED` link and no `ambiguousWith > 0` anywhere. The sample must cover all of: a `[[Title]]` link, a bare-stem wikilink, a path-qualified wikilink `[[concepts/links]]`, a relative `.md` link, and a link to a heading anchor — assert the extractor reports at least one link of each kind across the locale (use the extractor's own kind field);
5. **exactly one `TITLE_CONFLICT` diagnostic per locale**, and it is on `handbook/title-mismatch.md`; no other diagnostic of any severity from `resolveImportTitle` for any file;
6. the zh-TW files contain Traditional Chinese text (assert at least one CJK character in each file's body) and at least one Chinese heading that is used as an anchor target by a link in the same locale;
7. frontmatter titles: `index.md` has a frontmatter `title`; at least one file gets its title from the first H1 (`source === "H1"`).

If the importer has a function that parses frontmatter and the first H1 from raw Markdown, call it; do not reimplement frontmatter parsing in the test.

- [ ] **Step 2: Run, see it fail**

Run: `node_modules/.bin/vitest run --config vitest.config.ts tests/unit/sample-wiki.test.ts`
Expected: FAIL (the manifest and files do not exist).

- [ ] **Step 3: Write the manifest and the fourteen files**

Content brief (write it as natural prose a team might keep; the Chinese is Traditional Chinese written natively, not a literal translation of the English):

- `index.md` — frontmatter `title: Team handbook` / `title: 團隊手冊`; two sentences; links: `[[handbook/onboarding]]`, `[[leave-policy]]` (bare stem), `[[concepts/links]]`, `[[Glossary]]` (a `[[Title]]` form; the glossary's title is "Glossary"/"詞彙表").
- `handbook/onboarding.md` — H1 "Onboarding" / "新人報到"; a `## First week` / `## 第一週` section; a relative link `[leave policy](./leave-policy.md)`; an anchor link into the leave policy `[how to request leave](./leave-policy.md#<slug>)`; a link back to `[[index]]`.
- `handbook/leave-policy.md` — H1 "Leave policy" / "請假規定"; headings "How to request leave" / "請假流程" (the slug is the link target above; for zh-TW it must be the project's own `headingSlug` result for the Chinese heading — compute it with `headingSlug` from `src/shared/markdown/heading-slug.ts` and write the literal slug into the link), and "Approvals" / "核准"; mention a manager approval; link to `[[onboarding]]`.
- `handbook/title-mismatch.md` — frontmatter `title: Expense rules` / `報銷規則`, H1 "Expense policy (draft)" / "報銷政策（草稿）"; one paragraph telling the reader that this file is **on purpose** inconsistent: Preview will show one warning ("frontmatter.title differs from the first H1") and the frontmatter title wins. Link to `[[concepts/sync]]`.
- `concepts/links.md` — H1 "Links" / "連結"; explains the forms with live examples that resolve: `[[Title]]`, `[[folder/Note]]` (shortest path, e.g. `[[handbook/leave-policy]]`), relative `.md`, heading anchors; one sentence that links resolve only inside one workspace.
- `concepts/sync.md` — H1 "Keeping in sync" / "保持同步"; explains one-way sync (the local folder is authoritative, imported documents are read-only in the Hub, removed files become archived, select the folder again then Preview → Apply); links `[[index]]` and `[[reference/glossary]]`.
- `reference/glossary.md` — H1 "Glossary" / "詞彙表"; five short definitions: source, Preview, Apply, archive, wikilink; links back to `[[concepts/links]]`.

Make each locale's seven files self-consistent; the Chinese files link to the Chinese siblings. Titles used in `[[Title]]` links must equal the resolved titles exactly.

- [ ] **Step 4: Run, see it pass; run the whole unit suite**

Run: `node_modules/.bin/vitest run --config vitest.config.ts tests/unit/sample-wiki.test.ts` then the whole `tests/unit` directory, and `make typecheck lint`.
Expected: all pass. If a link does not resolve, fix the **sample content**, not the test.

- [ ] **Step 5: Commit**

```bash
git add public/sample-wiki tests/unit/sample-wiki.test.ts
git commit -m "feat(import): sample wiki (en, zh-TW) and the tests that keep its links and diagnostics honest"
```

---

### Task 2: "Try with a sample wiki" on the import page

**Files:**
- Create: `src/components/imports/sample-wiki.ts`, `src/components/imports/sample-wiki-import.tsx`
- Modify: `src/components/imports/folder-import-form.tsx` (`handleFiles` near line 465; render the control; `runFolderImport` already accepts `File[]`)
- Test: `tests/unit/sample-wiki-loader.test.ts` (jsdom), `tests/e2e/sample-wiki-import.spec.ts`

**Interfaces:**
- Consumes: Task 1's `manifest.json` shape.
- Produces:

```ts
// src/components/imports/sample-wiki.ts
export type SampleLocale = "en" | "zh-TW";
export type SampleWiki = { files: File[]; sourceName: string; root: string; label: string };
export async function loadSampleWiki(locale: SampleLocale, fetcher?: typeof fetch): Promise<SampleWiki>;
```
  Each returned `File` has name = last path segment, `type: "text/markdown"`, content = the fetched text, and an own property `webkitRelativePath` = `<root>/<path>` (use `Object.defineProperty(file, "webkitRelativePath", { value, enumerable: true })`). It throws an `Error` with a clear message if the manifest or any file cannot be fetched (non-2xx) — never returns a partial list.
  `handleFiles(files: FileList | File[] | null, sourceNameOverride?: string)` in the form: when `sourceNameOverride` is given it is used instead of the `sourceName` state for this import (state would be stale in the same tick).

- [ ] **Step 1: Write the failing unit test** (`tests/unit/sample-wiki-loader.test.ts`, `// @vitest-environment jsdom`): with a fake `fetcher` serving the real `public/sample-wiki` files from disk (read with `node:fs`), `loadSampleWiki("en", fake)` returns seven `File`s, each with the right `webkitRelativePath` (`sample-wiki-en/index.md`, …), the right text, `sourceName === "Sample wiki"`; `zh-TW` likewise with `範例知識庫`; when the fake returns a 404 for one file it rejects with an error naming the path and returns nothing; when the manifest request fails it rejects. Also assert the files, fed to the same relative-path logic the form uses, would produce root `sample-wiki-en` (export `relativePathOf`/`selectFolder` from the form module only if they are not exported already and exporting them is a no-op change; otherwise assert on `webkitRelativePath` directly).
- [ ] **Step 2: Run, see it fail** (`node_modules/.bin/vitest run --config vitest.config.ts tests/unit/sample-wiki-loader.test.ts`).
- [ ] **Step 3: Implement** `sample-wiki.ts`, the `SampleWikiImport` component (a labelled group "Try with a sample wiki", one sentence "Not sure what a folder should look like? Import a ready-made one and see Preview before anything is saved.", and one button per locale showing its `label`; `disabled` while an import is running; shows an inline `role="alert"` message on fetch failure; uses the existing `Button`), and the form change: render it only when `target.kind === "new"`, below the folder picker and above the status line; the click handler does `const sample = await loadSampleWiki(locale); await handleFiles(sample.files, sample.sourceName);`. Keep `handleFiles`'s current behaviour for a picked folder exactly (including remembered-folder handling, which is skipped for a sample because there is no directory handle).
- [ ] **Step 4: Write the e2e** `tests/e2e/sample-wiki-import.spec.ts` following `tests/e2e/mvp-discovery-agent.spec.ts` (personal workspace id from `/api/workspaces`, `await page.goto(`/w/${ws}/sources/import`)`): for each locale click the locale's button; expect the URL `/sources/imports/…` (Preview); expect Preview to show seven documents added and exactly one warning that mentions the title conflict (look at `src/components/imports/import-preview.tsx` / `import-summary.tsx` for the real labels and assert on those); click "Apply changes"; expect the run page; open the source's documents (find the route from the Sources list) and assert seven documents listed under the source named `Sample wiki` / `範例知識庫`; open `index` and **click** its link to the handbook onboarding page and assert you land on the onboarding document (proves links resolve in the real app); for zh-TW additionally click the link that points at a Chinese heading anchor and assert the URL hash is the slug. Each test uses a fresh workspace state only through the unique source it creates; do not assume an empty workspace (assert on the source it created by name and take the newest if names repeat).
- [ ] **Step 5: Run the e2e** (`node_modules/.bin/tsx scripts/test/e2e.ts tests/e2e/sample-wiki-import.spec.ts`; port check first). It must pass. Then prove it can fail: temporarily make `loadSampleWiki` build files without `webkitRelativePath` (so the root name is wrong) or drop one link target from a sample file, run, see the relevant assertion fail, restore with `git checkout`.
- [ ] **Step 6: Run** the whole unit suite, `make typecheck lint`, and the existing import specs (`tests/e2e/source-import.spec.ts tests/e2e/folder-sync-reading-flow.spec.ts tests/e2e/mvp-discovery-agent.spec.ts`) to prove a picked folder still behaves as before.
- [ ] **Step 7: Commit** (`git status` first, restoring the two onboarding PNGs if listed):

```bash
git add src/components/imports tests/unit/sample-wiki-loader.test.ts tests/e2e/sample-wiki-import.spec.ts
git commit -m "feat(import): try the import flow with a bundled sample wiki (en, zh-TW)"
```

---

### Task 3: The in-app guide

**Files:**
- Create: `src/app/w/[workspaceId]/sources/import/guide/page.tsx`, `src/components/imports/import-guide-content.ts`
- Modify: `src/app/w/[workspaceId]/sources/import/page.tsx` (one line linking the guide)
- Test: `tests/unit/import-guide-content.test.ts`; extend `tests/e2e/sample-wiki-import.spec.ts`

**Interfaces:**
- Consumes: `importRuntimeConfig().limits` (fields `maxManifestEntries`, `maxPathBytes`, `maxMarkdownFileBytes`, `maxMarkdownTotalBytes`), the access check pattern of the sibling import page (`getSourceListModel(workspaceId)`; a caller without access sees the same `StatusMessage` the import page shows), the manifest for the sample's file count.
- Produces:

```ts
// src/components/imports/import-guide-content.ts
export type GuideLimits = { maxManifestEntries: number; maxPathBytes: number; maxMarkdownFileBytes: number; maxMarkdownTotalBytes: number };
export type GuideSection = { id: string; title: string; body: GuideBlock[] };
export type GuideBlock = { kind: "p"; text: string } | { kind: "ul" | "ol"; items: string[] } | { kind: "table"; head: string[]; rows: string[][] } | { kind: "code"; text: string };
export type GuideContent = { title: string; intro: string; sections: GuideSection[] };
export function guideContent(locale: "en" | "zh-TW", limits: GuideLimits): GuideContent;
```
  with section ids exactly: `what-you-need`, `from-obsidian`, `from-a-tool`, `import-preview-apply`, `keep-in-sync`, `read-search-agent`, `limits`. Sizes are formatted by a helper (`5 MiB`, `256 MiB`) from the numbers given.

- [ ] **Step 1: Write the failing unit tests** (`tests/unit/import-guide-content.test.ts`): both locales return the same seven section ids in the same order; every section has at least one block; the `limits` section's text contains the formatted numbers for the limits passed in (call with non-default numbers, e.g. 123 entries / 2 MiB, and assert the output reflects them — this proves nothing is hard-coded); the zh-TW content contains CJK text in every section title; the English "from-a-tool" section mentions that `.git` and `.obsidian` are skipped and that titles come from frontmatter, then the first H1, then the file name; no section mentions any third-party wiki tool other than Obsidian (assert the strings `openwiki` and `obsidian-wiki` do not appear in either locale, case-insensitive).
- [ ] **Step 2: Run, see it fail.**
- [ ] **Step 3: Implement** the content (write the facts exactly as listed in spec §3: always-excluded `.git`/`.obsidian`; up to 50 excluded paths, no wildcards; title precedence and the warning; link forms `[[Title]]`, `[[folder/Note]]`, relative `.md`; heading anchors GitHub-compatible and non-Latin kept; assets are references only, no binary attachment storage; one-way sync and read-only imported documents; removed files become archived; Preview shows added/updated/archived and diagnostics; Apply changes; Copy for Agent takes 1–20 documents; one-click re-sync works in Chrome or Edge and say nothing stronger about other browsers). The checklist in `from-a-tool` has: a title (frontmatter `title` or a first `# H1`), links in a form the importer resolves, each file under the size limit, no attachments, relative paths without `..`. The page: a server component; `lang` attribute on the content wrapper; heading hierarchy `h1` then `h2` per section; a visible language switch implemented as two links (`?lang=en`, `?lang=zh-TW`) with `aria-current` on the active one; "Back to Import folder" link; a closing link "Try the sample wiki" that goes to `/w/<id>/sources/import#sample-wiki` (give the control from Task 2 `id="sample-wiki"`). Invalid or missing `lang` falls back to English. Render tables with a real `<table>`; use only design-language tokens.
- [ ] **Step 4: Link it in**: on the import page add under the intro one line, "Not sure what a folder should look like? Read the guide, or try a sample wiki below." with the guide link (`kh-focus-ring`, same link style as the page's existing links).
- [ ] **Step 5: E2E** (extend `tests/e2e/sample-wiki-import.spec.ts`): the import page links to the guide; the guide renders in English with the seven `h2` headings in order and the configured limits visible (assert the formatted default `20,000` or the format your helper produces, whichever you chose, read from the page, not hard-coded twice); `?lang=zh-TW` renders Chinese headings and the language switch marks it current; the "Try the sample wiki" link returns to the import page with the control in view.
- [ ] **Step 6: Run** unit suite, `make typecheck lint`, the e2e spec; then prove the limits are live: run the guide unit test with different limits (already in Step 1) — no extra step needed beyond it passing.
- [ ] **Step 7: Commit** (restore the two onboarding PNGs first if listed):

```bash
git add src tests
git commit -m "feat(import): in-app, bilingual guide to bringing a Markdown wiki, with live limits"
```

---

### Task 4: README, spec status, and whole-branch verification

**Files:**
- Modify: `README.md` ("Your first workflow", step 1), `docs/superpowers/specs/2026-10-06-sample-wiki-import-guide-design.md` (status), `README.zh-TW.md` (the same step, Traditional Chinese, if it has the corresponding list)

- [ ] **Step 1: README** — in step 1 of "Your first workflow", add that **Import folder** has an in-app guide ("Bring your wiki into Knowledge Hub", linked from the import page) and a **Try with a sample wiki** option that imports a ready-made folder through the normal Preview → Apply flow; mention the sample lives in `public/sample-wiki/`. Mirror the change in `README.zh-TW.md` in the same style and keep the two READMEs' structure aligned (read how main keeps them parallel).
- [ ] **Step 2: Spec status** — set it to implemented, referencing the plan.
- [ ] **Step 3: Verify the whole branch** — `make verify` (check its exit code itself; redirect to a file and grep); then the full e2e `node_modules/.bin/tsx scripts/test/e2e.ts` (port check first; ~7 minutes). Known pre-existing flake: `tests/e2e/row-actions.spec.ts` "the palette offers actions as well as documents…" can fail under load (Enter → `/search?q=settings`); if it is the only failure, re-run just that spec once and report it as the known flake; any other failure is yours to diagnose with evidence. Restore `docs/ui-comparisons/mvp-onboarding/*.png` before committing.
- [ ] **Step 4: Commit** (no push):

```bash
git add README.md README.zh-TW.md docs/superpowers/specs/2026-10-06-sample-wiki-import-guide-design.md
git commit -m "docs: README and spec status for the sample wiki and import guide"
```

---

## Self-Review

**Spec coverage:** §2.1 (static assets, manifest, same flow, source name from manifest) → Tasks 1–2; §2.2 (seven files, link kinds, exactly one diagnostic, no attachments) → Task 1 content brief + tests 1–7; §3 (route, `lang`, TSX not Markdown, live limits, seven sections, verified facts, Chrome/Edge wording) → Task 3; §4 (import page line, README) → Tasks 3–4; §5 tests → unit in Tasks 1–3, e2e in Tasks 2–3; §6 risks → the button's fetch-failure message (Task 2) and the e2e that keeps `selectFolder` assumptions true.

**Placeholders:** none; where a symbol must be discovered (frontmatter/H1 extractor, Preview labels, extractor kinds) the step says where to look and requires reusing the project's own code.

**Type consistency:** `loadSampleWiki` → `SampleWiki { files, sourceName, root, label }`, consumed by `SampleWikiImport` and the form (`handleFiles(files, sourceName)`); `manifest.json` shape produced in Task 1 and consumed in Tasks 2–3; `guideContent(locale, limits)` produced and consumed in Task 3 only.
