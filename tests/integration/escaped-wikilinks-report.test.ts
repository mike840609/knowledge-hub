import type { Pool, PoolConnection } from "mariadb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { formatReport, reportEscapedWikiLinks } from "../../scripts/db/report-escaped-wikilinks";
import { hubDocument, linkOwner, managedDocument, provisionLinkDatabase, reviseHubDocument, setupLinkScope } from "../fixtures/link-graph";

let pool: Pool;
let dispose: () => Promise<void>;
beforeAll(async () => {
  ({ pool, dispose } = await provisionLinkDatabase());
});
afterAll(async () => {
  await dispose();
});

const ids = (report: Awaited<ReturnType<typeof reportEscapedWikiLinks>>) => report.candidates.map((candidate) => candidate.documentId).sort();

describe("db:report-escaped-wikilinks (daily-driver spec §4.3)", () => {
  it("reports a document the old editor damaged, and only that: not a working link, an escape meant as text, code, or a plain document", async () => {
    const scope = await setupLinkScope(pool);
    const damaged = await hubDocument(pool, scope, "Damaged", "Intro.\n\nSee \\[\\[Target Note]] for details, and \\[\\[Other|alias]].");
    await hubDocument(pool, scope, "Working", "See [[Target Note]] for details.");
    await hubDocument(pool, scope, "On purpose", "Written as text: \\[\\[literal\\]\\] with both sides escaped, and \\[\\[half\\]] with one closing bracket.");
    await hubDocument(pool, scope, "Shown as code", "`\\[\\[inline]]` and\n\n```\n\\[\\[fenced]]\n```\n");
    await hubDocument(pool, scope, "Plain", "No links at all.");

    const report = await reportEscapedWikiLinks(pool);

    expect(ids(report)).toEqual([damaged.documentId]);
    const [candidate] = report.candidates;
    expect(candidate).toMatchObject({
      workspaceId: scope.workspaceId,
      sourceId: scope.hubSourceId,
      documentId: damaged.documentId,
      title: "Damaged",
      documentStatus: "ACTIVE",
      sourceStatus: "ACTIVE",
    });
    expect(candidate.occurrences).toEqual([
      { line: 3, text: "\\[\\[Target Note]]" },
      { line: 3, text: "\\[\\[Other|alias]]" },
    ]);
  });

  it("looks at the current revision only: a damaged one that was since put right is not reported, and a newly damaged one is", async () => {
    const scope = await setupLinkScope(pool);
    const fixed = await hubDocument(pool, scope, "Was damaged", "See \\[\\[Target]] here.");
    await reviseHubDocument(pool, fixed.documentId, fixed.revisionId, "Was damaged", "See [[Target]] here.");
    const broken = await hubDocument(pool, scope, "Was fine", "See [[Target]] here.");
    await reviseHubDocument(pool, broken.documentId, broken.revisionId, "Was fine", "See \\[\\[Target]] here.");

    const report = await reportEscapedWikiLinks(pool);

    expect(ids(report)).toEqual(expect.arrayContaining([broken.documentId]));
    expect(ids(report)).not.toContain(fixed.documentId);
  });

  it("reports an archived document with its status, and a folder-sync one whose Hub cannot edit it", async () => {
    const scope = await setupLinkScope(pool);
    const shelved = await hubDocument(pool, scope, "Shelved", "\\[\\[Target]]");
    await pool.query("UPDATE knowledge_documents SET status='ARCHIVED', archived_by=?, archived_at=NOW(6) WHERE id=?", [linkOwner.id, shelved.documentId]);
    const synced = await managedDocument(pool, scope, "notes/synced.md", "Synced", "Escaped by an editor elsewhere: \\[\\[Target]]");

    const report = await reportEscapedWikiLinks(pool);

    const byId = new Map(report.candidates.map((candidate) => [candidate.documentId, candidate]));
    expect(byId.get(shelved.documentId)?.documentStatus).toBe("ARCHIVED");
    expect(byId.get(synced.documentId)).toMatchObject({ sourceId: scope.managedSourceId, sourceStatus: "ACTIVE" });
  });

  it("reads past one batch, and counts every document with a current revision as scanned", async () => {
    const scope = await setupLinkScope(pool);
    const made: string[] = [];
    for (let index = 0; index < 5; index += 1) made.push((await hubDocument(pool, scope, `Batch ${index}`, `n${index} \\[\\[T${index}]]`)).documentId);
    await hubDocument(pool, scope, "Batch clean", "clean");

    const small = await reportEscapedWikiLinks(pool, { batchSize: 2 });
    const large = await reportEscapedWikiLinks(pool, { batchSize: 500 });

    for (const id of made) expect(ids(small)).toContain(id);
    expect(ids(small)).toEqual(ids(large));
    expect(small.scanned).toBe(large.scanned);
    const [{ total }] = await pool.query<{ total: unknown }[]>("SELECT COUNT(*) AS total FROM knowledge_documents WHERE current_revision_id IS NOT NULL");
    expect(small.scanned).toBe(Number(total));
  });

  it("changes nothing: the scan is a read-only transaction and issues no write", async () => {
    const scope = await setupLinkScope(pool);
    await hubDocument(pool, scope, "Damaged for the write check", "\\[\\[Target]]");
    const tables = ["knowledge_documents", "knowledge_revisions", "knowledge_link_index", "knowledge_document_links", "knowledge_tree_nodes"];
    const counts = async () => Promise.all(tables.map(async (table) => Number((await pool.query<{ n: unknown }[]>(`SELECT COUNT(*) AS n FROM ${table}`))[0].n)));
    const before = await counts();

    // Record every statement the report sends, through the same pool.
    const statements: string[] = [];
    const getConnection = pool.getConnection.bind(pool);
    pool.getConnection = async () => {
      const connection: PoolConnection = await getConnection();
      const query = connection.query.bind(connection);
      connection.query = ((sql: string | { sql: string }, values?: unknown) => {
        statements.push((typeof sql === "string" ? sql : sql.sql).trim());
        return query(sql as never, values as never);
      }) as typeof connection.query;
      return connection;
    };
    try {
      await reportEscapedWikiLinks(pool);
    } finally {
      pool.getConnection = getConnection;
    }

    expect(statements[0]).toBe("START TRANSACTION READ ONLY");
    expect(statements.at(-1)).toBe("ROLLBACK");
    expect(statements.filter((statement) => /^(INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP|CREATE|TRUNCATE)\b/i.test(statement))).toEqual([]);
    expect(await counts()).toEqual(before);
  });

  it("cannot write even if it tried: the database refuses a write inside a read-only transaction", async () => {
    const connection = await pool.getConnection();
    try {
      await connection.query("START TRANSACTION READ ONLY");
      await expect(connection.query("UPDATE knowledge_documents SET status = status WHERE 1 = 0")).rejects.toThrow(/read.?only/i);
    } finally {
      await connection.query("ROLLBACK");
      await connection.release();
    }
  });

  it("prints each candidate with its line, and says that they are candidates and that nothing was changed", async () => {
    const scope = await setupLinkScope(pool);
    await hubDocument(pool, scope, "Printed", "a\n\nb \\[\\[Printed Target]]");
    const text = formatReport(await reportEscapedWikiLinks(pool));
    expect(text).toContain('"Printed"');
    expect(text).toContain("line 3: \\[\\[Printed Target]]");
    expect(text).toContain(`workspace ${scope.workspaceId}`);
    expect(text).toMatch(/candidates, not findings/);
    expect(text).toMatch(/Nothing was changed/);
  });
});
