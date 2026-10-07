import { afterAll, beforeAll, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { ApplyFolderImportService } from "@/modules/sources/application/apply-folder-import";
import { CreateFolderImportService } from "@/modules/sources/application/create-folder-import";
import { FinalizeFolderImportService } from "@/modules/sources/application/finalize-folder-import";
import { ImportMemoryBudget } from "@/modules/sources/application/import-memory-budget";
import { UploadFolderImportEntriesService } from "@/modules/sources/application/upload-folder-import-entries";
import { DEFAULT_IMPORT_LIMITS } from "@/modules/sources/domain/import-limits";
import { createSourceFixture, fixtureCaller } from "../fixtures/knowledge";

let pool: Pool;
beforeAll(() => { pool = createDatabasePool(databaseConfig("test")); });
afterAll(async () => { await pool.end(); });

/** Records what each admitted phase asked for. */
class RecordingBudget extends ImportMemoryBudget {
  readonly asked: number[] = [];
  override run<T>(bytes: number, work: () => Promise<T>): Promise<T> {
    this.asked.push(bytes);
    return super.run(bytes, work);
  }
}

it("admits finalize and Apply by the Markdown they load, not the assets", async () => {
  const fixture = await createSourceFixture(pool);
  const unitOfWork = new MariaDbUnitOfWork(pool);
  const notes = ["# A\n\nalpha\n", "# B\n\n第二篇\n"].map((text) => new TextEncoder().encode(text));
  const markdownBytes = notes[0].byteLength + notes[1].byteLength;
  const session = await new CreateFolderImportService(unitOfWork, { limits: DEFAULT_IMPORT_LIMITS }).createInitial(fixtureCaller(), {
    workspaceId: fixture.workspaceId, sourceName: "Budgeted", rootName: "wiki",
    manifest: [
      { uploadKey: "a", relativePath: "wiki/a.md", kind: "MARKDOWN", size: notes[0].byteLength },
      { uploadKey: "b", relativePath: "wiki/b.md", kind: "MARKDOWN", size: notes[1].byteLength },
      { uploadKey: "img", relativePath: "wiki/big.png", kind: "ASSET", size: 50_000_000, contentHash: "a".repeat(64), mimeType: "image/png", lastModified: null },
    ],
  });
  await new UploadFolderImportEntriesService(unitOfWork, { limits: DEFAULT_IMPORT_LIMITS }).upload(fixtureCaller(), {
    snapshotId: session.snapshotId, entries: [{ uploadKey: "a", bytes: notes[0] }, { uploadKey: "b", bytes: notes[1] }],
  });

  const budget = new RecordingBudget(DEFAULT_IMPORT_LIMITS.maxMarkdownTotalBytes);
  await new FinalizeFolderImportService(unitOfWork, { limits: DEFAULT_IMPORT_LIMITS, memoryBudget: budget }).finalize(fixtureCaller(), session.snapshotId);
  const applied = await new ApplyFolderImportService(unitOfWork, { memoryBudget: budget }).apply(fixtureCaller(), session.snapshotId);

  expect(applied.kind).toBe("APPLIED");
  expect(budget.asked).toEqual([markdownBytes, markdownBytes]);
});

it("gives the server's finalize and Apply one shared budget, sized to one import at the limit", async () => {
  const { buildApplicationServices } = await import("@/server/composition");
  const { imports } = buildApplicationServices(pool);
  const budgetOf = (service: object) => (service as { memoryBudget?: ImportMemoryBudget }).memoryBudget;
  expect(budgetOf(imports.finalize)).toBeInstanceOf(ImportMemoryBudget);
  expect(budgetOf(imports.apply)).toBe(budgetOf(imports.finalize));
  expect((budgetOf(imports.apply) as unknown as { capacity: number }).capacity).toBe(DEFAULT_IMPORT_LIMITS.maxMarkdownTotalBytes);
});
