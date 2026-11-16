import { DEFAULT_IMPORT_LIMITS, type ImportLimits } from "@/modules/sources/domain/import-limits";
import { markdownFileCeiling } from "@/infrastructure/database/mariadb/packet-limit";

function positiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer.`);
  return value;
}

export type ImportRuntimeConfig = {
  limits: ImportLimits;
  buildingTtlMs: number;
  readyTtlMs: number;
  terminalRetentionMs: number;
};

export function importRuntimeConfig(): ImportRuntimeConfig {
  const markdownFileBytes = positiveInt("KM_IMPORT_MAX_MARKDOWN_FILE_BYTES", DEFAULT_IMPORT_LIMITS.maxMarkdownFileBytes);
  return {
    limits: {
      // No larger than the database can store in one write: the file is refused, by name, when it is
      // picked or uploaded, instead of failing the import later. Read on each use, because the
      // server's max_allowed_packet is known only once a connection has asked (packet-limit.ts).
      get maxMarkdownFileBytes() { return Math.min(markdownFileBytes, markdownFileCeiling()); },
      maxManifestEntries: positiveInt("KM_IMPORT_MAX_MANIFEST_ENTRIES", DEFAULT_IMPORT_LIMITS.maxManifestEntries),
      maxPathBytes: positiveInt("KM_IMPORT_MAX_PATH_BYTES", DEFAULT_IMPORT_LIMITS.maxPathBytes),
      maxMarkdownTotalBytes: positiveInt("KM_IMPORT_MAX_MARKDOWN_TOTAL_BYTES", DEFAULT_IMPORT_LIMITS.maxMarkdownTotalBytes),
      maxAssetFileBytes: positiveInt("KM_IMPORT_MAX_ASSET_FILE_BYTES", DEFAULT_IMPORT_LIMITS.maxAssetFileBytes),
      maxAssetTotalBytes: positiveInt("KM_IMPORT_MAX_ASSET_TOTAL_BYTES", DEFAULT_IMPORT_LIMITS.maxAssetTotalBytes),
      maxMetadataBytes: positiveInt("KM_IMPORT_MAX_METADATA_BYTES", DEFAULT_IMPORT_LIMITS.maxMetadataBytes),
      maxUploadBatchFiles: positiveInt("KM_IMPORT_MAX_UPLOAD_BATCH_FILES", DEFAULT_IMPORT_LIMITS.maxUploadBatchFiles),
      maxUploadBatchBytes: positiveInt("KM_IMPORT_MAX_UPLOAD_BATCH_BYTES", DEFAULT_IMPORT_LIMITS.maxUploadBatchBytes),
      maxBuildingSnapshotsPerUser: positiveInt("KM_IMPORT_MAX_BUILDING_PER_USER", DEFAULT_IMPORT_LIMITS.maxBuildingSnapshotsPerUser),
      maxReadySnapshotsPerUser: positiveInt("KM_IMPORT_MAX_READY_PER_USER", DEFAULT_IMPORT_LIMITS.maxReadySnapshotsPerUser),
    },
    buildingTtlMs: 2 * 60 * 60 * 1000,
    readyTtlMs: 30 * 60 * 1000,
    terminalRetentionMs: 24 * 60 * 60 * 1000,
  };
}