import type { MigrationReadConnection } from "./migrations/types";
import { normalizeImportPath } from "@/modules/sources/domain/import-path";

export async function assertAssetProjectionReady(connection: MigrationReadConnection): Promise<void> {
  const rows = await connection.query<{ id: unknown; source_id: unknown; source_path: unknown }[]>(
    "SELECT id, source_id, source_path FROM knowledge_assets ORDER BY source_id, id",
  );
  const seen = new Set<string>();
  for (const row of rows) {
    const sourceId = String(row.source_id);
    const storedPath = String(row.source_path);
    const normalized = normalizeImportPath(storedPath);
    if (normalized.sourcePath !== storedPath) {
      throw new Error(`Asset projection migration refused: asset ${String(row.id)} has a non-canonical source_path.`);
    }
    const key = `${sourceId}\0${normalized.sourcePath}`;
    if (seen.has(key)) {
      throw new Error(`Asset projection migration refused: duplicate normalized asset path ${storedPath}.`);
    }
    seen.add(key);
  }
}
