import type { CallerContext } from "@/modules/identity/domain/caller-context";
import { lockWorkspaceForMutation } from "@/modules/workspaces/application/workspace-mutation-guard";
import { importError } from "@/modules/sources/domain/import-errors";
import { BlobMismatchError, type BlobBody, type BlobStore } from "@/modules/sources/ports/blob-store";
import type { SourceRepositories, SourceUnitOfWork } from "@/modules/sources/ports/unit-of-work";
import { imageContentType } from "@/shared/markdown/image-path";
import { translateKnownSnapshotAccessError } from "./import-snapshot-access";

type Input = { snapshotId: string; uploadKey: string; body: BlobBody; contentLength: number };
type Pending = { entryId: string; hash: string; size: number };

export class UploadFolderImportAssetService {
  private readonly now: () => Date;
  constructor(private readonly uow: SourceUnitOfWork, private readonly blobs: BlobStore, options: { now?: () => Date } = {}) {
    this.now = options.now ?? (() => new Date());
  }

  /**
   * Stores one image of a BUILDING snapshot. The bytes are always read and
   * hashed, even when the store already holds that hash: another workspace
   * having the file is not this caller's proof of having it.
   */
  async upload(caller: CallerContext, input: Input): Promise<{ accepted: boolean }> {
    const pending = await this.uow.run((repositories) => this.pending(repositories, caller, input));
    if (!pending) return { accepted: false };
    if (input.contentLength !== pending.size) throw importError("UPLOAD_SIZE_MISMATCH", "Uploaded image size does not match the manifest declaration.");
    try {
      // Outside any transaction: a 64 MiB upload must not hold the snapshot's row lock.
      await this.blobs.put(pending.hash, input.body, pending.size);
    } catch (error) {
      if (error instanceof BlobMismatchError) throw importError("UPLOAD_SIZE_MISMATCH", "Uploaded image does not match the manifest declaration.");
      throw error;
    }
    await this.uow.run(async (repositories) => {
      // Re-checked: the snapshot may have been abandoned or expired while the bytes arrived.
      const still = await this.pending(repositories, caller, input);
      if (still) await repositories.importSnapshotEntries.markAssetReceived(still.entryId, pending.hash);
    });
    return { accepted: true };
  }

  private async pending(repositories: SourceRepositories, caller: CallerContext, input: Input): Promise<Pending | null> {
    const snapshot = await repositories.importSnapshots.lockById(input.snapshotId);
    if (!snapshot || snapshot.createdBy !== caller.identity.id) throw importError("IMPORT_SNAPSHOT_NOT_FOUND", "Import snapshot was not found.");
    try {
      await lockWorkspaceForMutation(repositories, caller, snapshot.workspaceId, "source-import");
    } catch (error) {
      throw translateKnownSnapshotAccessError(error);
    }
    if (snapshot.state !== "BUILDING") throw importError("IMPORT_SNAPSHOT_NOT_BUILDING", "Only BUILDING snapshots accept uploads.");
    if (snapshot.expiresAt.getTime() <= this.now().getTime()) throw importError("IMPORT_SNAPSHOT_EXPIRED", "Import snapshot has expired.");
    const staged = await repositories.importSnapshotEntries.findByUploadKey(snapshot.id, input.uploadKey);
    if (!staged || staged.entryType !== "ASSET" || staged.assetContentHash === null || imageContentType(staged.clientRelativePath) === null) {
      throw importError("UPLOAD_ENTRY_NOT_FOUND", "Upload key does not identify an image manifest entry.");
    }
    if (staged.uploadStatus === "RECEIVED") {
      // Received without proof is a non-stored asset (empty file, or staged while the store was off).
      if (staged.sourceFileHash === null) throw importError("UPLOAD_ENTRY_NOT_FOUND", "Upload key does not identify an image manifest entry.");
      return null;
    }
    return { entryId: staged.id, hash: staged.assetContentHash, size: staged.declaredSize };
  }
}
