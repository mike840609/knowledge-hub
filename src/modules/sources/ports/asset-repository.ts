import type { KnowledgeAsset } from "../domain/asset";

export interface AssetRepository {
  insert(asset: KnowledgeAsset): Promise<void>;
  findById(assetId: string): Promise<KnowledgeAsset | null>;
  listBySourceId(sourceId: string): Promise<KnowledgeAsset[]>;
  findByPath(sourceId: string, sourcePath: string): Promise<KnowledgeAsset | null>;
  upsertByPath(asset: KnowledgeAsset): Promise<void>;
  deleteById(assetId: string): Promise<void>;
}
