import type { KnowledgeAsset } from "../domain/asset";

export interface AssetRepository {
  insert(asset: KnowledgeAsset): Promise<void>;
  findById(assetId: string): Promise<KnowledgeAsset | null>;
  listBySourceId(sourceId: string): Promise<KnowledgeAsset[]>;
  findByPath(sourceId: string, sourcePath: string): Promise<KnowledgeAsset | null>;
  upsertByPath(asset: KnowledgeAsset): Promise<void>;
  deleteById(assetId: string): Promise<void>;
  /** Every asset row whose bytes are claimed to be in the blob store. */
  listStored(): Promise<KnowledgeAsset[]>;
  /** Forget that an asset's bytes are stored, so its next sync uploads them again. */
  clearStored(assetId: string): Promise<void>;
}
