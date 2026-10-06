# Sample wiki and "Bring your wiki" guide

| Item | Content |
| --- | --- |
| Date | 2026-10-06 |
| Type | Design specification, for review before implementation |
| Why | The first-use guide starts at "Import your first folder" and assumes the reader already has one. A new user without a Markdown folder is stuck at step 0, and the person running the MVP becomes the only support. |
| Related | `docs/superpowers/specs/2026-10-04-mvp-discovery-agent-design.md` (folder scope, Copy for Agent), `README.md` "Your first workflow" |
| Status | Approved in conversation; implementation plan: `docs/superpowers/plans/2026-10-06-sample-wiki-import-guide.md` |

## 1. What it delivers

1. **A sample wiki a reader can import with one click**, in English and Traditional Chinese.
2. **An in-app guide**, "Bring your wiki into Knowledge Hub", in both languages, linked from the import page.

Out of scope: a tutorial for any third-party wiki generator. Those tools change independently, and the contract below is what Knowledge Hub itself accepts, which is what a reader needs to know whichever tool produced the folder. The guide names Obsidian (the importer explicitly supports its vaults) and otherwise speaks of "a tool or agent that writes Markdown files into a folder".

## 2. Sample wiki

### 2.1 Where it lives and how it is imported

- Files live in `public/sample-wiki/<locale>/…` (`en`, `zh-TW`), served statically. This is the only copy; the README and the guide point at it.
- `public/sample-wiki/manifest.json` lists, per locale, the root folder name, the default source name and the file paths. A unit test fails if the manifest and the directory disagree.
- The import page (new-source mode only) gets a **"Try with a sample wiki"** control with one button per language. Pressing it fetches the manifest and the files in the browser, builds `File` objects whose `webkitRelativePath` is `<root>/<path>`, and passes them to **the same import flow** a picked folder uses (`handleFiles` → `runFolderImport`). No new server path, no new write path, and no special case in the importer.
- The reader therefore sees the normal **Preview**, then **Apply**. That is deliberate: the sample also teaches the flow.
- The source is named from the manifest ("Sample wiki" / "範例知識庫"), not from the root folder name.
- Importing twice creates a second source. The form already allows two imports of the same folder; the sample does not special-case it.

### 2.2 Content

Seven small Markdown files per locale, the same structure in both languages, written as a miniature team handbook so it looks like something a person would keep:

```text
index.md                       frontmatter title; links to the others
handbook/onboarding.md         H1 title; bare wikilink, relative .md link, in-page anchor
handbook/leave-policy.md       headings used as link targets (a Chinese heading in zh-TW)
handbook/title-mismatch.md     frontmatter title differs from the H1 (expected warning)
concepts/links.md              the link forms, with live examples
concepts/sync.md               the sync model, with live examples
reference/glossary.md          short; links back to the others
```

It must exercise, with real links that resolve inside the sample:

- `[[Title]]`, a bare stem, and Obsidian's shortest-path form `[[concepts/links]]`;
- a relative `.md` link and a link to a heading anchor (GitHub-compatible slug, including a Chinese heading in zh-TW);
- a title from frontmatter and a title from the first H1;
- nested folders.

**Exactly one deliberate diagnostic per locale:** `handbook/title-mismatch.md` produces the `TITLE_CONFLICT` warning ("frontmatter.title differs from the first H1; frontmatter.title wins."). The file says so in its own text, and the guide tells the reader to expect one warning. It teaches how to read Preview diagnostics. Nothing else in the sample warns or fails, and every link resolves.

The sample contains no attachments, no `.git` or `.obsidian` directory, and every file is far below the Markdown size limit. Content is plain prose with no real company information.

## 3. In-app guide

Route: `/w/[workspaceId]/sources/import/guide`, a child of the import page. Language by `?lang=en|zh-TW` (default English) with a visible switch. Content is a TSX component with two content objects, not a Markdown file read from disk: a `docs/` file may be missing from a deployed bundle, and the app has no i18n layer to hang a Markdown pipeline on.

The numeric limits are **read from the server's import configuration** (`importRuntimeConfig().limits`), so the page cannot disagree with what the server enforces.

Sections:

1. What you need: a folder of `.md` files. Try the sample first.
2. From an Obsidian vault: works as is; `.obsidian` and `.git` are skipped.
3. From a tool or agent that writes Markdown into a folder: a checklist (a title in frontmatter or an H1, link forms the importer resolves, files under the size limit, no attachments, relative paths without `..`).
4. Import → Preview → Apply: what Preview shows, how to read the diagnostics, what Apply changes.
5. Keeping it in sync: one-way, the local folder is authoritative, imported documents are read-only in the Hub, removed files become archived documents; select the folder again to re-sync.
6. Read, search (path and date filters) and Copy for Agent (1–20 documents).
7. Limits and common messages.

Facts the guide states, all verified in the code on `main` at the time of writing:

- `.git` and `.obsidian` are always excluded; up to 50 exact paths can be excluded additionally, no wildcards.
- Title precedence: frontmatter `title`, then the first H1, then the file name; a difference between the first two is a warning and frontmatter wins.
- Links: `[[Title]]`, `[[folder/Note]]` (shortest-path form), relative `.md` links; heading anchors follow GitHub's slugging and keep non-Latin text.
- Assets are stored as metadata and references only; there is no binary attachment storage.
- Remembered-folder one-click re-sync uses the browser's File System Access API (`showDirectoryPicker`); without it the form falls back to a plain directory input. **Inferred from code and not tested in Firefox or Safari**, so the guide says "Chrome or Edge" for one-click re-sync and does not promise more.

## 4. Links in

- Import page: a line under the intro, "Not sure what a folder should look like? Read the guide, or try a sample wiki."
- README "Your first workflow" step 1: mention the guide and the sample.
- No change to the first-use guidance component in this slice; it already links to the import page.

## 5. Tests

- **Unit**: the manifest matches `public/sample-wiki/`; both locales have the same structure; no file under `.git`/`.obsidian`; sizes within the configured limits; **every link in the sample resolves** using the project's own link extractor and resolver; **exactly one `TITLE_CONFLICT`** per locale using the project's own title resolution; the guide's content objects have the same sections in both languages.
- **E2E**: from the import page, "Sample wiki" in each language → Preview shows 7 documents added and one warning → Apply → the source lists 7 documents and a link in `index` opens its target (a real click). The guide renders in both languages and shows the configured limits.
- The sample import goes through the same flow as a picked folder, so no test stubs it out.

## 6. Risks and unverified points

- Building `File` objects in the browser and passing them to `runFolderImport` relies on `selectFolder` reading only `webkitRelativePath` and the file name. That is true of the code on `main` today; the e2e is what keeps it true.
- A static `public/` path must not be gated by anything in front of the app (a reverse proxy rule, SSO path allow-list). The deployer must serve `/sample-wiki/*` to signed-in users; the button reports a clear error if the fetch fails.
- The guide covers what Knowledge Hub accepts. It cannot say how any specific generator behaves.
- Browser behaviour in Firefox and Safari is not tested.
