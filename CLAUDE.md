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

CI (`.github/workflows/phase2-dev-gate.yml`) runs four jobs on every PR to
`main`: `unit` (which also runs typecheck and lint), `build`, `integration`
and `e2e`. `make verify` covers everything except the two DB-backed jobs.

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
  The single bearer grant is a **document share link**
  (`docs/superpowers/specs/2026-09-23-document-share-link-design.md`): an
  unguessable (random UUIDv4, never derived from any entity ID), expiring,
  revocable token that the document's owner issues on purpose. It requires no
  sign-in. It is accepted by exactly one read path (`/s/:token`, through
  `DocumentShareService.readShared`) and grants whoever holds it the current
  revision of one document — never search, tree, history, MCP, or any write.
  No other code path may serve document content without a caller;
  `tests/unit/share-link-single-exception.test.ts` enforces that.
- **`org_code` does not decide access.** It answers which company org a user
  belongs to; workspace membership answers what they can open. Cross-org
  membership is legal and same-org membership is not automatic.
- **Source ownership decides who may write.** `SOURCE_MANAGED` content
  (folder sync) is read-only in the Hub and updated by re-syncing the source;
  `HUB_MANAGED` content (upload, web create) is editable. Workspace access and
  source ownership are separate questions and must not be conflated.
- **Identity vs position vs content.** The tree decides position, the document
  ID decides identity, and the revision stores title/Markdown/metadata. Moving
  or renaming a file creates no revision; editing the article title does.
- **Lifecycle is `ACTIVE` / `ARCHIVED` only.** There is no hard delete.

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
