# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

`make help` lists everything. The ones that matter:

```bash
make bootstrap        # first time: install, start MariaDB, migrate, seed
make dev              # dev server at http://127.0.0.1:3000/knowledge
make verify           # local mirror of the DB-free CI gate: unit + typecheck + lint + build
```

Tests come in three layers with different requirements:

```bash
make test-unit        # no database
make test-integration # needs MariaDB (make db-up)
make test-e2e         # provisions an isolated DB, builds, runs Playwright
make browsers         # once, before the first e2e run
```

A single unit test file or case:

```bash
npx vitest run --config vitest.config.ts tests/unit/<file>.test.ts
npx vitest run --config vitest.config.ts -t "<test name>"
```

`node_modules/next`'s vendored React carries one patch file (`patches/next+15.5.25.patch`,
applied by `postinstall`) with two fixes. Symptoms of it being missing: a navigation
that "finishes loading and never appears", and "Application error: a client-side
exception" (React #310) after a click that lands while a server `redirect()` is still
loading. See README's patch section before touching either the patch or the Next
version, and clear `.next/cache` after changing it.

CI (`.github/workflows/phase2-dev-gate.yml`) runs four jobs on every PR to
`main`: `unit` (which also runs typecheck and lint), `build`, `integration`
and `e2e`. `make verify` covers everything except the two DB-backed jobs.

### Package manager

pnpm 12 is the default local package manager; `pnpm-workspace.yaml` and `pnpm-lock.yaml` are
committed. Use `pnpm install` locally. npm is the fallback when pnpm is unavailable, and the
package manager for CI, Vercel, and deployment (`npm ci`, `package-lock.json`); do not replace
`package-lock.json` or switch those to pnpm.

When dependencies change, refresh `package-lock.json` first (`npm install --package-lock-only`),
then `pnpm import && pnpm install`, and commit both lockfiles. Setup, settings, layout
switching, and caveats are in the README's [Local pnpm](README.md#local-pnpm). Keep the
`patch-package` postinstall and never pass `--ignore-scripts` to `pnpm install`.

## Architecture

A Next.js modular monolith over MariaDB, layered so that the web app is one
caller among several planned ones (MCP and other APIs arrive in later phases
and share the same application services).

```text
src/modules/<module>/     domain/  — entities, rules, errors; no I/O
                          ports/   — interfaces the application layer needs
                          application/ — use cases, orchestration, authorization
src/infrastructure/       MariaDB adapters implementing those ports
src/server/               composition root + Next-facing read projections
src/app/                  routes and API handlers
src/components/           UI (see the design language contract below)
```

The four modules are `identity`, `workspaces`, `knowledge` and `sources`.

These boundaries are enforced by `no-restricted-imports` in
`eslint.config.mjs`, not by convention — `make lint` fails on a violation:

- `src/modules/**` may not import `next`, `react`, `mariadb`, or anything
  under `infrastructure/`. Modules depend on ports.
- `src/modules/knowledge/**` additionally may not import `@/modules/sources/**`.
  Knowledge reaches Sources through its `source-policy` port only.
- `src/components/**` and `src/app/**` may not import `infrastructure/` or
  `mariadb`. Web adapters call application services through the composition
  root.

`src/server/composition.ts` is that root — the single place adapters are wired
to services. It pins the connection pool on `globalThis` because `next dev`
re-evaluates server modules on every HMR reload, and a module-level singleton
would leak a pool per reload until MariaDB runs out of connections.

### Invariants that are easy to break

These are contracts, not preferences. Breaking one is a defect even if tests
pass.

- **Scope is derived, never stored twice.** A `KnowledgeSource` belongs to
  exactly one workspace and a document to exactly one source. Documents do not
  carry `workspace_id`; scope comes from `Document → Source → Workspace`.
- **Knowing an ID is not authorization.** Possessing a `workspace_id`,
  `source_id` or `document_id` grants nothing. URL parameters are navigation
  inputs, never authorization proof, and the application service must
  re-verify policy regardless of what the UI allowed. A UI selector is not an
  access check.
  A **document share link** is an owner-issued random UUIDv4, expiring,
  revocable grant on a document **or a My Space folder**. A folder link grants
  read of the documents currently under that folder, re-derived on every
  request; the URL's document id (`?d=`) is navigation only, and an id not under
  the folder answers as a dead link does
  (`docs/superpowers/specs/2026-10-29-folder-share-link-design.md`). The grant
  has three narrow paths: anonymous current-document read via
  `/s/:token` and `DocumentShareService.readShared`, and review-record access
  via `/api/share-review/*`: query reads require a live token only; writes additionally require a trusted caller;
  and recipient-owned saved-share access via `/api/saved-shares/*` and the
  personal workspace saved-shares list. Saved-share operations always require a
  trusted caller. Saving captures grant validity and public title/sender metadata
  in one SQL snapshot, then retains only that metadata and the link reference.
  Saved-share search covers the recipient's saved metadata and currently public
  title/sender metadata; unavailable links never disclose newer private metadata.
  Saving never extends the link's lifetime or grants sender Workspace membership,
  Workspace search, tree, history, MCP, Markdown edits or revision writes.
  And follow replies in the reader's own Inbox: writing in a discussion through a
  link follows it (`review_thread_follows`); the Inbox shows replies others wrote
  there only to that trusted caller, only while the followed link opens now
  (re-evaluated per request), and a dead link's entry names nothing. Following
  never extends a link's lifetime or grants anything the link does not
  (`docs/superpowers/specs/2026-10-22-review-reply-follow-design.md`).
  Shares → Discussions lists those follows to the same trusted caller, under
  the same per-request link judgement, and a reader may stop their own follow
  without a live link (`POST /api/review-follows/:threadId/unfollow`): it reads
  nothing and answers alike for any id
  (`docs/superpowers/specs/2026-10-23-followed-discussions-tab-design.md`).
  A **mention** hands a link's reference to one named, signed-in Hub user's Inbox:
  the writer passes on the link they already hold or own, recorded instead of
  pasted. It reads only through `/s/:token` like any holder, is judged per
  request against the link's validity, never extends its lifetime, and grants no
  Workspace membership, search, tree, history, MCP, Markdown edits or revision
  writes. Its candidate search (`/api/review-mentions/candidates`) answers
  signed-in callers only, never anonymously; it asks for a live token or
  document ownership, but that is not a narrower gate on the directory, since
  every signed-in user owns documents (accepted 2026-10-29). A mention through
  a folder link hands over that link, which opens the whole folder; it is judged
  per document, and an owner may name the links that open the document now (its own or a folder's above it)
  (`docs/superpowers/specs/2026-10-29-review-mentions-design.md`, "Folder share links").
  Review access never grants Workspace membership, search, tree, history,
  MCP, Markdown edits or revision writes. Review responses include only
  validated current-revision selected-text fragments; hidden bodies and
  outdated quotes are excluded. Exactly two entries serve content without a caller:
  `readShared`, which serves the document, and `DocumentReviewService.queryForLink`,
  which serves the visible discussion and those fragments and, for each person a
  visible comment mentions, that person's `name`, `name_en` and `emp_id`
  (`docs/superpowers/specs/2026-10-30-review-mention-highlight-design.md`). A third,
  `readSharedTarget`, answers without one but serves no content: it judges the
  link for `/s/:token/open` and names only the document id to open, before
  sign-in is asked for (so a dead link is a plain 404). Every other entry,
  and every write, requires one; `tests/unit/share-link-single-exception.test.ts`
  enforces it.
- **`org_code` does not decide access.** It answers which company org a user
  belongs to; workspace membership answers what they can open. Cross-org
  membership is legal and same-org membership is not automatic.
- **Source ownership decides who may write.** `SOURCE_MANAGED` content
  (folder sync) is read-only in the Hub and updated by re-syncing the source;
  `HUB_MANAGED` content (upload, web create) is editable. Workspace access and
  source ownership are separate questions and must not be conflated.
- **Publication sources are written only by the publication mechanism.** A
  Team document is a copy in a `PUBLICATION` source, never a reference to a
  personal document. Every source, document and tree mutation on one is refused
  except the publication mechanism acting for the document's creator, an
  admin's archive or restore of the whole publication, and its publication
  creator's unpublish, restore or rename while they still hold `source.manage`
  and have not left
  (`src/modules/sources/application/publication-write-authority.ts`,
  `publication-service.ts`, `publication-reconciler.ts`). `document.write` alone
  never overrides this. Only that document's creator's originals update it;
  another contributor's version of the same path is reported, never applied.
  The revision, move and lifecycle writers record a publication event in their
  own transaction, and `tests/unit/publication-event-write-points.test.ts`
  fails if one does not, beside `tests/unit/link-index-write-points.test.ts`
  for link edges.
- **Team discussion requires a caller and re-judges membership.** Any active
  Team member may read and write discussions on a published team document;
  "owner" means that document's creator. Every creator- or mention-based team
  path (Inbox entries, unread counts, mark-read, hide, unpublish, rename)
  re-checks `document.read` — or `source.manage` for the lifecycle commands —
  as the caller, groups included. When that check fails the entry stays but
  names nothing and opens nothing; being a creator, or once mentioned, grants
  nothing on its own. The no-caller share-link exceptions
  (`tests/unit/share-link-single-exception.test.ts`) are unchanged, and team
  review never mints a share link.
- **Identity vs position vs content.** The tree decides position, the document
  ID decides identity, and the revision stores title/Markdown/metadata. Moving
  or renaming a file creates no revision; editing the article title does.
- **Lifecycle is `ACTIVE` / `ARCHIVED` only.** There is no hard delete.
- **The link index is derived, and never decides access.** `knowledge_link_index`
  and `knowledge_document_links` record what each document's *current revision
  wrote* (`[[wikilinks]]`, relative `.md` links); what a link *points at* is
  resolved at read time, inside one Workspace, against the documents as they are
  now (`docs/superpowers/specs/2026-09-29-personal-workspace-knowledge-graph-design.md`).
  Every code path that inserts a revision must replace the document's edges in
  the same transaction (`repositories.links.replaceForDocument`;
  `tests/unit/link-index-write-points.test.ts` fails if one does not). A link
  never resolves across Workspaces, and a shared document page (`/s/:token`) is
  given no resolutions at all; a shared folder page is given only those whose
  target is a document under that folder.
- **The rendered editor must write a wikilink back as it read it.** It holds
  `[[x]]` as a `wiki_link` node; as text it would be written `\[\[x]]`, which is
  no link, and a document opened and saved there would lose its edges
  (`docs/superpowers/specs/2026-09-29-personal-daily-driver-design.md` §1.1, §4).
  Any change to the editor, the composer, or the Markdown they write needs a test
  that runs the *rendered* editor and reads the links a saved document holds —
  not one that types through the Markdown source view, which never runs it
  (`tests/unit/editor-wikilinks.test.ts`, `tests/e2e/zz-wikilinks-composer.spec.ts`;
  both read the extractor's cases in `tests/fixtures/link-markdown.ts`).
  The `[[` list writes through that same node and is held to the same rule
  (`tests/unit/wikilink-suggest.test.ts`, `tests/e2e/zz-composer-autocomplete.spec.ts`).

- **The reader never passes HTML through.** A tag in a document is text unless
  `remark-known-html.ts` or `remark-html-subset.ts` recognises it exactly and
  constructs the element itself: `<br>`, comments, and seven bare tags
  (`docs/superpowers/specs/2026-10-12-reader-html-subset-design.md`). Nothing the
  author wrote is emitted as markup. That is the first line; the
  Content-Security-Policy is the second, not a substitute for it. Do not add `rehype-raw`, a sanitiser, or
  `dangerouslySetInnerHTML` on document content to "support more HTML"; add an
  exact pattern, and its hostile cases to
  `tests/unit/markdown-renderer-html-subset.test.tsx`.
  A `mermaid` block is drawn the same way round: Mermaid's SVG goes into a `Blob`
  and is shown by `<img>`, never set as markup
  (`docs/superpowers/specs/2026-10-13-reader-mermaid-design.md`). Do not move it to
  `innerHTML` to make its text selectable or its links work; as an image it runs
  nothing and styles nothing, which inline it would. That is the page the reader
  is left with. To lay a diagram out Mermaid first builds it in this page, and
  three lists in `mermaid-queue.ts` guard that moment: `DRAWN_TYPES` (the type is
  found by `mermaid.parse` before anything is laid out, and no other type is ever
  handed to `render`), `SECURE` (the keys a diagram's own text may not set) and
  `SANITIZER` (what Mermaid's sanitiser leaves of a label: a line break).
  `scripts/test/mermaid-assumptions.mjs` is their evidence, from a browser, and
  holds a copy of each (`make test-mermaid-assumptions`;
  `tests/unit/mermaid-assumptions-lists.test.ts` fails when a copy differs). Run
  it before changing Mermaid's version. A type goes on the list when the script
  passes with it, never because it looks harmless, and refusing a drawing after
  `render` does not undo what laying it out did. Its hostile cases are `tests/e2e/zz-mermaid-hostile.spec.ts`.

- **Scripts run by nonce.** `src/middleware.ts` gives every page a
  Content-Security-Policy built by `src/lib/content-security-policy.ts`:
  `script-src` by per-response nonce with `strict-dynamic`, never `unsafe-inline`
  (and `unsafe-eval` in development only), beside `img-src 'self' blob:` (the
  `blob:` is the drawn diagram, minted by this origin's script), `media-src 'none'`
  and, on `/s/*`, `frame-ancestors 'none'`. There is no `default-src`: a kind of
  fetch is open until a directive names it. An inline `<script>` needs the nonce from the
  `x-nonce` request header, as the layout's theme script takes it, or — where no
  server component can pass one, as in `global-error` — its hash in the policy.
  An inline event handler (`onclick="…"` in markup) cannot be allowed at all.
  The middleware's header replaces the one `next.config.ts` sets, so a directive
  added in one place only is lost on pages.

## Frontend design language

`docs/superpowers/specs/frontend-design-language.md` is a living contract —
undated, amended in place. Read it before touching anything under
`src/components` or `src/app`.

The part that will surprise you: `tailwind.config.ts` **replaces** the
`fontSize`, `borderRadius`, `boxShadow`, `transitionDuration` and
`transitionTimingFunction` scales rather than extending them. Tailwind's
default spellings do not exist. `text-sm`, `text-xs`, `rounded`, `rounded-xl`,
`shadow-sm` and `duration-150` compile to nothing. Use the token names the
contract lists (`text-body`, `rounded-md`, `shadow-popover`, …), and treat
adding a token as a change to the contract — update the document and the
config together.

Colour lives entirely in CSS variables in `src/app/globals.css`, resolved for
both light and dark. No component declares a colour outside that layer.

## Documentation workflow

```text
docs/superpowers/
├── roadmaps/      phase goals and milestones
├── specs/         design specs + architecture history
├── plans/         implementation plans
└── verification/  evidence from actual runs
```

Current behaviour is defined by the canonical phase spec plus its
implementation plan, listed in README's "Current canonical documents" table.
Documents marked *architecture history* record why a decision changed and are
**not** a patch layer to apply on top of canonical docs — read the canonical
spec for what to do now, history only for why.

One document is deliberately undated: the frontend design language, because a
visual contract applies to every phase rather than belonging to one. When a
contract outgrows its phase document, promote it and mark the original
superseded rather than leaving two live copies.

Substantive design changes get a spec before code, and deviations from an
existing canonical spec get recorded rather than made silently — both
directions of that rule have already been broken once by drift nobody noticed.
