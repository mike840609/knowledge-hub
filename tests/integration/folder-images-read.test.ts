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
import { buildApplicationServices } from "@/server/composition";
import { createSourceFixture, fixtureCaller, secondFixtureIdentity } from "../fixtures/knowledge";
import { png, prepareImageImport, sha256 } from "../fixtures/folder-images";

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

const md = "# Guide\n![d](img/d.png) ![up](../shared.svg) ![root](/img/d.png)";
const files = [{ path: "guides/guide.md", text: md }, { path: "guides/img/d.png", bytes: png("d") }, { path: "shared.svg", bytes: png("svg") }, { path: "img/d.png", bytes: png("root") }, { path: "guides/notes.pdf", bytes: png("pdf") }];
async function imported() {
  const result = await s.imports.apply.apply(fixtureCaller(), (await prepareImageImport(uow, blobs, ws, null, files)).snapshotId);
  if (result.kind !== "APPLIED") throw Error("fixture");
  const documentId = String((await pool.query("SELECT document_id FROM source_entries WHERE source_id=? AND source_path='guides/guide.md'", [result.sourceId]))[0].document_id);
  return { sourceId: result.sourceId, documentId };
}

it("finds an image as the document writes it: relative, parent and root paths", async () => {
  const { documentId } = await imported();
  const find = (src: string) => s.documentImages.find(fixtureCaller(), documentId, src);
  expect(await find("img/d.png")).toEqual({ contentHash: sha256(png("d")), contentType: "image/png", sourcePath: "guides/img/d.png", documentPath: "guides/guide.md" });
  expect((await find("../shared.svg"))!.contentType).toBe("image/svg+xml");
  expect((await find("/img/d.png"))!.contentHash).toBe(sha256(png("root")));
  expect((await find("img/d.png?v=2"))!.sourcePath).toBe("guides/img/d.png");
});
it("finds nothing for a missing file, a non-image, a path outside the root or a URL", async () => {
  const { documentId } = await imported();
  for (const src of ["img/absent.png", "notes.pdf", "../../etc/passwd", "https://x.test/a.png", ""]) expect(await s.documentImages.find(fixtureCaller(), documentId, src), src).toBeNull();
});
it("does not reach an image in another source through this document", async () => {
  const { documentId } = await imported();
  const other = await s.imports.apply.apply(fixtureCaller(), (await prepareImageImport(uow, blobs, ws, null, [{ path: "o.md", text: "# O" }, { path: "only-here.png", bytes: png("other") }])).snapshotId);
  expect(other.kind).toBe("APPLIED");
  expect(await s.documentImages.find(fixtureCaller(), documentId, "/only-here.png")).toBeNull();
});
it("denies a caller who cannot read the document exactly as the document read does", async () => {
  const { documentId } = await imported();
  const outsider = fixtureCaller(secondFixtureIdentity);
  await pool.query("DELETE FROM workspace_memberships WHERE workspace_id=? AND user_id=?", [ws, secondFixtureIdentity.id]);
  const documentError = await s.queries.getDocument(outsider, documentId).catch((error: Error) => error.constructor.name);
  const imageError = await s.documentImages.find(outsider, documentId, "img/d.png").catch((error: Error) => error.constructor.name);
  expect(typeof documentError).toBe("string");
  expect(imageError).toBe(documentError);
  await expect(s.documentImages.find(fixtureCaller(), "0199f000-0000-7000-8000-00000000dead", "img/d.png")).rejects.toThrow();
});
it("finds nothing once an image is no longer stored", async () => {
  const { sourceId, documentId } = await imported();
  await pool.query("UPDATE knowledge_assets SET metadata=JSON_REMOVE(metadata,'$.stored') WHERE source_id=?", [sourceId]);
  expect(await s.documentImages.find(fixtureCaller(), documentId, "img/d.png")).toBeNull();
});
