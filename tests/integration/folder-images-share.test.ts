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
import { createSourceFixture, fixtureCaller } from "../fixtures/knowledge";
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

import { ShareLinkNotFoundError } from "@/modules/knowledge/domain/document-share-link";

const v1 = "# Guide\n![d](img/d.png) ![old](img/old.png)";
const v2 = "# Guide\n![d](img/d.png)";
const files = (text: string) => [{ path: "guide.md", text }, { path: "img/d.png", bytes: png("d") }, { path: "img/old.png", bytes: png("old") }, { path: "img/secret.png", bytes: png("secret") }, { path: "notes.pdf", bytes: png("pdf") }];
async function shared(text = v1) {
  const result = await s.imports.apply.apply(fixtureCaller(), (await prepareImageImport(uow, blobs, ws, null, files(text))).snapshotId);
  if (result.kind !== "APPLIED") throw Error("fixture");
  const documentId = String((await pool.query("SELECT document_id FROM source_entries WHERE source_id=? AND source_path='guide.md'", [result.sourceId]))[0].document_id);
  // The view carries the path `/s/<token>`, not the bare token.
  const view = await s.shares.create(fixtureCaller(), { documentId, label: "review" });
  const link = { id: view.id, token: view.path.split("/").pop()! };
  return { sourceId: result.sourceId, documentId, link };
}
const denied = (token: string, src: string) => expect(s.shares.readSharedImage(token, src)).rejects.toBeInstanceOf(ShareLinkNotFoundError);
const views = async (linkId: string) => Number((await pool.query("SELECT COALESCE(SUM(view_count),0) n FROM document_share_link_views WHERE share_link_id=?", [linkId]))[0].n);

it("serves an image the shared revision draws, by any spelling of its path, and counts no view", async () => {
  const { link } = await shared();
  expect(await s.shares.readSharedImage(link.token, "img/d.png")).toMatchObject({ contentHash: sha256(png("d")), contentType: "image/png" });
  expect(await s.shares.readSharedImage(link.token, "./img/d.png")).toMatchObject({ sourcePath: "img/d.png" });
  expect(await s.shares.readSharedImage(link.token, "/img/d.png?x=1")).toMatchObject({ sourcePath: "img/d.png" });
  expect(await views(link.id)).toBe(0);
});
it("refuses an image the revision does not draw, a non-image and a path outside the folder, identically", async () => {
  const { link } = await shared();
  for (const src of ["img/secret.png", "notes.pdf", "../../etc/passwd", "img/absent.png", "https://x.test/a.png", ""]) await denied(link.token, src);
});
it("stops serving an image once the current revision no longer draws it", async () => {
  const { sourceId, link } = await shared();
  expect(await s.shares.readSharedImage(link.token, "img/old.png")).toMatchObject({ sourcePath: "img/old.png" });
  const next = await s.imports.apply.apply(fixtureCaller(), (await prepareImageImport(uow, blobs, ws, sourceId, files(v2))).snapshotId);
  expect(next.kind).toBe("APPLIED");
  await denied(link.token, "img/old.png");
  expect(await s.shares.readSharedImage(link.token, "img/d.png")).toMatchObject({ sourcePath: "img/d.png" });
});
it("refuses everything for a revoked, expired or malformed token and an archived document", async () => {
  const { documentId, link } = await shared();
  await denied("not-a-token", "img/d.png");
  await denied("0199f000-0000-4000-8000-000000000000", "img/d.png");
  await pool.query("UPDATE document_share_links SET created_at=DATE_SUB(NOW(6),INTERVAL 2 DAY), expires_at=DATE_SUB(NOW(6),INTERVAL 1 DAY) WHERE id=?", [link.id]);
  await denied(link.token, "img/d.png");
  await pool.query("UPDATE document_share_links SET created_at=NOW(6), expires_at=DATE_ADD(NOW(6),INTERVAL 1 DAY) WHERE id=?", [link.id]);
  expect(await s.shares.readSharedImage(link.token, "img/d.png")).toBeTruthy();
  await uow.run((repositories) => repositories.documents.updateStatus(documentId, "ARCHIVED", fixtureCaller().identity.id));
  await denied(link.token, "img/d.png");
  await uow.run((repositories) => repositories.documents.updateStatus(documentId, "ACTIVE", fixtureCaller().identity.id));
  await s.shares.revoke(fixtureCaller(), link.id);
  await denied(link.token, "img/d.png");
});
