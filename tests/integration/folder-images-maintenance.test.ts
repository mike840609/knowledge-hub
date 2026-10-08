import { mkdtemp, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { provisionIsolatedDatabase, disposeIsolatedDatabase } from "../../scripts/db/test-database";
import { runMigrations, type IsolatedDatabaseHandle } from "../../scripts/db/migrate";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { FilesystemBlobStore } from "@/infrastructure/storage/filesystem-blob-store";
import { BlobMaintenanceService } from "@/modules/sources/application/blob-maintenance";
import { buildApplicationServices } from "@/server/composition";
import { createSourceFixture, fixtureCaller } from "../fixtures/knowledge";
import { png, prepareImageImport, sha256, stageImageImport, stream } from "../fixtures/folder-images";

let pool: Pool, handle: IsolatedDatabaseHandle, uow: MariaDbUnitOfWork, blobs: FilesystemBlobStore, root: string, ws: string;
let s: ReturnType<typeof buildApplicationServices>;
beforeAll(async () => {
  handle = await provisionIsolatedDatabase("test");
  pool = createDatabasePool({ ...databaseConfig("test"), database: handle.databaseName });
  await runMigrations(pool);
  uow = new MariaDbUnitOfWork(pool);
  root = await mkdtemp(path.join(tmpdir(), "km-images-"));
  blobs = new FilesystemBlobStore(root);
  s = buildApplicationServices(pool, { blobStore: blobs });
});
beforeEach(async () => {
  // Tests leave snapshots BUILDING or READY on purpose; the per-user quota is 3 and 10.
  await pool.query("DELETE FROM source_import_snapshots WHERE state IN ('BUILDING','READY')");
  await rm(path.join(root, "sha256"), { recursive: true, force: true });
  if (ws) await pool.query("UPDATE workspaces SET workspace_type='TEAM',personal_owner_user_id=NULL WHERE id=?", [ws]);
  ws = (await createSourceFixture(pool)).workspaceId;
  await pool.query("UPDATE workspaces SET name='My Space',workspace_type='PERSONAL',personal_owner_user_id=? WHERE id=?", [fixtureCaller().identity.id, ws]);
});
afterAll(async () => { await pool?.end(); if (handle) await disposeIsolatedDatabase(handle); await rm(root, { recursive: true, force: true }); });

const blobFile = (hash: string) => path.join(root, "sha256", hash.slice(0, 2), hash.slice(2, 4), hash);
const age = async (hash: string, hours: number) => { const when = new Date(Date.now() - hours * 3600_000); await utimes(blobFile(hash), when, when); };
const orphan = async (seed: string, hours: number) => { const bytes = png(seed); await blobs.put(sha256(bytes), stream(bytes), bytes.byteLength); await age(sha256(bytes), hours); return sha256(bytes); };
const files = [{ path: "guide.md", text: "# Guide\n![d](img/d.png)" }, { path: "img/d.png", bytes: png("kept") }];

it("removes only blobs that are old and referenced by nothing", async () => {
  const applied = await s.imports.apply.apply(fixtureCaller(), (await prepareImageImport(uow, blobs, ws, null, files)).snapshotId);
  expect(applied.kind).toBe("APPLIED");
  const staged = await prepareImageImport(uow, blobs, ws, null, [{ path: "a.md", text: "# A" }, { path: "p.png", bytes: png("staged") }]);
  expect(staged.assetUploads).toHaveLength(1);
  await age(sha256(png("kept")), 100);
  await age(sha256(png("staged")), 100);
  const oldOrphan = await orphan("old-orphan", 49);
  const youngOrphan = await orphan("young-orphan", 47);
  expect(await new BlobMaintenanceService(uow, blobs).gc()).toEqual({ removed: 1 });
  expect(await blobs.has(oldOrphan)).toBe(false);
  expect(await blobs.has(youngOrphan)).toBe(true);
  expect(await blobs.has(sha256(png("kept")))).toBe(true);
  expect(await blobs.has(sha256(png("staged")))).toBe(true);
});
it("reports stored images whose bytes are gone, and repairs them so the next sync re-uploads", async () => {
  const applied = await s.imports.apply.apply(fixtureCaller(), (await prepareImageImport(uow, blobs, ws, null, files)).snapshotId);
  if (applied.kind !== "APPLIED") throw Error("fixture");
  const maintenance = new BlobMaintenanceService(uow, blobs);
  expect((await maintenance.verify()).missing).toEqual([]);
  await blobs.remove(sha256(png("kept")));
  const report = await maintenance.verify();
  // The report covers every source; an earlier test's source stores the same file.
  expect(report.missing.filter((item) => item.sourceId === applied.sourceId)).toMatchObject([{ sourcePath: "img/d.png" }]);
  // Without repair the source still claims the hash, so a sync asks for no bytes and the image stays broken.
  expect((await stageImageImport(uow, blobs, ws, applied.sourceId, files)).assetUploads).toEqual([]);
  await maintenance.verify({ repair: true });
  const next = await stageImageImport(uow, blobs, ws, applied.sourceId, files);
  expect(next.assetUploads).toEqual(["f1"]);
});
