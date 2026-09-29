import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { LINK_EXTRACTOR_VERSION, extractDocumentLinks } from "@/modules/knowledge/domain/document-links";
import { uuidv7 } from "@/shared/ids/uuidv7";
import {
  hubDocument,
  linkOwner,
  managedDocument,
  provisionLinkDatabase,
  reviseHubDocument,
  setupLinkScope,
} from "../fixtures/link-graph";

let pool: Pool;
let dispose: () => Promise<void>;
beforeAll(async () => {
  ({ pool, dispose } = await provisionLinkDatabase());
});
afterAll(async () => {
  await dispose();
});

const uow = () => new MariaDbUnitOfWork(pool);

async function indexRow(documentId: string) {
  const rows = await pool.query<Record<string, unknown>[]>("SELECT * FROM knowledge_link_index WHERE document_id = ?", [documentId]);
  return rows[0] ?? null;
}

async function edges(documentId: string) {
  const rows = await pool.query<Record<string, unknown>[]>(
    "SELECT ordinal, link_kind, target_text, target_fragment, display_text, line_no FROM knowledge_document_links WHERE document_id = ? ORDER BY ordinal",
    [documentId],
  );
  return rows.map((row) => ({
    ordinal: Number(row.ordinal), kind: row.link_kind, target: row.target_text, fragment: row.target_fragment, display: row.display_text, line: Number(row.line_no),
  }));
}

describe("migration 012 schema (graph spec §7.1)", () => {
  async function columns(table: string): Promise<string[]> {
    const rows = await pool.query<{ column_name: string }[]>(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? ORDER BY ordinal_position",
      [table],
    );
    return rows.map((row) => row.column_name);
  }

  it("stores no workspace or source: scope stays derived from Document → Source → Workspace", async () => {
    expect(await columns("knowledge_link_index")).toEqual(["document_id", "revision_id", "extractor_version", "link_count", "indexed_at"]);
    expect(await columns("knowledge_document_links")).toEqual([
      "document_id", "ordinal", "link_kind", "target_text", "target_fragment", "display_text", "line_no",
    ]);
  });

  it("refuses an edge whose document has no index row", async () => {
    const scope = await setupLinkScope(pool);
    const { documentId } = await hubDocument(pool, scope, "Lonely", "no links here");
    await pool.query("DELETE FROM knowledge_link_index WHERE document_id = ?", [documentId]);
    await expect(
      pool.query("INSERT INTO knowledge_document_links (document_id, ordinal, link_kind, target_text, line_no) VALUES (?, 0, 'WIKI', 'X', 1)", [documentId]),
    ).rejects.toMatchObject({ errno: 1452 });
  });

  it("refuses an index row pointing at a revision of another document", async () => {
    const scope = await setupLinkScope(pool);
    const one = await hubDocument(pool, scope, "One", "x");
    const two = await hubDocument(pool, scope, "Two", "y");
    await expect(
      pool.query("UPDATE knowledge_link_index SET revision_id = ? WHERE document_id = ?", [two.revisionId, one.documentId]),
    ).rejects.toMatchObject({ errno: 1452 });
  });

  it("refuses an unknown kind, an empty target and a non-positive line", async () => {
    const scope = await setupLinkScope(pool);
    const { documentId } = await hubDocument(pool, scope, "Checks", "x");
    const insert = (kind: string, target: string, line: number) =>
      pool.query("INSERT INTO knowledge_document_links (document_id, ordinal, link_kind, target_text, line_no) VALUES (?, 99, ?, ?, ?)", [documentId, kind, target, line]);
    await expect(insert("EMBED", "X", 1)).rejects.toMatchObject({ errno: 4025 });
    await expect(insert("WIKI", "", 1)).rejects.toMatchObject({ errno: 4025 });
    await expect(insert("WIKI", "X", 0)).rejects.toMatchObject({ errno: 4025 });
  });

  it("restricts deleting an index row that still has edges", async () => {
    const scope = await setupLinkScope(pool);
    const { documentId } = await hubDocument(pool, scope, "Has edges", "see [[Other]]");
    await expect(pool.query("DELETE FROM knowledge_link_index WHERE document_id = ?", [documentId])).rejects.toMatchObject({ errno: 1451 });
  });
});

describe("the index is written with every revision (graph spec §7.3)", () => {
  it("Hub create: an index row for revision 1 with the document's links", async () => {
    const scope = await setupLinkScope(pool);
    const { documentId, revisionId } = await hubDocument(pool, scope, "Source doc", "See [[Alpha]] and [b](b.md).\n\nLater [[Beta#Setup|beta]].");
    expect(await indexRow(documentId)).toMatchObject({ revision_id: revisionId, extractor_version: LINK_EXTRACTOR_VERSION, link_count: 3 });
    expect(await edges(documentId)).toEqual([
      { ordinal: 0, kind: "WIKI", target: "Alpha", fragment: null, display: null, line: 1 },
      { ordinal: 1, kind: "PATH", target: "b.md", fragment: null, display: "b", line: 1 },
      { ordinal: 2, kind: "WIKI", target: "Beta", fragment: "Setup", display: "beta", line: 3 },
    ]);
  });

  it("Hub create: a document with no links still gets an index row, so it is not 'not indexed yet'", async () => {
    const scope = await setupLinkScope(pool);
    const { documentId, revisionId } = await hubDocument(pool, scope, "Plain", "just text");
    expect(await indexRow(documentId)).toMatchObject({ revision_id: revisionId, link_count: 0 });
    expect(await edges(documentId)).toEqual([]);
  });

  it("Hub revise: replaces the edges instead of adding to them, and follows the new revision", async () => {
    const scope = await setupLinkScope(pool);
    const first = await hubDocument(pool, scope, "Evolving", "[[Old One]] [[Old Two]]");
    const second = await reviseHubDocument(pool, first.documentId, first.revisionId, "Evolving", "[[New]]");
    expect(second.changed).toBe(true);
    expect(await indexRow(first.documentId)).toMatchObject({ revision_id: second.revisionId, link_count: 1 });
    expect((await edges(first.documentId)).map((edge) => edge.target)).toEqual(["New"]);
  });

  it("Hub revise with no change writes nothing new", async () => {
    const scope = await setupLinkScope(pool);
    const first = await hubDocument(pool, scope, "Steady", "[[Same]]");
    const before = await indexRow(first.documentId);
    const again = await reviseHubDocument(pool, first.documentId, first.revisionId, "Steady", "[[Same]]");
    expect(again.changed).toBe(false);
    expect(await indexRow(first.documentId)).toEqual(before);
  });

  it("folder-sync projectDocument and projectRevision index too", async () => {
    const scope = await setupLinkScope(pool);
    const created = await managedDocument(pool, scope, "notes/a.md", "A", "Links to [b](b.md) and [[C]].");
    expect(await indexRow(created.documentId)).toMatchObject({ revision_id: created.revisionId, link_count: 2 });

    const revised = await uow().run(async (repositories) => {
      const { bindSourceProjection } = await import("@/modules/sources/application/source-knowledge-projection-service");
      const projection = bindSourceProjection(repositories, { id: scope.managedSourceId, workspaceId: scope.workspaceId });
      return projection.projectRevision({ identity: linkOwner, sessionId: "test" } as never, {
        documentId: created.documentId, expectedCurrentRevisionId: created.revisionId, title: "A", markdown: "Now only [[D]].", metadata: {},
      });
    });
    expect(revised.changed).toBe(true);
    expect(await indexRow(created.documentId)).toMatchObject({ revision_id: revised.revisionId, link_count: 1 });
    expect((await edges(created.documentId)).map((edge) => edge.target)).toEqual(["D"]);
  });

  it("a write that fails takes its index row with it (same transaction)", async () => {
    const scope = await setupLinkScope(pool);
    const first = await hubDocument(pool, scope, "Atomic", "[[Kept]]");
    await expect(
      uow().run(async (repositories) => {
        await repositories.links.replaceForDocument({ documentId: first.documentId, revisionId: first.revisionId, links: extractDocumentLinks("[[Lost]]") });
        throw new Error("abort after indexing");
      }),
    ).rejects.toThrow();
    expect((await edges(first.documentId)).map((edge) => edge.target)).toEqual(["Kept"]);
  });
});

describe("DocumentLinkRepository", () => {
  it("replaces in chunks and keeps link_count equal to the rows", async () => {
    const scope = await setupLinkScope(pool);
    const first = await hubDocument(pool, scope, "Big", "seed");
    const markdown = Array.from({ length: 1200 }, (_, index) => `[[Target ${index}]]`).join(" ");
    await uow().run((repositories) =>
      repositories.links.replaceForDocument({ documentId: first.documentId, revisionId: first.revisionId, links: extractDocumentLinks(markdown) }),
    );
    expect(await indexRow(first.documentId)).toMatchObject({ link_count: 1200 });
    expect(await edges(first.documentId)).toHaveLength(1200);
  });

  it("loads the catalog: ACTIVE documents of ACTIVE sources in that Workspace only, with path for folder-sync ones", async () => {
    const scope = await setupLinkScope(pool);
    const other = await setupLinkScope(pool);
    const hub = await hubDocument(pool, scope, "Hub One", "x");
    const managed = await managedDocument(pool, scope, "notes/deep/m.md", "Managed One", "y");
    const archived = await hubDocument(pool, scope, "Archived One", "z");
    await hubDocument(pool, other, "Elsewhere", "w");
    await pool.query("UPDATE knowledge_documents SET status='ARCHIVED', archived_by=?, archived_at=NOW(6) WHERE id=?", [linkOwner.id, archived.documentId]);
    await pool.query("UPDATE knowledge_tree_nodes SET status='ARCHIVED', archived_by=?, archived_at=NOW(6) WHERE document_id=?", [linkOwner.id, archived.documentId]);

    const catalog = await uow().run((repositories) => repositories.links.loadCatalog(scope.workspaceId));
    expect(catalog.map((entry) => [entry.title, entry.sourcePath, entry.sourceId]).sort()).toEqual([
      ["Hub One", null, scope.hubSourceId],
      ["Managed One", "notes/deep/m.md", scope.managedSourceId],
    ]);
    expect(new Set(catalog.map((entry) => entry.documentId))).toEqual(new Set([hub.documentId, managed.documentId]));

    await pool.query("UPDATE knowledge_sources SET status='ARCHIVED', archived_by=?, archived_at=NOW(6) WHERE id=?", [linkOwner.id, scope.managedSourceId]);
    const withoutManaged = await uow().run((repositories) => repositories.links.loadCatalog(scope.workspaceId));
    expect(withoutManaged.map((entry) => entry.title)).toEqual(["Hub One"]);
  });

  it("loads the catalog with the title of the current revision", async () => {
    const scope = await setupLinkScope(pool);
    const first = await hubDocument(pool, scope, "Before", "x");
    await reviseHubDocument(pool, first.documentId, first.revisionId, "After", "x");
    const catalog = await uow().run((repositories) => repositories.links.loadCatalog(scope.workspaceId));
    expect(catalog.map((entry) => entry.title)).toEqual(["After"]);
  });

  it("loads only valid edges of ACTIVE documents in the Workspace", async () => {
    const scope = await setupLinkScope(pool);
    const other = await setupLinkScope(pool);
    const live = await hubDocument(pool, scope, "Live", "[[A]]");
    const gone = await hubDocument(pool, scope, "Gone", "[[B]]");
    await hubDocument(pool, other, "Foreign", "[[C]]");
    await pool.query("UPDATE knowledge_documents SET status='ARCHIVED', archived_by=?, archived_at=NOW(6) WHERE id=?", [linkOwner.id, gone.documentId]);

    const loaded = await uow().run((repositories) => repositories.links.loadValidEdges(scope.workspaceId));
    expect(loaded.map((entry) => entry.documentId)).toEqual([live.documentId]);
    expect(loaded[0].links.map((link) => link.target)).toEqual(["A"]);
  });

  it("loads current Markdown only for documents of the given Workspace", async () => {
    const scope = await setupLinkScope(pool);
    const other = await setupLinkScope(pool);
    const mine = await hubDocument(pool, scope, "Mine", "my body");
    const theirs = await hubDocument(pool, other, "Theirs", "their body");
    const loaded = await uow().run((repositories) => repositories.links.loadCurrentMarkdown(scope.workspaceId, [mine.documentId, theirs.documentId]));
    expect([...loaded]).toEqual([[mine.documentId, "my body"]]);
    expect((await uow().run((repositories) => repositories.links.loadCurrentMarkdown(scope.workspaceId, []))).size).toBe(0);
  });
});

/**
 * Stale detection is global — the repair script walks the whole database — so
 * these run against a database of their own. In the shared one, the rows other
 * tests leave behind would count.
 */
describe("stale index rows (own database)", () => {
  let ownPool: Pool;
  let ownDispose: () => Promise<void>;
  beforeAll(async () => {
    ({ pool: ownPool, dispose: ownDispose } = await provisionLinkDatabase());
  });
  afterAll(async () => {
    await ownDispose();
  });
  const ownUow = () => new MariaDbUnitOfWork(ownPool);

  it("counts an index row as stale when the revision moved on, or the rules did", async () => {
    const scope = await setupLinkScope(ownPool);
    const behind = await hubDocument(ownPool, scope, "Behind", "[[A]]");
    const olderRules = await hubDocument(ownPool, scope, "Older rules", "[[B]]");
    const fresh = await hubDocument(ownPool, scope, "Fresh", "[[C]]");
    const never = await hubDocument(ownPool, scope, "Never indexed", "[[D]]");

    // `behind`: a revision written by something that did not index it.
    const newRevision = uuidv7();
    await ownPool.query(
      "INSERT INTO knowledge_revisions (id, document_id, revision_no, title, markdown, metadata, content_hash, created_by) VALUES (?, ?, 2, 'Behind', '[[A2]]', '{}', ?, ?)",
      [newRevision, behind.documentId, "0".repeat(64), linkOwner.id],
    );
    await ownPool.query("UPDATE knowledge_documents SET current_revision_id = ? WHERE id = ?", [newRevision, behind.documentId]);
    await ownPool.query("UPDATE knowledge_link_index SET extractor_version = 0 WHERE document_id = ?", [olderRules.documentId]);
    await ownPool.query("DELETE FROM knowledge_document_links WHERE document_id = ?", [never.documentId]);
    await ownPool.query("DELETE FROM knowledge_link_index WHERE document_id = ?", [never.documentId]);

    const state = await ownUow().run((repositories) => repositories.links.countIndexState(scope.workspaceId));
    expect(state).toEqual({ documents: 4, stale: 3 });

    // Stale edges are not served as if they were current.
    const valid = await ownUow().run((repositories) => repositories.links.loadValidEdges(scope.workspaceId));
    expect(valid.map((entry) => entry.documentId)).toEqual([fresh.documentId]);

    const staleIds = await ownUow().run((repositories) => repositories.links.listStaleDocumentIds(100));
    expect(new Set(staleIds)).toEqual(new Set([behind.documentId, olderRules.documentId, never.documentId]));
  });

  it("pages through stale documents in id order", async () => {
    const scope = await setupLinkScope(ownPool);
    const ids: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const { documentId } = await hubDocument(ownPool, scope, `Paged ${index}`, "x");
      await ownPool.query("DELETE FROM knowledge_link_index WHERE document_id = ?", [documentId]);
      ids.push(documentId);
    }
    const everyStale = await ownUow().run((repositories) => repositories.links.listStaleDocumentIds(1000));
    const pages = await ownUow().run(async (repositories) => {
      const first = await repositories.links.listStaleDocumentIds(3);
      const rest = await repositories.links.listStaleDocumentIds(3, first.at(-1));
      const last = await repositories.links.listStaleDocumentIds(3, rest.at(-1));
      return { first, rest, last };
    });
    expect(pages.first).toHaveLength(3);
    expect([...pages.first, ...pages.rest, ...pages.last]).toEqual(everyStale);
    expect(everyStale).toEqual([...everyStale].sort());
    expect(everyStale).toEqual(expect.arrayContaining(ids));
  });
});
