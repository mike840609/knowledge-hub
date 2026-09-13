import { DEFAULT_IMPORT_LIMITS, type ImportLimits } from "@/modules/sources/domain/import-limits";

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
  return {
    limits: {
      maxManifestEntries: positiveInt("KM_IMPORT_MAX_MANIFEST_ENTRIES", DEFAULT_IMPORT_LIMITS.maxManifestEntries),
      maxPathBytes: positiveInt("KM_IMPORT_MAX_PATH_BYTES", DEFAULT_IMPORT_LIMITS.maxPathBytes),
      maxMarkdownFileBytes: positiveInt("KM_IMPORT_MAX_MARKDOWN_FILE_BYTES", DEFAULT_IMPORT_LIMITS.maxMarkdownFileBytes),
      maxMarkdownTotalBytes: positiveInt("KM_IMPORT_MAX_MARKDOWN_TOTAL_BYTES", DEFAULT_IMPORT_LIMITS.maxMarkdownTotalBytes),
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