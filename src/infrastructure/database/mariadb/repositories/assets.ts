import { createHash } from "node:crypto";
import type { KnowledgeAsset } from "@/modules/sources/domain/asset";
import type { AssetRepository } from "@/modules/sources/ports/asset-repository";
import type { QueryConnection, DbRow } from "./shared";
import { asDate, asJsonObject } from "./shared";

function mapAsset(row: DbRow): KnowledgeAsset {
  return {
    id: String(row.id),
    sourceId: String(row.source_id),
    sourcePath: String(row.source_path),
    sourcePathHash: String(row.source_path_hash),
    mimeType: row.mime_type === null ? null : String(row.mime_type),
    contentHash: row.content_hash === null ? null : String(row.content_hash),
    metadata: asJsonObject(row.metadata, "asset metadata"),
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
  };
}
function pathHash(asset: KnowledgeAsset): string {
  return asset.sourcePathHash ?? createHash("sha256").update(asset.sourcePath, "utf8").digest("hex");
}
function updatedAt(asset: KnowledgeAsset): Date {
  return asset.updatedAt ?? asset.createdAt;
}

export class MariaDbAssetRepository implements AssetRepository {
  constructor(private readonly connection: QueryConnection) {}

  async insert(asset: KnowledgeAsset): Promise<void> {
    await this.connection.query(
      "INSERT INTO knowledge_assets (id, source_id, source_path, source_path_hash, mime_type, content_hash, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [asset.id, asset.sourceId, asset.sourcePath, pathHash(asset), asset.mimeType, asset.contentHash, JSON.stringify(asset.metadata), asset.createdAt, updatedAt(asset)],
    );
  }

  async findById(assetId: string): Promise<KnowledgeAsset | null> {
    const rows = await this.connection.query<DbRow[]>("SELECT * FROM knowledge_assets WHERE id = ?", [assetId]);
    return rows[0] ? mapAsset(rows[0]) : null;
  }

  async listBySourceId(sourceId: string): Promise<KnowledgeAsset[]> {
    const rows = await this.connection.query<DbRow[]>("SELECT * FROM knowledge_assets WHERE source_id = ? ORDER BY source_path, id", [sourceId]);
    return rows.map(mapAsset);
  }

  async upsertByPath(asset: KnowledgeAsset): Promise<void> {
    await this.connection.query(
      `INSERT INTO knowledge_assets (id, source_id, source_path, source_path_hash, mime_type, content_hash, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE source_path=VALUES(source_path), mime_type=VALUES(mime_type), content_hash=VALUES(content_hash), metadata=VALUES(metadata), updated_at=VALUES(updated_at)`,
      [asset.id, asset.sourceId, asset.sourcePath, pathHash(asset), asset.mimeType, asset.contentHash, JSON.stringify(asset.metadata), asset.createdAt, updatedAt(asset)],
    );
  }

  async deleteById(assetId: string): Promise<void> {
    await this.connection.query("DELETE FROM knowledge_assets WHERE id = ?", [assetId]);
  }
}
