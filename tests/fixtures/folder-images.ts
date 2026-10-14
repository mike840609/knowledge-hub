import { createHash } from "node:crypto";
import type { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { CreateFolderImportService } from "@/modules/sources/application/create-folder-import";
import { FinalizeFolderImportService } from "@/modules/sources/application/finalize-folder-import";
import { UploadFolderImportAssetService } from "@/modules/sources/application/upload-folder-import-asset";
import { UploadFolderImportEntriesService } from "@/modules/sources/application/upload-folder-import-entries";
import type { BlobStore } from "@/modules/sources/ports/blob-store";
import { fixtureCaller } from "./knowledge";

export type FixtureFile = { path: string; text: string } | { path: string; bytes: Uint8Array };
export const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export const png = (seed: string) => new TextEncoder().encode(`png:${seed}`);
export const stream = (bytes: Uint8Array) => new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close(); } });

/** Creates a snapshot. `upload: false` stops before any image is sent. Returns the snapshot and what the server asked for. */
export async function stageImageImport(uow: MariaDbUnitOfWork, blobs: BlobStore | null, workspaceId: string, sourceId: string | null, files: FixtureFile[], caller = fixtureCaller()) {
  const entries = files.map((file, index) => ({ key: `f${index}`, path: file.path, bytes: "text" in file ? new TextEncoder().encode(file.text) : file.bytes, markdown: "text" in file }));
  const manifest = entries.map((entry) => entry.markdown
    ? { uploadKey: entry.key, relativePath: entry.path, kind: "MARKDOWN" as const, size: entry.bytes.byteLength }
    : { uploadKey: entry.key, relativePath: entry.path, kind: "ASSET" as const, size: entry.bytes.byteLength, contentHash: sha256(entry.bytes), mimeType: null, lastModified: null });
  const create = new CreateFolderImportService(uow, { storeImages: blobs !== null });
  const session = sourceId
    ? await create.createResync(caller, { sourceId, rootName: "images", manifest })
    : await create.createInitial(caller, { workspaceId, sourceName: "Images", rootName: "images", manifest });
  const markdown = entries.filter((entry) => entry.markdown);
  if (markdown.length) await new UploadFolderImportEntriesService(uow).upload(caller, { snapshotId: session.snapshotId, entries: markdown.map((entry) => ({ uploadKey: entry.key, bytes: entry.bytes })) });
  return { snapshotId: session.snapshotId, assetUploads: session.assetUploads, entries };
}

export async function prepareImageImport(uow: MariaDbUnitOfWork, blobs: BlobStore | null, workspaceId: string, sourceId: string | null, files: FixtureFile[]) {
  const staged = await stageImageImport(uow, blobs, workspaceId, sourceId, files);
  if (blobs) {
    const upload = new UploadFolderImportAssetService(uow, blobs);
    for (const key of staged.assetUploads) {
      const entry = staged.entries.find((candidate) => candidate.key === key)!;
      await upload.upload(fixtureCaller(), { snapshotId: staged.snapshotId, uploadKey: key, body: stream(entry.bytes), contentLength: entry.bytes.byteLength });
    }
  }
  await new FinalizeFolderImportService(uow).finalize(fixtureCaller(), staged.snapshotId);
  return staged;
}
