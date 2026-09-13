import type { KnowledgeAsset } from "../domain/asset";

export interface AssetRepository {
  insert(asset: KnowledgeAsset): Promise<void>;
  findById(assetId: string): Promise<KnowledgeAsset | null>;
  listBySourceId(sourceId: string): Promise<KnowledgeAsset[]>;
  upsertByPath(asset: KnowledgeAsset): Promise<void>;
  deleteById(assetId: string): Promise<void>;
}
