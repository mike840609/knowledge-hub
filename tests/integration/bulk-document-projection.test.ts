import { afterAll, beforeAll, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { bindSourceProjection } from "@/modules/sources/application/source-knowledge-projection-service";
import { extractDocumentLinks } from "@/modules/knowledge/domain/document-links";
import { uuidv7 } from "@/shared/ids/uuidv7";
import { createSourceFixture, fixtureCaller } from "../fixtures/knowledge";

/**
 * Apply creates new documents in bulk (projectDocuments). It must leave exactly what creating
 * them one at a time (projectDocument) leaves: the same tree, positions and rows.
 */
let pool: Pool;
beforeAll(() => { pool = createDatabasePool(databaseConfig("test")); });
afterAll(async () => { await pool.end(); });

/** A Source with a folder, three documents in it (one archived) and uneven positions. */
async function seededSource() {
  const fixture = await createSourceFixture(pool, { managed: true });
  const caller = fixtureCaller();
  await new MariaDbUnitOfWork(pool).run(async (repositories) => {
    const projection = bindSourceProjection(repositories, { id: fixture.source.id, workspaceId: fixture.workspaceId });
    const ids: string[] = [];
    for (const title of ["Old 1", "Old 2", "Old 3"]) {
      const created = await projection.projectDocument(caller, {
        sourceId: fixture.source.id, parentId: fixture.folderId, title, markdown: `# ${title}\n`, metadata: {},
        mapping: { sourceEntryId: uuidv7(), externalId: null, sourcePath: `folder/${title}.md` },
      });
      ids.push(created.documentId);
    }
    await projection.archiveProjectedDocument(caller, ids[1]);
    // Gaps a sync would normally renumber away: placement must start from them as they are.
    const rows = await repositories.tree.listBySource(fixture.source.id);
    for (const [index, node] of rows.filter((row) => row.parentId === fixture.folderId).entries()) {
      await repositories.tree.updatePosition(node.id, index * 5 + 1, caller.identity.id);
    }
  });
  return fixture;
}

const inputs = (sourceId: string, folderId: string) => [
  { parentId: folderId, title: "New end", position: undefined },
  { parentId: folderId, title: "New first", position: 0 },
  { parentId: null, title: "Root A", position: undefined },
  { parentId: folderId, title: "New far", position: 99 },
  { parentId: folderId, title: "New middle", position: 2 },
  { parentId: null, title: "Root B", position: 0 },
].map((input) => ({
  sourceId, parentId: input.parentId, position: input.position, title: input.title,
  markdown: `# ${input.title}\n\nSee [[Old 1]] and [x](other.md).\n`, metadata: { tag: input.title },
  mapping: { sourceEntryId: uuidv7(), externalId: null, sourcePath: `${input.parentId ? "folder/" : ""}${input.title}.md` },
}));

/** Everything about the Source that does not depend on generated ids. */
async function shapeOf(sourceId: string) {
  const nodes = await pool.query<{ label: string; parent: string | null; position: number; status: string }[]>(
    `SELECT COALESCE(n.name, r.title) label, COALESCE(p.name, NULL) parent, n.position, n.status
       FROM knowledge_tree_nodes n
       LEFT JOIN knowledge_tree_nodes p ON p.id = n.parent_id
       LEFT JOIN knowledge_documents d ON d.id = n.document_id
       LEFT JOIN knowledge_revisions r ON r.id = d.current_revision_id
      WHERE n.source_id = ? ORDER BY parent, n.position, label`, [sourceId]);
  const documents = await pool.query<{ title: string; revisions: number; markdown: string; metadata: string; path: string; entryStatus: string; links: number; indexed: number }[]>(
    `SELECT r.title, (SELECT COUNT(*) FROM knowledge_revisions x WHERE x.document_id = d.id) revisions, r.markdown, r.metadata,
            e.source_path path, e.status entryStatus,
            (SELECT COUNT(*) FROM knowledge_document_links l WHERE l.document_id = d.id) links,
            (SELECT COUNT(*) FROM knowledge_link_index i WHERE i.document_id = d.id AND i.revision_id = d.current_revision_id) indexed
       FROM knowledge_documents d JOIN knowledge_revisions r ON r.id = d.current_revision_id
       JOIN source_entries e ON e.document_id = d.id AND e.tree_node_id = (SELECT id FROM knowledge_tree_nodes t WHERE t.document_id = d.id)
      WHERE d.source_id = ? ORDER BY r.title`, [sourceId]);
  return { nodes: nodes.map((node) => ({ ...node, position: Number(node.position) })), documents: documents.map((document) => ({ ...document, revisions: Number(document.revisions), links: Number(document.links), indexed: Number(document.indexed) })) };
}

it("creates in bulk exactly what creating one at a time creates", async () => {
  const caller = fixtureCaller();
  const oneByOne = await seededSource();
  const bulk = await seededSource();

  await new MariaDbUnitOfWork(pool).run(async (repositories) => {
    const projection = bindSourceProjection(repositories, { id: oneByOne.source.id, workspaceId: oneByOne.workspaceId });
    for (const input of inputs(oneByOne.source.id, oneByOne.folderId)) await projection.projectDocument(caller, input);
  });
  const created = await new MariaDbUnitOfWork(pool).run(async (repositories) => {
    // As Apply calls it: with the hoisted tree view the executor keeps.
    const treeView = await repositories.tree.listBySource(bulk.source.id);
    const projection = bindSourceProjection(repositories, { id: bulk.source.id, workspaceId: bulk.workspaceId }, { treeView });
    return projection.projectDocuments(caller, inputs(bulk.source.id, bulk.folderId));
  });

  expect(created).toHaveLength(6);
  const expected = await shapeOf(oneByOne.source.id);
  expect(await shapeOf(bulk.source.id)).toEqual(expected);
  // And the comparison is not vacuous: shifts happened, links were indexed.
  expect(expected.nodes.filter((node) => node.parent === "Fixture Folder").map((node) => node.label)).toEqual(
    ["New first", "Old 1", "New middle", "Old 2", "Old 3", "New end", "New far"],
  );
  const linksPerNew = extractDocumentLinks("# x\n\nSee [[Old 1]] and [x](other.md).\n").length;
  expect(expected.documents.filter((document) => document.title.startsWith("New")).every((document) => document.links === linksPerNew && document.indexed === 1)).toBe(true);
});

it("creates nothing, and writes nothing, for an empty list", async () => {
  const fixture = await createSourceFixture(pool, { managed: true });
  const result = await new MariaDbUnitOfWork(pool).run((repositories) =>
    bindSourceProjection(repositories, { id: fixture.source.id, workspaceId: fixture.workspaceId }).projectDocuments(fixtureCaller(), []));
  expect(result).toEqual([]);
});

it("refuses a parent folder that is archived, writing nothing", async () => {
  const fixture = await createSourceFixture(pool, { managed: true });
  await pool.query("UPDATE knowledge_tree_nodes SET status = 'ARCHIVED', archived_by = updated_by, archived_at = NOW() WHERE id = ?", [fixture.folderId]);
  const attempt = new MariaDbUnitOfWork(pool).run((repositories) =>
    bindSourceProjection(repositories, { id: fixture.source.id, workspaceId: fixture.workspaceId }).projectDocuments(fixtureCaller(), inputs(fixture.source.id, fixture.folderId).slice(0, 1)));
  await expect(attempt).rejects.toThrow();
  const [{ n }] = await pool.query<{ n: number }[]>("SELECT COUNT(*) n FROM knowledge_documents WHERE source_id = ?", [fixture.source.id]);
  expect(Number(n)).toBe(0);
});
