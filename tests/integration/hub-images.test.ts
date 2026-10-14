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
import { MAX_UPLOADED_IMAGE_BYTES } from "@/modules/sources/application/upload-source-image";
import { ShareLinkNotFoundError } from "@/modules/knowledge/domain/document-share-link";
import { buildApplicationServices } from "@/server/composition";
import { createSourceFixture, fixtureCaller, secondFixtureIdentity } from "../fixtures/knowledge";
import { sha256 } from "../fixtures/folder-images";

let pool: Pool, handle: IsolatedDatabaseHandle, uow: MariaDbUnitOfWork, blobs: FilesystemBlobStore, root: string, ws: string, sourceId: string, folderId: string;
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
  const fixture = await createSourceFixture(pool);
  ws = fixture.workspaceId; sourceId = fixture.source.id; folderId = fixture.folderId;
  await pool.query("UPDATE workspaces SET name='My Space',workspace_type='PERSONAL',personal_owner_user_id=? WHERE id=?", [fixtureCaller().identity.id, ws]);
});
afterAll(async () => { await pool?.end(); if (handle) await disposeIsolatedDatabase(handle); await rm(root, { recursive: true, force: true }); });



const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
/** A distinct PNG per seed: bytes after the image data do not change what it is. */
const picture = (seed: string) => new Uint8Array(Buffer.concat([PNG, Buffer.from(seed)]));
const upload = (seed: string, caller = fixtureCaller(), source = sourceId) => s.sourceImages!.upload(caller, { sourceId: source, bytes: picture(seed) });
const note = (markdown: string) => s.hub.createDocument(fixtureCaller(), { sourceId, parentId: folderId, title: "Hub note", markdown, metadata: {} });
const failure = (work: Promise<unknown>) => work.then(() => "resolved", (error: Error) => error.constructor.name);

it("stores an uploaded image as an asset of the Source, named by its content", async () => {
  const bytes = picture("a");
  const first = await upload("a");
  expect(first).toEqual({ src: `/images/${sha256(bytes)}.png`, sourceId });
  expect(await blobs.has(sha256(bytes))).toBe(true);
  expect(await upload("a")).toEqual(first);
  const rows = await pool.query("SELECT source_path, content_hash, metadata FROM knowledge_assets WHERE source_id=?", [sourceId]);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ source_path: `images/${sha256(bytes)}.png`, content_hash: sha256(bytes) });
  expect(typeof rows[0].metadata === "string" ? JSON.parse(rows[0].metadata) : rows[0].metadata).toEqual({ size: bytes.byteLength, stored: true });
});
it("stores an SVG as it was given, and serves it as an SVG", async () => {
  const markup = new TextEncoder().encode('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><script>alert(1)</script><rect width="4" height="4"/></svg>');
  const { src } = await s.sourceImages!.upload(fixtureCaller(), { sourceId, bytes: markup });
  expect(src).toBe(`/images/${sha256(markup)}.svg`);
  expect(await s.documentImages.findInSource(fixtureCaller(), sourceId, src)).toMatchObject({ contentType: "image/svg+xml", contentHash: sha256(markup) });
  // Not rewritten: what is stored is byte for byte what was uploaded.
  expect(new Uint8Array(await new Response((await blobs.open(sha256(markup)))!.body).arrayBuffer())).toEqual(markup);
});
it("refuses what is not an image, is empty or is too large, and stores nothing", async () => {
  const send = (bytes: Uint8Array) => s.sourceImages!.upload(fixtureCaller(), { sourceId, bytes });
  for (const bytes of [new TextEncoder().encode("<!doctype html><html><body><svg></svg></body></html>"), new TextEncoder().encode("%PDF-1.7"), new Uint8Array(), new Uint8Array(MAX_UPLOADED_IMAGE_BYTES + 1)]) {
    await expect(send(bytes)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  }
  expect(Number((await pool.query("SELECT COUNT(*) n FROM knowledge_assets WHERE source_id=?", [sourceId]))[0].n)).toBe(0);
});
it("is allowed exactly where writing a document is", async () => {
  const outsider = fixtureCaller(secondFixtureIdentity);
  await pool.query("DELETE FROM workspace_memberships WHERE workspace_id=? AND user_id=?", [ws, secondFixtureIdentity.id]);
  const write = (caller = fixtureCaller(), source = sourceId) => s.hub.createDocument(caller, { sourceId: source, parentId: null, title: "x", markdown: "x", metadata: {} });
  expect(await failure(upload("o", outsider))).toBe(await failure(write(outsider)));
  expect(await failure(upload("o", outsider))).not.toBe("resolved");
  // A synced Source, in a workspace of its own that the caller also belongs to.
  const managed = (await createSourceFixture(pool, { managed: true })).source.id;
  expect(await failure(upload("m", fixtureCaller(), managed))).toBe("SourceReadOnlyError");
  expect(await failure(upload("n", fixtureCaller(), "0199f000-0000-7000-8000-00000000dead"))).toBe("SourceNotFoundError");
  await pool.query("UPDATE knowledge_sources SET status='ARCHIVED',archived_at=NOW(6),archived_by=? WHERE id=?", [fixtureCaller().identity.id, sourceId]);
  expect(await failure(upload("z"))).toBe(await failure(write()));
  expect(await failure(upload("z"))).toBe("SourceArchivedError");
  expect(Number((await pool.query("SELECT COUNT(*) n FROM knowledge_assets WHERE source_id IN (?,?)", [sourceId, managed]))[0].n)).toBe(0);
});
it("a Hub page reads its images, by either spelling, and every revision keeps the one it was written with", async () => {
  const first = await upload("first"), second = await upload("second");
  const created = await note(`# Hub note\n\n![one](${first.src})`);
  const find = (src: string) => s.documentImages.find(fixtureCaller(), created.documentId, src);
  expect(await find(first.src)).toMatchObject({ contentHash: sha256(picture("first")), contentType: "image/png", sourcePath: first.src.slice(1) });
  expect(await find(first.src.slice(1))).toMatchObject({ contentHash: sha256(picture("first")) });
  expect(await find("/images/" + "0".repeat(64) + ".png")).toBeNull();
  expect(await find("/images/../../etc/passwd")).toBeNull();
  await s.hub.createRevision(fixtureCaller(), { documentId: created.documentId, expectedCurrentRevisionId: created.revisionId, title: "Hub note", markdown: `# Hub note\n\n![two](${second.src})`, metadata: {} });
  // The first revision's Markdown still names the first image, and that image is still there.
  expect((await s.queries.getRevision(fixtureCaller(), created.documentId, 1)).markdown).toContain(first.src);
  expect(await find(first.src)).toMatchObject({ contentHash: sha256(picture("first")) });
  expect(await find(second.src)).toMatchObject({ contentHash: sha256(picture("second")) });
});
it("the editor's route reads a Source's images for whoever may read the Source", async () => {
  const { src } = await upload("editor");
  expect(await s.documentImages.findInSource(fixtureCaller(), sourceId, src)).toMatchObject({ contentHash: sha256(picture("editor")), documentPath: "" });
  expect(await s.documentImages.findInSource(fixtureCaller(), sourceId, "/images/absent.png")).toBeNull();
  const outsider = fixtureCaller(secondFixtureIdentity);
  await pool.query("DELETE FROM workspace_memberships WHERE workspace_id=? AND user_id=?", [ws, secondFixtureIdentity.id]);
  const denied = await failure(s.documentImages.findInSource(outsider, sourceId, src));
  expect(denied).toBe(await failure(s.queries.getSource(outsider, sourceId)));
  expect(denied).not.toBe("resolved");
});
it("a shared page serves an uploaded image its current revision references, and no other", async () => {
  const drawn = await upload("drawn"), spare = await upload("spare");
  const created = await note(`# Hub note\n\n![d](${drawn.src})`);
  const view = await s.shares.create(fixtureCaller(), { documentId: created.documentId, label: "review" });
  const token = view.path.split("/").pop()!;
  expect(await s.shares.readSharedImage(token, drawn.src)).toMatchObject({ contentHash: sha256(picture("drawn")) });
  await expect(s.shares.readSharedImage(token, spare.src)).rejects.toBeInstanceOf(ShareLinkNotFoundError);
});
it("cleanup leaves uploaded images alone, referenced by a page or not", async () => {
  const { src } = await upload("kept");
  const hash = src.slice("/images/".length, -".png".length);
  const old = new Date(Date.now() - 100 * 3600_000);
  await utimes(path.join(root, "sha256", hash.slice(0, 2), hash.slice(2, 4), hash), old, old);
  expect(await new BlobMaintenanceService(uow, blobs).gc()).toEqual({ removed: 0 });
  expect(await blobs.has(hash)).toBe(true);
});
it("there is no upload service when the server stores no images", () => {
  expect(buildApplicationServices(pool, { blobStore: null }).sourceImages).toBeNull();
});
