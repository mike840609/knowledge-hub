import { describe, expect, it } from "vitest";
import { IntegrityViolationError } from "@/modules/knowledge/domain/errors";
import { SourceImportError } from "@/modules/sources/domain/import-errors";
import type { ImportSnapshotEntry } from "@/modules/sources/domain/import-snapshot";
import { MariaDbImportSnapshotEntryRepository } from "@/infrastructure/database/mariadb/repositories/import-snapshot-entries";
import type { QueryConnection } from "@/infrastructure/database/mariadb/repositories/shared";
import { mapDatabaseError } from "@/infrastructure/database/mariadb/repositories/shared";

type CapturedCall = { sql: string; args: unknown[] };

function stubConnection(calls: CapturedCall[], failWith?: unknown): QueryConnection {
  return {
    query: async <T>(sql: string, args?: unknown[]): Promise<T> => {
      calls.push({ sql, args: [...(args ?? [])] });
      if (failWith !== undefined) throw failWith;
      return [] as unknown as T;
    },
  } as QueryConnection;
}

function sqlError(code: string, errno: number): Error {
  return Object.assign(new Error(`(conn:1, no: ${errno}) ${code}`), { code, errno });
}

let seq = 0;

function syntheticEntry(overrides: Partial<ImportSnapshotEntry> = {}): ImportSnapshotEntry {
  seq += 1;
  return {
    id: `entry-${seq}`,
    snapshotId: "snapshot-1",
    uploadKey: `upload-${seq}`,
    clientRelativePath: `docs/file-${seq}.md`,
    sourcePath: null,
    sourcePathHash: null,
    entryType: "DOCUMENT",
    uploadStatus: "PENDING",
    declaredSize: 1024,
    sourceFileHash: null,
    rawMarkdown: "x".repeat(1024),
    resolvedTitle: null,
    titleSource: null,
    markdown: null,
    metadata: null,
    revisionContentHash: null,
    reconciliationFingerprint: null,
    mimeType: "text/markdown",
    assetContentHash: null,
    assetSize: null,
    assetLastModified: null,
    diagnostics: [],
    previewChange: null,
    ...overrides,
  };
}

const EXPECTED_COLUMNS = [
  "id",
  "snapshot_id",
  "upload_key",
  "client_relative_path",
  "source_path",
  "source_path_hash",
  "entry_type",
  "upload_status",
  "declared_size",
  "source_file_hash",
  "raw_markdown",
  "resolved_title",
  "title_source",
  "markdown",
  "metadata",
  "revision_content_hash",
  "reconciliation_fingerprint",
  "mime_type",
  "asset_content_hash",
  "asset_size",
  "asset_last_modified",
  "diagnostics",
  "preview_change",
];

function columnListOf(sql: string): string[] {
  const match = /INSERT INTO source_import_snapshot_entries \(([^)]+)\)/i.exec(sql);
  if (!match) throw new Error(`no column list in: ${sql}`);
  return match[1].split(",").map((c) => c.trim());
}

describe("MariaDbImportSnapshotEntryRepository.insertMany chunking", () => {
  it("emits O(bytes/chunk) statements for 2500 x 1KiB rows with identical column order", async () => {
    const calls: CapturedCall[] = [];
    const repo = new MariaDbImportSnapshotEntryRepository(stubConnection(calls));
    const entries = Array.from({ length: 2500 }, () => syntheticEntry());

    await repo.insertMany(entries);

    const inserts = calls.filter((c) => c.sql.startsWith("INSERT"));
    expect(inserts.length).toBeLessThanOrEqual(3);
    for (const call of inserts) {
      expect(columnListOf(call.sql)).toEqual(EXPECTED_COLUMNS);
      expect(call.args.length % EXPECTED_COLUMNS.length).toBe(0);
    }
    const allArgs = inserts.flatMap((c) => c.args);
    expect(allArgs.length).toBe(2500 * EXPECTED_COLUMNS.length);
    const ids = new Set<string>();
    for (let i = 0; i < allArgs.length; i += EXPECTED_COLUMNS.length) {
      ids.add(String(allArgs[i]));
    }
    expect(ids.size).toBe(2500);
    expect([...ids].every((id) => entries.some((e) => e.id === id))).toBe(true);
  });

  it("emits a single solo statement for one 6MiB row (oversize still fails via existing 1406 mapping)", async () => {
    const calls: CapturedCall[] = [];
    const repo = new MariaDbImportSnapshotEntryRepository(stubConnection(calls));
    const big = syntheticEntry({ rawMarkdown: "y".repeat(6 * 1024 * 1024) });

    await repo.insertMany([big]);

    const inserts = calls.filter((c) => c.sql.startsWith("INSERT"));
    expect(inserts.length).toBe(1);
    expect(columnListOf(inserts[0].sql)).toEqual(EXPECTED_COLUMNS);
    expect(inserts[0].args.length).toBe(EXPECTED_COLUMNS.length);

    const mapped = mapDatabaseError(sqlError("ER_DATA_TOO_LONG", 1406));
    expect(mapped).toBeInstanceOf(SourceImportError);
    expect((mapped as SourceImportError).code).toBe("INVALID_IMPORT_MANIFEST");
  });

  it("is a no-op for an empty array", async () => {
    const calls: CapturedCall[] = [];
    const repo = new MariaDbImportSnapshotEntryRepository(stubConnection(calls));

    await expect(repo.insertMany([])).resolves.toBeUndefined();
    expect(calls.length).toBe(0);
  });

  it("replaceFinalizedEntries with zero entries emits only DELETE, never invalid INSERT SQL", async () => {
    const calls: CapturedCall[] = [];
    const repo = new MariaDbImportSnapshotEntryRepository(stubConnection(calls));

    await repo.replaceFinalizedEntries("snapshot-1", []);

    expect(calls.length).toBe(1);
    expect(calls[0].sql).toContain("DELETE");
    expect(calls[0].sql.startsWith("INSERT")).toBe(false);
  });

  it("preserves errno 1062 error semantics through mapDatabaseError on a chunked statement", async () => {
    const calls: CapturedCall[] = [];
    const driverError = sqlError("ER_DUP_ENTRY", 1062);
    const repo = new MariaDbImportSnapshotEntryRepository(stubConnection(calls, driverError));

    await expect(repo.insertMany([syntheticEntry(), syntheticEntry()])).rejects.toThrow(driverError);
    const mapped = mapDatabaseError(driverError);
    expect(mapped).toBeInstanceOf(IntegrityViolationError);
  });
});
