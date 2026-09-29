import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { LINK_EXTRACTOR_VERSION } from "@/modules/knowledge/domain/document-links";
import { reindexDocumentLinks } from "../../scripts/db/reindex-document-links";
import { hubDocument, linkOwner, managedDocument, provisionLinkDatabase, reviseHubDocument, setupLinkScope } from "../fixtures/link-graph";

let pool: Pool;
let dispose: () => Promise<void>;
beforeAll(async () => {
  ({ pool, dispose } = await provisionLinkDatabase());
});
afterAll(async () => {
  await dispose();
});

async function snapshot(): Promise<{ index: unknown[]; links: unknown[] }> {
  const index = await pool.query<Record<string, unknown>[]>(
    "SELECT document_id, revision_id, extractor_version, link_count FROM knowledge_link_index ORDER BY document_id",
  );
  const links = await pool.query<Record<string, unknown>[]>("SELECT * FROM knowledge_document_links ORDER BY document_id, ordinal");
  return { index, links };
}

async function wipeIndex(): Promise<void> {
  await pool.query("DELETE FROM knowledge_document_links");
  await pool.query("DELETE FROM knowledge_link_index");
}

describe("db:reindex-document-links (graph spec §7.4)", () => {
  it("rebuilds exactly what the write path had indexed, from nothing", async () => {
    const scope = await setupLinkScope(pool);
    await hubDocument(pool, scope, "Hub A", "[[B]] and [c](c.md)\n\n[[D#Setup|d]]");
    await managedDocument(pool, scope, "notes/m.md", "M", "[x](../x.md#top) [[Y]]");
    await hubDocument(pool, scope, "Plain", "no links");
    const written = await snapshot();
    expect(written.index.length).toBeGreaterThanOrEqual(3);

    await wipeIndex();
    const result = await reindexDocumentLinks(pool, { batchSize: 2 });

    expect(result.skipped).toBe(0);
    expect(result.indexed).toBe(written.index.length);
    const rebuilt = await snapshot();
    // indexed_at is when it ran, so it is not part of the comparison; everything that says what the index means is.
    expect(rebuilt.index).toEqual(written.index);
    expect(rebuilt.links).toEqual(written.links);
  });

  it("is idempotent: a second run finds nothing to do", async () => {
    const scope = await setupLinkScope(pool);
    await hubDocument(pool, scope, "Once", "[[A]]");
    await wipeIndex();
    expect((await reindexDocumentLinks(pool)).indexed).toBeGreaterThan(0);
    const before = await snapshot();
    expect(await reindexDocumentLinks(pool)).toEqual({ indexed: 0, skipped: 0 });
    expect(await snapshot()).toEqual(before);
  });

  it("indexes archived documents too, so restoring one needs no index write", async () => {
    const scope = await setupLinkScope(pool);
    const { documentId } = await hubDocument(pool, scope, "Shelved", "[[A]]");
    await pool.query("UPDATE knowledge_documents SET status='ARCHIVED', archived_by=?, archived_at=NOW(6) WHERE id=?", [linkOwner.id, documentId]);
    await wipeIndex();
    await reindexDocumentLinks(pool);
    const rows = await pool.query<{ link_count: unknown }[]>("SELECT link_count FROM knowledge_link_index WHERE document_id = ?", [documentId]);
    expect(rows.map((row) => Number(row.link_count))).toEqual([1]);
  });

  it("repairs rows extracted under older rules", async () => {
    const scope = await setupLinkScope(pool);
    const { documentId } = await hubDocument(pool, scope, "Old rules", "[[A]]");
    await pool.query("UPDATE knowledge_link_index SET extractor_version = 0 WHERE document_id = ?", [documentId]);
    const result = await reindexDocumentLinks(pool);
    expect(result.indexed).toBeGreaterThanOrEqual(1);
    const rows = await pool.query<{ extractor_version: unknown }[]>("SELECT extractor_version FROM knowledge_link_index WHERE document_id = ?", [documentId]);
    expect(Number(rows[0].extractor_version)).toBe(LINK_EXTRACTOR_VERSION);
  });

  it("never leaves an index describing an older revision than the one that is current, even racing a save", async () => {
    const scope = await setupLinkScope(pool);
    const documents = await Promise.all(Array.from({ length: 6 }, (_, index) => hubDocument(pool, scope, `Racing ${index}`, `[[Old ${index}]]`)));
    await wipeIndex();

    // Revise every document while the repair is walking them. Whichever gets a
    // document's lock first, the outcome must be the same: the index is for the
    // revision that ended up current.
    await Promise.all([
      reindexDocumentLinks(pool, { batchSize: 2 }),
      ...documents.map((doc, index) => reviseHubDocument(pool, doc.documentId, doc.revisionId, `Racing ${index}`, `[[New ${index}]]`)),
    ]);
    // A save that beat the repair to a document indexed itself; one the repair
    // reached first was then revised and indexed by that save. A final pass
    // settles anything left, and finds nothing wrong.
    await reindexDocumentLinks(pool);

    const rows = await pool.query<Record<string, unknown>[]>(
      `SELECT d.id, d.current_revision_id, i.revision_id, l.target_text
       FROM knowledge_documents d
       JOIN knowledge_link_index i ON i.document_id = d.id
       JOIN knowledge_document_links l ON l.document_id = d.id
       WHERE d.id IN (${documents.map(() => "?").join(", ")})`,
      documents.map((doc) => doc.documentId),
    );
    expect(rows).toHaveLength(documents.length);
    for (const row of rows) {
      expect(row.revision_id).toBe(row.current_revision_id);
      expect(String(row.target_text)).toMatch(/^New \d$/);
    }
  });
});
