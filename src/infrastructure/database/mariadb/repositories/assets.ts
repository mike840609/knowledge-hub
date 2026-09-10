import type { KnowledgeAsset } from "@/modules/sources/domain/asset";
import type { AssetRepository } from "@/modules/sources/ports/asset-repository";
import type { QueryConnection, DbRow } from "./shared";
import { asDate, asJsonObject } from "./shared";

function mapAsset(row: DbRow): KnowledgeAsset {
  return {
    id: String(row.id), sourceId: String(row.source_id), sourcePath: String(row.source_path), mimeType: row.mime_type === null ? null : String(row.mime_type),
    contentHash: row.content_hash === null ? null : String(row.content_hash), metadata: asJsonObject(row.metadata, "asset metadata"), createdAt: asDate(row.created_at),
  };
}

export class MariaDbAssetRepository implements AssetRepository {
  constructor(private readonly connection: QueryConnection) {}

  async insert(asset: KnowledgeAsset): Promise<void> {
    await this.connection.query(
      "INSERT INTO knowledge_assets (id, source_id, source_path, mime_type, content_hash, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [asset.id, asset.sourceId, asset.sourcePath, asset.mimeType, asset.contentHash, JSON.stringify(asset.metadata), asset.createdAt],
    );
  }

  async findById(assetId: string): Promise<KnowledgeAsset | null> {
    const rows = await this.connection.query<DbRow[]>("SELECT * FROM knowledge_assets WHERE id = ?", [assetId]);
    return rows[0] ? mapAsset(rows[0]) : null;
  }
}
