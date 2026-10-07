import { afterAll, beforeAll, expect, it, vi } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { ApplyFolderImportService } from "@/modules/sources/application/apply-folder-import";
import { CreateFolderImportService } from "@/modules/sources/application/create-folder-import";
import { FinalizeFolderImportService } from "@/modules/sources/application/finalize-folder-import";
import { UploadFolderImportEntriesService } from "@/modules/sources/application/upload-folder-import-entries";
import { DEFAULT_IMPORT_LIMITS } from "@/modules/sources/domain/import-limits";
import { createSourceFixture, fixtureCaller } from "../fixtures/knowledge";

/**
 * Apply extracts links before its transaction takes the Source and Workspace, so the full parse
 * of every note no longer runs while they are locked. The edges it stores must be exactly what a
 * parse in place would have stored.
 */
const parses = vi.hoisted(() => ({ locked: false, whileLocked: 0 }));
vi.mock("@/modules/knowledge/domain/document-links", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/knowledge/domain/document-links")>();
  return {
    ...actual,
    extractDocumentLinks: (markdown: string) => {
      if (parses.locked) parses.whileLocked += 1;
      return actual.extractDocumentLinks(markdown);
    },
  };
});
const { extractDocumentLinks } = await vi.importActual<typeof import("@/modules/knowledge/domain/document-links")>("@/modules/knowledge/domain/document-links");

let pool: Pool;
beforeAll(() => { pool = createDatabasePool(databaseConfig("test")); });
afterAll(async () => { await pool.end(); });

/** Marks the stretch of Apply that holds the Workspace. */
function watchingTheLock(): MariaDbUnitOfWork {
  const unitOfWork = new MariaDbUnitOfWork(pool);
  return {
    run: (work: Parameters<MariaDbUnitOfWork["run"]>[0]) => unitOfWork.run((repositories) => work({
      ...repositories,
      workspaces: new Proxy(repositories.workspaces, {
        get(target, key, receiver) {
          if (key !== "lockSharedById") return Reflect.get(target, key, receiver);
          return async (id: string) => { const locked = await target.lockSharedById(id); parses.locked = true; return locked; };
        },
      }),
    })),
  } as unknown as MariaDbUnitOfWork;
}

it("stores the same edges as a parse in place, without parsing while the workspace is held", async () => {
  const fixture = await createSourceFixture(pool);
  const notes: Record<string, string> = {
    "wiki/a.md": "# A\n\nSee [[B]] and [[B#Part|the part]].\n\n```\n[[not a link]]\n```\n",
    "wiki/b.md": "# B\n\n## Part\n\nBack to [A](a.md) and [[Missing]].\n",
    "wiki/c.md": "# C\n\nNo links here.\n",
  };
  const unitOfWork = new MariaDbUnitOfWork(pool);
  const entries = Object.entries(notes).map(([relativePath, text], index) => ({ uploadKey: `k${index}`, relativePath, bytes: new TextEncoder().encode(text) }));
  const session = await new CreateFolderImportService(unitOfWork, { limits: DEFAULT_IMPORT_LIMITS }).createInitial(fixtureCaller(), {
    workspaceId: fixture.workspaceId, sourceName: "Wiki", rootName: "wiki",
    manifest: entries.map((entry) => ({ uploadKey: entry.uploadKey, relativePath: entry.relativePath, kind: "MARKDOWN" as const, size: entry.bytes.byteLength })),
  });
  await new UploadFolderImportEntriesService(unitOfWork, { limits: DEFAULT_IMPORT_LIMITS }).upload(fixtureCaller(), { snapshotId: session.snapshotId, entries });
  await new FinalizeFolderImportService(unitOfWork, { limits: DEFAULT_IMPORT_LIMITS }).finalize(fixtureCaller(), session.snapshotId);

  parses.whileLocked = 0;
  try {
    const applied = await new ApplyFolderImportService(watchingTheLock()).apply(fixtureCaller(), session.snapshotId);
    expect(applied.kind).toBe("APPLIED");
  } finally {
    parses.locked = false;
  }
  expect(parses.whileLocked).toBe(0);

  const rows = await pool.query<{ path: string; markdown: string; kind: string; target: string; fragment: string | null; display: string | null; line: number }[]>(
    `SELECT e.source_path path, r.markdown, l.link_kind kind, l.target_text target, l.target_fragment fragment, l.display_text display, l.line_no line
       FROM source_entries e JOIN knowledge_documents d ON d.id = e.document_id JOIN knowledge_revisions r ON r.id = d.current_revision_id
       LEFT JOIN knowledge_document_links l ON l.document_id = d.id
      WHERE e.source_id = (SELECT id FROM knowledge_sources WHERE workspace_id = ? AND name = 'Wiki') AND e.entry_type = 'DOCUMENT'
      ORDER BY e.source_path, l.ordinal`,
    [fixture.workspaceId],
  );
  const stored = new Map<string, unknown[]>();
  const bodies = new Map<string, string>();
  for (const row of rows) {
    bodies.set(row.path, row.markdown);
    const edges = stored.get(row.path) ?? [];
    if (row.kind !== null) edges.push({ kind: row.kind, target: row.target, fragment: row.fragment, display: row.display, line: Number(row.line) });
    stored.set(row.path, edges);
  }
  expect([...stored.keys()]).toEqual(["wiki/a.md", "wiki/b.md", "wiki/c.md"]);
  for (const [path, markdown] of bodies) {
    expect(stored.get(path)).toEqual(extractDocumentLinks(markdown).map((link) => ({ kind: link.kind, target: link.target, fragment: link.fragment, display: link.display, line: link.line })));
  }
  expect(stored.get("wiki/a.md")).toHaveLength(2);
});
