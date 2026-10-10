import { isStoredImage } from "@/modules/sources/domain/stored-image";
import type { BlobStore } from "@/modules/sources/ports/blob-store";
import type { SourceUnitOfWork } from "@/modules/sources/ports/unit-of-work";

/** Longer than any staging lifetime (24 h), so a blob uploaded for a preview is never young enough to lose. */
const GRACE_MS = 48 * 60 * 60 * 1000;

export class BlobMaintenanceService {
  constructor(private readonly uow: SourceUnitOfWork, private readonly blobs: BlobStore, private readonly now: () => Date = () => new Date()) {}

  /** Removes blobs that no stored asset and no live snapshot refers to, once they are older than the grace period. */
  async gc(): Promise<{ removed: number }> {
    const cutoff = this.now().getTime() - GRACE_MS;
    const referenced = await this.uow.run(async (repositories) => new Set([
      ...(await repositories.assets.listStored()).map((asset) => asset.contentHash!),
      ...(await repositories.importSnapshotEntries.listActiveAssetHashes()),
    ]));
    let removed = 0;
    for await (const blob of this.blobs.list()) {
      if (blob.modifiedAt.getTime() >= cutoff || referenced.has(blob.sha256)) continue;
      await this.blobs.remove(blob.sha256);
      removed += 1;
    }
    return { removed };
  }

  /** Stored images whose bytes are missing, for example after restoring the database without the volume. */
  async verify(options: { repair?: boolean } = {}): Promise<{ missing: { assetId: string; sourceId: string; sourcePath: string }[] }> {
    const stored = (await this.uow.run((repositories) => repositories.assets.listStored())).filter(isStoredImage);
    const missing = [];
    for (const asset of stored) {
      if (await this.blobs.has(asset.contentHash!)) continue;
      missing.push({ assetId: asset.id, sourceId: asset.sourceId, sourcePath: asset.sourcePath });
      if (options.repair) await this.uow.run((repositories) => repositories.assets.clearStored(asset.id));
    }
    return { missing };
  }
}
