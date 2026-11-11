<div align="center">

<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/banner-dark.svg">
    <img src="docs/images/banner-light.svg" alt="Knowledge Hub — Markdown notes, connected and shared." width="100%">
  </picture>
</h1>

**Turn Markdown notes into a knowledge workspace you can read, connect, and share.**

[![CI](https://img.shields.io/github/actions/workflow/status/mike840609/knowledge-hub/phase2-dev-gate.yml?branch=main&style=flat-square&logo=githubactions&logoColor=white&label=CI)](https://github.com/mike840609/knowledge-hub/actions/workflows/phase2-dev-gate.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![Version](https://img.shields.io/github/package-json/v/mike840609/knowledge-hub?style=flat-square&color=orange)](package.json)
[![Node.js](https://img.shields.io/badge/node-20.19%E2%80%9324-5FA04E?style=flat-square&logo=nodedotjs&logoColor=white)](package.json)
<br>
[![Next.js](https://img.shields.io/badge/Next.js-15-000000?style=flat-square&logo=nextdotjs&logoColor=white)](https://nextjs.org)
[![React](https://img.shields.io/badge/React-19-149ECA?style=flat-square&logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![MariaDB](https://img.shields.io/badge/MariaDB-10.11-003545?style=flat-square&logo=mariadb&logoColor=white)](https://mariadb.org)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)](https://tailwindcss.com)

**English** · [繁體中文](README.zh-TW.md)

[Quick start](#quick-start) · [Features](#features) · [Configuration](#configuration) · [Deployment](#deployment) · [Development](#development-and-testing) · [Contributing](CONTRIBUTING.md)

<br>

<img src="docs/images/document-reader.jpg" alt="Markdown reader with explorer, outline, resolved links, and backlinks" width="900">

<sub>The document reader: explorer, on-page outline, resolved wikilinks, backlinks, and a clear read-only cue for synced folders.</sub>

</div>

---

Knowledge Hub is an open-source, self-hosted knowledge workspace. Write notes in the browser, or import an existing Markdown folder or LLM Wiki. Find content through search, follow links and backlinks, explore a knowledge graph, discuss shared documents, and export what you need.

Your content stays in plain Markdown — no particular note-taking app, wiki generator, or external knowledge platform required.

> [!NOTE]
> Knowledge Hub is at **0.1.0 and under active development**. The personal workspace, **My Space**, is available by default; Team workspace navigation and access are disabled by default and can be enabled by an administrator. Development uses a local demo identity, and production deployments must integrate a trusted identity provider — see [Deployment](#deployment).

## Highlights

- **Markdown in, Markdown out** — import folders with a reviewable Preview → Apply flow, and export individual files or a whole My Space as a ZIP.
- **Connected knowledge** — `[[wikilinks]]`, relative `.md` links, backlinks, and workspace and local graphs.
- **Fast retrieval** — workspace search with source, path and date filters, plus a `⌘K` / `Ctrl+K` palette.
- **Share and discuss** — expiring, revocable read-only links for documents, folders and Sources, with passage-level discussions.
- **Agent-ready** — Copy for Agent, and scoped read APIs that follow the same access rules as the web app.
- **Self-hosted** — a Next.js server and MariaDB that you run and own.

## Screenshots

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/images/personal-home.jpg" alt="Home with recent documents, discussions, favorites, search, and a new-note action">
      <p><b>Personal home</b> — drafts, recent documents, discussions and favorites, with Search and New note in reach.</p>
    </td>
    <td width="50%" valign="top">
      <img src="docs/images/search.jpg" alt="Search results for leave with source and path shown for each match">
      <p><b>Search</b> — search the whole workspace and narrow results by source, path and update date.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/images/source-history.jpg" alt="Markdown folder source overview and sync history">
      <p><b>Sources and sync history</b> — review a folder's ownership and history, then use <b>Update from folder</b> to select the source folder again and review changes. A Source can be shared as one link that never exposes its settings, history or assets.</p>
    </td>
    <td width="50%" valign="top">
      <img src="docs/images/knowledge-graph.jpg" alt="Knowledge graph connecting the sample handbook and related notes">
      <p><b>Knowledge graph</b> — explore links between documents, find a note, and filter by source or unresolved targets.</p>
    </td>
  </tr>
</table>

<sub>Captured on October 29, 2026 (Asia/Taipei) from a production build of commit <a href="https://github.com/mike840609/knowledge-hub/commit/ba699b4e37ed5fdc22f3633e468aff6ef5a1704d"><code>ba699b4e</code></a> at 1440 × 900, using a demo account, the bundled English sample wiki and synthetic notes. Below 1280px the explorer becomes a drawer; below 1024px navigation moves into the Menu drawer. See the <a href="docs/images/README.md">capture provenance</a>.</sub>

## Features

| Feature | What it provides |
| --- | --- |
| **Personal workspace** | My Space, Home, Inbox, personal notes, drafts, favorites, and recently read documents; reading history stays on the device |
| **Inbox** | Unread updates and activity; at wide widths the selected discussion opens beside the list for reply, resolve and hide |
| **Markdown editing** | Rendered editing and Markdown source modes, slash insertions, tables, toggles, callouts, code blocks, an outline, and keyboard shortcuts |
| **Drafts and revisions** | Account-backed autosave, local recovery on failure, immutable revision history, comparison and restore, and stale-editor conflict checks |
| **Import and sync** | Import a Markdown folder through Preview → Apply; select the folder again to review later changes; exclude paths, inspect source health, and rename a source |
| **Organization** | Document and folder trees, move, rename, archive, and restore; source-managed content is read-only in the Hub |
| **Search and retrieval** | Workspace search with source, path and date filters; quick search and recent documents in the `⌘K` / `Ctrl+K` palette; saved searches |
| **Knowledge links** | `[[wikilinks]]`, relative `.md` links, backlinks, and workspace and local graphs |
| **Discussions** | Owner discussions beside the passage, comments on shared pages, replies, resolve and hide, unread notifications, and followed discussions |
| **Sharing** | Anonymous read-only My Space document links with expiry and revocation; permanent links named for chosen signed-in people; recipient-owned saved shares; owner moderation |
| **Export** | Individual Markdown downloads and a My Space ZIP with directory structure and a stable ID/path manifest |
| **Agent context** | Copy for Agent and workspace-scoped read/context APIs that follow the application's access rules, including discussions |
| **Team workspaces** *(opt-in)* | Workspace administration, membership, roles and capabilities, external group mapping, and audit records |

### Content ownership

- **Folder Sync (`SOURCE_MANAGED`)** — the original folder is the source of truth. Edit the original Markdown files, generate a new preview, and apply it. The Hub does not edit synced content directly or watch your local folder in the background.
- **Web Create / individual Upload (`HUB_MANAGED`)** — the Hub manages the content after creation or upload. Edit it in the browser; saving creates a new revision.

A preview is a fixed, staged snapshot. Resolve blocking diagnostics before applying it. If the source version changes, Apply returns a conflict and you must generate a new preview.

### Current limitations and future direction

- Assets store metadata and references only; there is no binary attachment storage yet. Local images and attachments are not guaranteed to open online.
- ZIP exports include the latest saved versions of archived documents, but exclude drafts, revision history, and attachment bytes. The limit is 64 MiB / 9,999 documents.
- Documents use archive and restore for their lifecycle; there is no general end-user permanent deletion.
- Search is keyword-based. An MCP server, semantic/hybrid retrieval, and advanced agent memory are future directions, not shipped features.
- Team workspaces display **Coming soon** by default. Enabling the feature flag does not complete production identity integration.
- Discussion writes are separately gated by `KM_REVIEW_WRITES_ENABLED`. Existing discussion reads and owner moderation remain available when writes are off.
- Hiding a discussion does not physically erase stored data.

## Quick start

### Prerequisites

| Requirement | Notes |
| --- | --- |
| Node.js **≥ 20.19.0, < 25** | [`.node-version`](.node-version) specifies 24.19.0 |
| pnpm 12 | Default for local development; npm is the fallback (see [Local pnpm](docs/development/maintainers.md#local-pnpm)) |
| Docker + Compose v2 | Must support `up --wait`; runs MariaDB 10.11 |
| `make`, Git | Without `make`, use the steps below |

```bash
git clone https://github.com/mike840609/knowledge-hub.git
cd knowledge-hub
make bootstrap
make dev
```

Open **http://127.0.0.1:3000/** to enter My Space.

`make bootstrap` uses pnpm when pnpm 12 is installed and falls back to `npm ci`. It installs dependencies, copies `.env.example` to `.env` if none exists (an existing `.env` is preserved), starts the database, runs migrations, and loads development fixtures. The example database credentials are for local development only.

<details>
<summary><b>Without make</b></summary>

```bash
pnpm install
cp .env.example .env  # First setup only; preserve and review an existing .env
docker compose up -d --wait mariadb
pnpm run db:migrate
pnpm run db:seed
pnpm run dev
```

If pnpm is unavailable, run `rm -rf node_modules .next && npm ci` instead of `pnpm install`.

</details>

### Your first workflow

1. Choose **New note** to write a note, or **Import folder** to bring in a Markdown folder. The import page links to the folder format guide and offers **Try with a sample wiki**, which imports a ready-made folder (English or Traditional Chinese, from `public/sample-wiki/`) through the normal Preview → Apply flow.
2. For imports, review additions, updates, archives, and diagnostics in Preview before applying.
3. Use `[[Document title]]` in editable notes to link documents, then open **Graph** to explore relationships.
4. Save a note before creating a read-only share link or downloading its Markdown.
5. When your local source changes, select the folder again and follow Preview → Apply.

### User guide

Open the account menu at the bottom of the sidebar and select **Help & guides** (`/help`, the same address for everyone; the folder format reference is at `/help#format-reference`). The in-app English and Traditional Chinese manual covers first import, repeat sync, permissions and recovery, reading, search, Insights, sharing, discussions and export. Preview and sync errors link to the relevant sections. The **Import folder → Read the guide** path continues to cover Markdown structure, `knowledge_id` and configured import limits.

Both languages live in `src/components/help/user-guide-content.ts`; update them together when workflows change.

## Configuration

See [`.env.example`](.env.example) for local settings and import limits. Restart the application after changing server environment settings.

| Setting | Purpose / default |
| --- | --- |
| `KM_DB_HOST` / `KM_DB_PORT` | MariaDB address; locally `127.0.0.1:3307` |
| `KM_DB_USER` / `KM_DB_PASSWORD` / `KM_DB_NAME` | Application database credentials and database name |
| `KM_DB_URL` / `KM_DB_SSL` | Deployed database URL and TLS mode; preferred over the individual `KM_DB_*` values |
| `KM_LOCAL_IDENTITY_ENABLED` | Local development identity; `true` in the example |
| `KM_LOCAL_ID` / `KM_LOCAL_EMP_ID` / `KM_LOCAL_NAME` / `KM_LOCAL_ORG_CODE` | Server-configured local identity, rather than a login form |
| `KM_TEAM_WORKSPACES_ENABLED` | Defaults to `false`; set to `true` to enable Team navigation and access |
| `KM_IDENTITY_PROVIDER` | `local` by default; production uses `company-sso` with a session reader, or `google` for the demo login |
| `KM_REVIEW_WRITES_ENABLED` | Defaults to `false`; enables new discussion threads and replies |
| `KM_PUBLIC_ORIGIN` | Browser-facing origin when the Hub sits behind a Gateway or reverse proxy; required for discussion requests there |
| `KM_SITE_PASSWORD` | Optional site password for a single-operator Vercel deployment |
| `KM_IMPORT_*` | Import file counts, sizes, batch limits, and snapshot quotas |
| `KM_TEST_DB_*` / `KM_E2E_DB_PREFIX` | Isolated test database settings; the test account must be able to create and drop databases with the designated prefixes |

Default import limits include 20,000 manifest entries, 3.5 MiB per Markdown file, and 256 MiB of Markdown in total. Snapshot retention is 2 hours for `BUILDING`, 30 minutes for `READY`, and 24 hours for `STALE` / `APPLIED`. The server deletes expired staging data in the background when someone starts an import, at most once every 10 minutes per process. To clean up on demand (for example, on an instance nobody imports into):

```bash
npx tsx scripts/db/cleanup-import-snapshots.ts
```

This removes import staging data only and preserves canonical document history.

## Deployment

Knowledge Hub runs a Next.js server with MariaDB. `compose.yaml` provides a development database, not a complete production deployment.

```bash
npm ci
npm run db:migrate
npm run build
npm run start
```

> [!IMPORTANT]
> **Complete identity integration before running in production.** `npm run start` runs in production mode, which rejects the default Local identity provider. `KM_ALLOW_LOCAL_IDENTITY_IN_PRODUCTION` exists for testing and must not be used as a deployment method.

**Deployment paths**

- **Single operator on Vercel** — follow the [Vercel + Layerbase runbook](docs/operations/vercel-layerbase.md). It keeps the local identity provider behind an optional site password, runs migrations during production builds, and disables preview deployments. Do not use it for a shared or company deployment.
- **Public demo** — the same runbook documents [Google demo login](docs/operations/vercel-layerbase.md#google-demo-login): set `KM_IDENTITY_PROVIDER=google` and the `AUTH_*` variables. It is additive; the local and company-SSO paths are unchanged.
- **Company SSO** — the application provides a generic `company-sso` adapter contract. Implement a trusted [`CompanySsoSessionReader`](src/modules/identity/ports/company-sso-session-reader.ts) and register it through [`configureCompanySsoSessionReader`](src/server/composition.ts) before application services are created. Setting `KM_IDENTITY_PROVIDER=company-sso` alone does not provide an OAuth/OIDC login page or identity service.

<details>
<summary><b>Company SSO integration details</b></summary>

The reader must return the company account name as `account` and the optional English display name as `name_en`, alongside the subject, employee id, name, org code, and group IDs.

Shared-page **Open in Knowledge Hub** and **Get started** links navigate to `KM_PUBLIC_ORIGIN` with a full browser navigation when it is configured, so the company Gateway at that origin can challenge anonymous users for SSO. The entry URL carries `returnTo=/s/:token/open`; the Gateway must preserve this query string through SSO. After authentication, the Hub accepts only a share-opening path and resumes the existing link-validity and document-access checks. Invalid or absent continuation parameters fall back to the ordinary home destination. Without `KM_PUBLIC_ORIGIN`, these links keep the local `/s/:token/open` flow.

</details>

**Production checklist**

- Separate database credentials, backups, HTTPS, and a trusted session integration. Never expose example development credentials or test settings.
- The `start` script binds to `127.0.0.1`, suitable for a reverse proxy on the same host. Container deployments need an appropriate bind address in their startup command.
- **Try with a sample wiki** fetches static files from `/sample-wiki/*` (`manifest.json` and the Markdown files), so a reverse proxy or SSO allow-list must serve that path to signed-in users. The URLs are absolute, so a Next.js `basePath` is not supported.
- Before upgrading an existing database, read the [workspace governance cutover guide](docs/operations/phase3-workspace-governance-cutover.md); some migrations enforce data readiness gates. Use the [document link index rollout guide](docs/operations/document-link-index-rollout.md) to backfill or repair links with `npm run db:reindex-document-links`, and [Team workspace availability](docs/operations/team-workspaces-availability.md) for feature flag operations.

### Document review deployment

Discussions are stored separately from Markdown and Folder Sync. `KM_REVIEW_WRITES_ENABLED` defaults to off; existing discussion reads and owner moderation remain available while new threads and replies are disabled. Behind a Gateway or reverse proxy, set `KM_PUBLIC_ORIGIN` to the origin browsers use (for example `https://km.example.com`); without it every discussion request is refused as cross-origin. Company SSO/Gateway and login continuation require separate corporate integration evidence before production writes are enabled. Hiding content does not physically erase stored data.

[Inline review design](docs/superpowers/specs/2026-10-09-shared-personal-document-inline-review-design.md) · [Implementation plan](docs/superpowers/plans/2026-10-09-shared-personal-document-inline-review.md) · [Verification](docs/superpowers/verification/2026-10-09-shared-personal-document-inline-review.md)

## Architecture

| Layer | Technology |
| --- | --- |
| Web application | Next.js 15, React 19, TypeScript |
| UI | Tailwind CSS, Base UI, Lucide icons |
| Markdown | Milkdown, react-markdown, remark-gfm |
| Knowledge graph | d3-force |
| Database | MariaDB 10.11 |
| Testing | Vitest, Playwright |

The application is a modular monolith. Its modules — `identity`, `workspaces`, `sources`, `knowledge`, `personal` and `task-knowledge` — keep domain rules free of I/O, and web pages and APIs share the same application services. Module boundaries are enforced by lint rules.

```text
User → WorkspaceMembership → Workspace
                                └── KnowledgeSource
                                      ├── Folder / Document tree
                                      ├── Asset metadata / references
                                      └── KnowledgeDocument (stable ID)
                                            └── KnowledgeRevision (immutable)
```

A workspace is both a knowledge container and the basic access boundary. Organizational attributes do not grant access, and knowing a document ID does not authorize reading it. Public share links are explicitly created, revocable, read-only entry points.

```text
src/app/             Next.js pages and HTTP routes
src/components/      UI, shell, composer, reader, review, and graph
src/modules/         Domain, application services, and ports
src/infrastructure/  MariaDB repositories and identity adapters
src/server/          Request composition and server-side read models
src/lib/             Shared client and server helpers
src/shared/          Cross-module domain primitives
scripts/             Migrations, seeds, maintenance, and test runners
tests/               Unit, integration, E2E, and fixtures
docs/                Design, operations, and verification records
```

## Development and testing

```bash
make verify            # unit tests, TypeScript, lint, and build
make test-integration  # MariaDB integration tests on an isolated database
make test-e2e          # production build and Playwright on an isolated database
```

`make help` lists every command. [Local setup and verification](docs/development/local-setup.md#make-commands) has the full command list, test databases, E2E modes and reports; toolchain details ([local pnpm](docs/development/maintainers.md#local-pnpm), the [Next.js patch](docs/development/maintainers.md#nextjs-patch), the [Mermaid version](docs/development/maintainers.md#mermaid-version)) are in the [maintainer guide](docs/development/maintainers.md).

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Database connection fails | Check Docker, `make db-logs`, and the credentials in `.env`. The local database uses port 3307, the dev server 3000, and E2E 3101 by default. |
| Team navigation is unavailable | **Coming soon** is the default. Set `KM_TEAM_WORKSPACES_ENABLED=true` and restart. |
| Production identity error | Local identity does not provide production login. Integrate an SSO session reader or use the documented Google demo provider. |
| Import cannot be applied | Resolve blockers in Preview. A 409 version conflict requires a new preview; there is no Force Apply. |
| Links or graph entries are missing | Ensure migrations are complete, then run `make db-reindex-links`. Fix wikilinks in synced documents at the original source. |
| Comments cannot be added | Set `KM_REVIEW_WRITES_ENABLED=true` and restart. Behind a Gateway, also set `KM_PUBLIC_ORIGIN`. |
| Resetting development data | `make db-reset` deletes the development database volume and all its contents. Back up anything you need first. |

## Documentation

English is the primary documentation language. Each project Markdown guide links to its Traditional Chinese companion (`*.zh-TW.md`). Some originally English historical documents keep their full English technical text beneath a Chinese reading guide; those companions say so explicitly. Historical records preserve the technical context of their original date; consult the current canonical documents for present behavior.

- [Operations guides](docs/operations/) — database upgrades, Team availability, deployment, and index maintenance
- [Design specifications](docs/superpowers/specs/) and [implementation plans](docs/superpowers/plans/) — behavior contracts and design decisions
- [Verification records](docs/superpowers/verification/) — testing and inspection evidence for individual features
- [Phase roadmap](docs/superpowers/roadmaps/2026-09-10-knowledge-hub-phase-roadmap.md), [action model](docs/superpowers/specs/2026-09-21-action-model-spec.md), [keyboard shortcuts](docs/superpowers/specs/2026-09-24-keyboard-shortcuts-design.md), [row keyboard actions](docs/superpowers/specs/2026-10-02-row-keyboard-actions-design.md), and the undated [frontend design language](docs/superpowers/specs/frontend-design-language.md), updated in place
- [Current canonical documents](docs/development/maintainers.md#current-canonical-documents) — the design spec and plan that define each area's current behavior

Historical designs and roadmaps preserve development context and may describe features that are unimplemented or have since changed. Current source code and tests define shipped behavior; the feature table above provides an overview for users.

## Contributing

Contributions are welcome. Read the [contributing guide](CONTRIBUTING.md) to report issues, propose features, and submit pull requests, and use [GitHub Issues](https://github.com/mike840609/knowledge-hub/issues) for general questions and feature requests.

Please report security vulnerabilities privately as described in [SECURITY.md](SECURITY.md), not in public issues; it also covers deployment considerations.

## License

Knowledge Hub is released under the [MIT License](LICENSE). You may use, modify, and distribute it, retaining the original copyright and license notices when redistributing. Third-party dependencies retain their respective licenses.
