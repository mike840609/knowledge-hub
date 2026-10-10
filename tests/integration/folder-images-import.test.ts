import { mkdtemp, rm } from "node:fs/promises";
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
import { UploadFolderImportAssetService } from "@/modules/sources/application/upload-folder-import-asset";
import { FinalizeFolderImportService } from "@/modules/sources/application/finalize-folder-import";
import { buildApplicationServices } from "@/server/composition";
import { createSourceFixture, fixtureCaller, secondFixtureIdentity } from "../fixtures/knowledge";
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

const files = [{ path: "guide.md", text: "# Guide\n![d](img/d.png)" }, { path: "img/d.png", bytes: png("d") }, { path: "notes.pdf", bytes: png("pdf") }, { path: "empty.png", bytes: new Uint8Array() }];
const entryRow = async (snapshotId: string, key: string) => (await pool.query("SELECT upload_status, source_file_hash FROM source_import_snapshot_entries WHERE snapshot_id=? AND upload_key=?", [snapshotId, key]))[0];

it("asks for the bytes of non-empty images only, and stages them PENDING", async () => {
  const staged = await stageImageImport(uow, blobs, ws, null, files);
  expect(staged.assetUploads).toEqual(["f1"]);
  expect(await entryRow(staged.snapshotId, "f1")).toMatchObject({ upload_status: "PENDING", source_file_hash: null });
  expect(await entryRow(staged.snapshotId, "f2")).toMatchObject({ upload_status: "RECEIVED", source_file_hash: null });
  expect(await entryRow(staged.snapshotId, "f3")).toMatchObject({ upload_status: "RECEIVED", source_file_hash: null });
});
it("asks for nothing when the store is off", async () => {
  expect((await stageImageImport(uow, null, ws, null, files)).assetUploads).toEqual([]);
});
it("stores verified bytes, records the proof, and accepts a replay", async () => {
  const staged = await stageImageImport(uow, blobs, ws, null, files);
  const upload = new UploadFolderImportAssetService(uow, blobs);
  const bytes = png("d"), input = { snapshotId: staged.snapshotId, uploadKey: "f1", contentLength: bytes.byteLength };
  expect(await upload.upload(fixtureCaller(), { ...input, body: stream(bytes) })).toEqual({ accepted: true });
  expect(await blobs.has(sha256(bytes))).toBe(true);
  expect(await entryRow(staged.snapshotId, "f1")).toMatchObject({ upload_status: "RECEIVED", source_file_hash: sha256(bytes) });
  expect(await upload.upload(fixtureCaller(), { ...input, body: stream(bytes) })).toEqual({ accepted: false });
});
it("rejects wrong bytes, a wrong length, a non-image key and another user, storing nothing", async () => {
  const staged = await stageImageImport(uow, blobs, ws, null, files);
  const upload = new UploadFolderImportAssetService(uow, blobs);
  const bytes = png("d"), wrong = png("x"), base = { snapshotId: staged.snapshotId, uploadKey: "f1" };
  await expect(upload.upload(fixtureCaller(), { ...base, body: stream(wrong), contentLength: wrong.byteLength })).rejects.toMatchObject({ code: "UPLOAD_SIZE_MISMATCH" });
  await expect(upload.upload(fixtureCaller(), { ...base, body: stream(bytes), contentLength: bytes.byteLength + 1 })).rejects.toMatchObject({ code: "UPLOAD_SIZE_MISMATCH" });
  await expect(upload.upload(fixtureCaller(), { ...base, uploadKey: "f0", body: stream(bytes), contentLength: bytes.byteLength })).rejects.toMatchObject({ code: "UPLOAD_ENTRY_NOT_FOUND" });
  await expect(upload.upload(fixtureCaller(), { ...base, uploadKey: "f2", body: stream(bytes), contentLength: bytes.byteLength })).rejects.toMatchObject({ code: "UPLOAD_ENTRY_NOT_FOUND" });
  await expect(upload.upload(fixtureCaller(secondFixtureIdentity), { ...base, body: stream(bytes), contentLength: bytes.byteLength })).rejects.toMatchObject({ code: "IMPORT_SNAPSHOT_NOT_FOUND" });
  expect(await blobs.has(sha256(bytes))).toBe(false);
  expect(await entryRow(staged.snapshotId, "f1")).toMatchObject({ upload_status: "PENDING" });
});
it("does not accept another workspace's blob as proof: finalize waits for this snapshot's own upload", async () => {
  const bytes = png("d");
  await blobs.put(sha256(bytes), stream(bytes), bytes.byteLength);
  const staged = await stageImageImport(uow, blobs, ws, null, files);
  expect(staged.assetUploads).toEqual(["f1"]);
  await expect(new FinalizeFolderImportService(uow).finalize(fixtureCaller(), staged.snapshotId)).rejects.toMatchObject({ code: "UPLOAD_INCOMPLETE" });
});

const assetRows = async (sourceId: string): Promise<{ path: string; hash: string; stored: boolean }[]> => (await pool.query("SELECT source_path, content_hash, JSON_EXTRACT(metadata,'$.stored') stored FROM knowledge_assets WHERE source_id=? ORDER BY source_path", [sourceId]))
  .map((row: { source_path: string; content_hash: string; stored: unknown }) => ({ path: row.source_path, hash: row.content_hash, stored: row.stored === true || row.stored === 1 || row.stored === "true" }));
const applied = async (snapshotId: string) => { const result = await s.imports.apply.apply(fixtureCaller(), snapshotId); if (result.kind !== "APPLIED") throw Error("fixture"); return result; };

it("marks stored images on Apply and leaves other assets reference-only", async () => {
  const { snapshotId } = await prepareImageImport(uow, blobs, ws, null, files);
  const { sourceId } = await applied(snapshotId);
  expect(await assetRows(sourceId)).toEqual([
    { path: "empty.png", hash: sha256(new Uint8Array()), stored: false },
    { path: "img/d.png", hash: sha256(png("d")), stored: true },
    { path: "notes.pdf", hash: sha256(png("pdf")), stored: false },
  ]);
});
it("re-syncing an unchanged folder asks for no bytes and plans no asset change", async () => {
  const { sourceId } = await applied((await prepareImageImport(uow, blobs, ws, null, files)).snapshotId);
  const again = await prepareImageImport(uow, blobs, ws, sourceId, files);
  expect(again.assetUploads).toEqual([]);
  const preview = await s.imports.preview.get(fixtureCaller(), again.snapshotId);
  expect(preview.summary.assets).toEqual({ added: 0, updated: 0, removed: 0, unchanged: 3 });
});
it("a source imported before images were stored gets them on its next sync, as an update", async () => {
  const { sourceId } = await applied((await prepareImageImport(uow, null, ws, null, files)).snapshotId);
  expect((await assetRows(sourceId)).every((row) => !row.stored)).toBe(true);
  const next = await prepareImageImport(uow, blobs, ws, sourceId, files);
  expect(next.assetUploads).toEqual(["f1"]);
  expect((await s.imports.preview.get(fixtureCaller(), next.snapshotId)).summary.assets).toEqual({ added: 0, updated: 1, removed: 0, unchanged: 2 });
  await applied(next.snapshotId);
  expect((await assetRows(sourceId)).find((row) => row.path === "img/d.png")!.stored).toBe(true);
});
it("a changed image is uploaded again and replaces the stored hash", async () => {
  const { sourceId } = await applied((await prepareImageImport(uow, blobs, ws, null, files)).snapshotId);
  const changed = files.map((file) => file.path === "img/d.png" ? { path: file.path, bytes: png("d2") } : file);
  const next = await prepareImageImport(uow, blobs, ws, sourceId, changed);
  expect(next.assetUploads).toEqual(["f1"]);
  await applied(next.snapshotId);
  expect((await assetRows(sourceId)).find((row) => row.path === "img/d.png")).toEqual({ path: "img/d.png", hash: sha256(png("d2")), stored: true });
});
