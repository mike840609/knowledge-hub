# Document link index — rollout

Applies to migration `012-document-link-index` and the features that read it
(backlinks, the link graph). Design:
[`personal-workspace-knowledge-graph-design`](../superpowers/specs/2026-09-29-personal-workspace-knowledge-graph-design.md) §7.

## What this changes

Migration 012 adds two tables, `knowledge_link_index` and
`knowledge_document_links`. They are **derived data**: rebuildable from
revisions at any time, and nothing reads them to decide who may see what.
Emptying them changes which relationships are shown, never which documents are
reachable.

New revisions index themselves: all four writers (Hub create and revise,
folder-sync project document and revision) replace the document's edges in the
same transaction that writes the revision. **Documents that existed before the
migration have no index row**, and migrations cannot write data, so they need
one pass of the repair script.

## Order

```text
1. npm run db:migrate                      # adds the tables (empty); prints a hint if documents are unindexed
2. npm run db:reindex-document-links       # or: make db-reindex-links
3. deploy / enable the release that reads the index
```

Steps 1 and 2 can run before the new release is deployed; the old release
neither reads nor writes the tables, so documents saved by it in that window
are simply found stale by the next pass.

## The repair script

`npm run db:reindex-document-links [-- --target dev|test|e2e] [-- --batch-size N]`

- **Idempotent and resumable.** It indexes only documents whose index row is
  missing, was extracted from an older revision, or was extracted by an older
  version of the rules (`LINK_EXTRACTOR_VERSION`). A second run prints
  `0 document(s) indexed`.
- **Safe with traffic.** Each document is done in its own transaction: lock the
  document, read its current revision under the lock, replace its edges. A save
  that lands mid-run waits for the lock and then indexes itself; the script
  never writes an older revision's links over a newer one.
- **Every document, archived included**, so restoring a document needs no
  index write.
- Cost is one Markdown parse and three statements per document; a vault of a
  few thousand notes takes seconds to a minute.

## What users see before it has run

Backlinks and the graph read only *valid* index rows. Until the script has run,
documents without one are counted as stale and the UI says
"Link index is updating (N documents)" instead of showing an empty list that
looks like a fact. Outgoing links and the table of contents do not depend on
the index and work immediately.

## When the extraction rules change

Bump `LINK_EXTRACTOR_VERSION` in
`src/modules/knowledge/domain/document-links.ts` in the same change. Every
existing row then reads as stale, and the same script brings them up to date.

## Adding a code path that writes a revision

It must call `repositories.links.replaceForDocument(...)` in the same
transaction. `tests/unit/link-index-write-points.test.ts` fails if a source file
inserts revisions without doing so. A path that forgets is not silently wrong —
its document shows as stale — but it is still a defect.

## Rollback

Drop nothing. Older releases ignore the tables, and the repair script is safe to
run again after a later release. If the tables must go, they hold no data that
cannot be regenerated: `DROP TABLE knowledge_document_links; DROP TABLE
knowledge_link_index;` (in that order) and remove version 12 from
`schema_migrations`.
