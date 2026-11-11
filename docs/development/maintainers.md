# Maintainer guide

**English** · [繁體中文](maintainers.zh-TW.md)

Toolchain pins, their caveats, and the index of canonical design documents. The [README](../../README.md) covers installing, configuring and deploying Knowledge Hub.

## Local pnpm

pnpm 12 is the default local package manager; `pnpm-workspace.yaml` and `pnpm-lock.yaml` are committed. npm is the fallback when pnpm is unavailable, and remains the package manager for CI, Vercel, and deployment (`npm ci`, `package-lock.json`). Install pnpm with `brew install pnpm` (or `npm install -g pnpm@12`) and confirm `pnpm -v` reports 12.x.

The committed `pnpm-workspace.yaml` carries three required settings:

```yaml
packageImportMethod: clone-or-copy
publicHoistPattern:
  - '*'
allowBuilds:
  esbuild: true
  fsevents: true
  unrs-resolver: true
```

- `packageImportMethod: clone-or-copy` is required: without it pnpm may hardlink packages from the shared store, and `patch-package` would then modify that store for every project that uses it. The `pnpm store status` note below only holds with this setting.
- `publicHoistPattern` matches the root hoisting this repository relies on: it imports `mdast-util-to-hast`, `mdast-util-gfm`, and `@next/eslint-plugin-next` without declaring them; declaring them is the durable fix.
- `allowBuilds` names the dependencies allowed to run build scripts. If pnpm warns that build scripts were ignored (or reports `ERR_PNPM_IGNORED_BUILDS` with `strictDepBuilds`), add the named package after confirming it is expected, or run `pnpm approve-builds`.

If you created either file locally before it was tracked, remove its `.git/info/exclude` entry so Git picks up the committed copy.

Install with `pnpm install`; it runs the same `patch-package` postinstall as npm. On filesystems with clone/reflink support (APFS, Btrfs), worktrees also share disk blocks; on copy-only filesystems pnpm falls back to copies and the disk saving shrinks.

The npm fallback needs the npm layout: `rm -rf node_modules .next && npm ci`. Switch back with `rm -rf node_modules .next && pnpm install`; the layouts are not interchangeable.

**When dependencies change**, keep both lockfiles in step. `package-lock.json` is what CI, Vercel, and deployment resolve, so refresh it first with `npm install --package-lock-only`, then derive `pnpm-lock.yaml` with `pnpm import && pnpm install`, and commit both. `pnpm import` prefers the versions recorded in `package-lock.json`; confirm `next` still resolves to 15.5.25 while `patches/next+15.5.25.patch` is in use.

**Do not pass `--ignore-scripts`** to `pnpm install`: it skips both the dependency build scripts and the `postinstall` that applies the Next.js patch. If you already did, a plain `pnpm install` reports "Already up to date" and does not rerun the root `postinstall`; run `pnpm install --force` (or `rm -rf node_modules .next && pnpm install`). To restore the skipped dependency builds and the patch separately, run `pnpm rebuild && pnpm exec patch-package`. In a patched layout, `pnpm store status` exits non-zero with `ERR_PNPM_MODIFIED_DEPENDENCY` for `next`; that is expected, and with `clone-or-copy` the shared store itself is not changed.

## Next.js patch

The install postinstall step uses `patch-package` to apply [`patches/next+15.5.25.patch`](../../patches/next+15.5.25.patch), which fixes two bugs in Next.js's bundled React (`19.2.0-canary-0bdb9206-20250818`):

1. Lost render pings during page navigation.
2. A page crash with "Application error" (React #310, "Rendered more hooks than during the previous render", thrown from Next's `Router`) when a redirect or other error lands during render while another navigation is still loading — for example, clicking a document while "Browse documents" is still redirecting. Without the fix, React's error recovery commits the Router half-rendered; the patch adds the one condition from [facebook/react#36911](https://github.com/facebook/react/pull/36911) to the four `react-dom` client and profiling builds.

Keep install scripts enabled. After an npm install made with `--ignore-scripts`, run `npm ci`; after a pnpm one, run `pnpm install --force` (a plain `pnpm install` will not rerun the root `postinstall` on an up-to-date tree). To restore only the patch, use `pnpm exec patch-package` on a pnpm layout or `npx patch-package` on an npm layout.

The second fix was checked against the upstream diff of #36911, and [vercel/next.js#95368](https://github.com/vercel/next.js/pull/95368) brings it into Next canary (React `ec0fca31-20260701`). The issues those PRs reference (vercel/next.js#63121 and #78396, facebook/react#33580) were read only as summaries and were not reproduced here. The `experimental` React channel under `next/dist/compiled/react-dom-experimental` is unpatched: it is only loaded when experimental React features are enabled in `next.config.ts`, which this project does not do.

When upgrading Next.js, check whether the patch is still required: [`vendored-react-ping-fix.test.ts`](../../tests/unit/vendored-react-ping-fix.test.ts) checks the bundled source for both fixes, and passes without the patch once Next bundles a React that already has them. [`router-redirect-during-navigation.spec.ts`](../../tests/e2e/router-redirect-during-navigation.spec.ts) reproduces the crash in the browser; evidence is in the [verification record](../../docs/superpowers/verification/2026-10-06-react-310-redirect-recovery-verification.md). After updating or removing the patch, clear `.next/cache` before rebuilding.

## Mermaid version

`mermaid` is pinned to `~12.2.0`. The reader draws a diagram only if its type is on an allow-list, with a list of config keys a diagram's own text may not set and a sanitiser configuration of its own ([`mermaid-queue.ts`](../../src/components/knowledge/mermaid-queue.ts)); each exists because of what that version was seen to do in a browser. Before changing the version, and again after, run:

```bash
make test-mermaid-assumptions
```

[`scripts/test/mermaid-assumptions.mjs`](../../scripts/test/mermaid-assumptions.mjs) lays every listed type out in Chromium with hostile text, under the production policy's fetch directives, and exits non-zero when an assumption no longer holds. It is not part of `make verify` or CI. The [spec](../../docs/superpowers/specs/2026-10-13-reader-mermaid-design.md) explains what each assumption guards.

## Current canonical documents

These documents define the core contracts and their implementation plans. Later focused specifications record additions; dated verification records describe evidence at that point in time.

| Area | Design | Plan | Scope |
| --- | --- | --- | --- |
| Foundation and architecture | [Spec](../../docs/superpowers/specs/2026-09-10-phase-0-foundation-architecture-design.md) | [Plan](../../docs/superpowers/plans/2026-09-10-phase-0-foundation-implementation.md) | Module boundaries, schema, transactions and workspace access. |
| Knowledge core and tree | [Spec](../../docs/superpowers/specs/2026-09-10-phase-1-knowledge-core-tree-design.md) | [Plan](../../docs/superpowers/plans/2026-09-10-phase-1-knowledge-core-tree-implementation.md) | Document identity, revisions, tree placement and lifecycle. |
| Folder import and sync | [Spec](../../docs/superpowers/specs/2026-09-12-phase-2-knowledge-source-import-sync-design.md) | [Plan](../../docs/superpowers/plans/2026-09-12-phase-2-knowledge-source-import-sync.md) | Staging, Preview, atomic Apply and source ownership. |
| Identity and workspace governance | [Spec](../../docs/superpowers/specs/2026-09-14-phase-3-identity-workspace-governance-design.md) | [Plan](../../docs/superpowers/plans/2026-09-14-phase-3-identity-workspace-governance.md) | Roles, capabilities, membership, SSO and cutover. |
| Discovery and read API | [Spec](../../docs/superpowers/specs/2026-09-16-phase-4-discovery-read-api-design.md) | [Plan](../../docs/superpowers/plans/2026-09-16-phase-4-discovery-read-api.md) | Authorized search and bounded document reads. |
| Human authoring | [Spec](../../docs/superpowers/specs/2026-09-16-phase-5-human-authoring-design.md) | [Plan](../../docs/superpowers/plans/2026-09-16-phase-5-human-authoring.md) | Upload, create, edit and revision conflicts. |
| Document sharing | [Spec](../../docs/superpowers/specs/2026-09-23-document-share-link-design.md) | [Plan](../../docs/superpowers/plans/2026-09-23-document-share-link.md) | Expiring, revocable single-document read access. |
| Inline document review | [Spec](../../docs/superpowers/specs/2026-10-09-shared-personal-document-inline-review-design.md) | [Plan](../../docs/superpowers/plans/2026-10-09-shared-personal-document-inline-review.md) | Anonymous discussion reads, authenticated writes, owner moderation and sync-safe anchors; corporate rollout gated. |
| Owner comments rail | [Spec](../../docs/superpowers/specs/2026-10-12-owner-comments-rail-design.md) | — | The owner's discussions beside the passage they are about, in the outline's place; a drawer where the pane is narrow. |
| Review anchors and owner threads | [Spec](../../docs/superpowers/specs/2026-10-13-review-anchors-and-owner-threads-design.md) | — | Comments on table cells and code; a selection that cannot take one says why; the owner starts a discussion; a callout, task list or footnote no longer disables commenting. |
| Saved shares | [Spec](../../docs/superpowers/specs/2026-10-12-saved-shares-design.md) | [Plan](../../docs/superpowers/plans/2026-10-12-saved-shares.md) | Account-backed recipient bookmarks, separate from favorites; access remains controlled by the original link. |
| Folder share link | [Spec](../../docs/superpowers/specs/2026-10-29-folder-share-link-design.md) | [Plan](../../docs/superpowers/plans/2026-10-29-folder-share-link.md) | One expiring, revocable link to a My Space folder's live subtree: a tree beside the reader, in-folder links followed, the rest left as text; comments, saving and the owner's Inbox work as for a document link. |
| Source share link | [Spec](../../docs/superpowers/specs/2026-11-05-source-share-link-design.md) | [Plan](../../docs/superpowers/plans/2026-11-05-source-share-link.md) | Share one My Space Source's live document tree without exposing its settings, history or assets. |
| Named-recipient share | [Spec](../../docs/superpowers/specs/2026-11-03-named-recipient-share-design.md) | — | A share link with a named audience: it opens only for the signed-in people its owner lists, is read in the Hub rather than on `/s/:token`, never expires, and grants nothing beyond a link. |
| Followed discussions | [Spec](../../docs/superpowers/specs/2026-10-23-followed-discussions-tab-design.md) | [Plan](../../docs/superpowers/plans/2026-10-23-followed-discussions-tab.md) | Shares → Discussions lists the discussions a reader follows; a reader drops their own follow without a live link. |
| Reader callouts | [Spec](../../docs/superpowers/specs/2026-10-12-reader-callouts-design.md) | — | `> [!NOTE]` and GitHub's four other kinds drawn as callouts in the reader and on shared pages; the stored Markdown is unchanged. |
| Reader HTML subset | [Spec](../../docs/superpowers/specs/2026-10-12-reader-html-subset-design.md) | — | Seven bare HTML tags drawn in the reader and on shared pages; everything else stays text, and no HTML is ever passed through. |
| Content-Security-Policy | [Spec](../../docs/superpowers/specs/2026-10-12-content-security-policy-design.md) | — | Scripts run by per-response nonce on every page; no inline script or handler. |
| Mermaid in the reader | [Spec](../../docs/superpowers/specs/2026-10-13-reader-mermaid-design.md) | [Plan](../../docs/superpowers/plans/2026-10-13-reader-mermaid.md) | A `mermaid` block drawn as an image in the reader and on shared pages, never as markup; left as code, with a reason, when it cannot be. |
| Editor reader hints | [Spec](../../docs/superpowers/specs/2026-10-12-editor-reader-hints-design.md) | — | The editor hints at a callout and the inline HTML subset with decorations; the marks stay and the saved Markdown is unchanged. |
| Source tree loading | [Spec](../../docs/superpowers/specs/2026-10-24-lazy-source-trees-design.md) | [Plan](../../docs/superpowers/plans/2026-10-24-lazy-source-trees.md) | Current source initially; other trees load on expansion, with retry and shared move-dialog data. |
| Document composer | [Spec](../../docs/superpowers/specs/2026-09-28-document-composer-design.md) | [Plan](../../docs/superpowers/plans/2026-09-28-document-composer.md) | Rendered editing and Markdown source mode. |
| Inline editing | [Spec](../../docs/superpowers/specs/2026-10-16-inline-editing.md) | — | Editing in the reader with autosave and passage discussions; checkpoint history is a follow-up policy. |
| Knowledge links and graph | [Spec](../../docs/superpowers/specs/2026-09-29-personal-workspace-knowledge-graph-design.md) | [Plan](../../docs/superpowers/plans/2026-09-29-personal-workspace-knowledge-graph.md) | Wikilinks, backlinks, heading anchors and derived graph data. |
| Personal daily use | [Spec](../../docs/superpowers/specs/2026-09-29-personal-daily-driver-design.md) | [Plan](../../docs/superpowers/plans/2026-09-29-personal-daily-driver.md) | Wikilink preservation, completion, code blocks and organization. |
| Personal workspace rollout | [Spec](../../docs/superpowers/specs/2026-09-30-personal-workspace-design.md) | [Plan](../../docs/superpowers/plans/2026-09-30-personal-workspace.md) | Account drafts, favorites, revision restoration and export. |
| Task knowledge export | [Spec](../../docs/superpowers/specs/2026-11-04-task-knowledge-export-design.md) | [Plan](../../docs/superpowers/plans/2026-11-04-task-knowledge-export.md) | `/hub-export` in Claude Code or OpenCode saves a finished task to My Space through one restricted, revocable binding; manual, idempotent, no MCP. Setup: [task export setup](../../docs/task-export-setup.md). |
| Agent read access | [Spec](../../docs/superpowers/specs/2026-11-10-agent-read-access-design.md) | [Plan](../../docs/superpowers/plans/2026-11-10-agent-read-access.md) | `/hub-search` and `/hub-read` read the owner's active documents and past task results in My Space through the same export token; read only, one My Space, no MCP. |
| Home continue | [Spec](../../docs/superpowers/specs/2026-10-19-home-continue-design.md) | [Plan](../../docs/superpowers/plans/2026-10-19-home-continue.md) | Drafts, recent documents and favorites on Home. |
| Discovery and Copy for Agent | [Spec](../../docs/superpowers/specs/2026-10-04-mvp-discovery-agent-design.md) | [Plan](../../docs/superpowers/plans/2026-10-04-mvp-discovery-agent.md) | Folder scope, filtered search and reviewed Markdown bundles. |
| Sample wiki and import guide | [Spec](../../docs/superpowers/specs/2026-10-06-sample-wiki-import-guide-design.md) | [Plan](../../docs/superpowers/plans/2026-10-06-sample-wiki-import-guide.md) | Bundled bilingual sample wiki and the in-app import guide with live limits. |
| Retrieval-first shell | [Spec](../../docs/superpowers/specs/2026-10-28-retrieval-first-shell-design.md) | — | The explorer becomes a drawer at 1024–1279px; Favorites and Recent open by default; search stays the primary entry. |
| Google demo login | [Spec](../../docs/superpowers/specs/2026-10-25-google-login-design.md) | [Plan](../../docs/superpowers/plans/2026-10-25-google-login.md) | An additive Google provider for the public demo. |
| Vercel + Layerbase deployment | [Spec](../../docs/superpowers/specs/2026-10-24-vercel-layerbase-deployment-design.md) | [Plan](../../docs/superpowers/plans/2026-10-24-vercel-layerbase-deployment.md) | Single-operator deployment with a site password and build-time migrations. |
| Source rename | [Spec](../../docs/superpowers/specs/2026-10-26-source-rename-design.md) | [Plan](../../docs/superpowers/plans/2026-10-26-source-rename.md) | A source's display label can change without changing its folder identity. |
| Inbox split view | [Spec](../../docs/superpowers/specs/2026-10-29-inbox-split-view-design.md) | — | A list and the selected discussion beside it at 75rem; narrower windows keep the list. |
| Users account | [Spec](../../docs/superpowers/specs/2026-10-29-users-account-design.md) | [Plan](../../docs/superpowers/plans/2026-10-29-users-account.md) | Company SSO account and optional English name stored for future mention autocomplete. |
