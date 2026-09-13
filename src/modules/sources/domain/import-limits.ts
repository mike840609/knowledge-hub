export type ImportLimits = {
  maxManifestEntries: number;
  maxPathBytes: number;
  maxMarkdownFileBytes: number;
  maxMarkdownTotalBytes: number;
  maxMetadataBytes: number;
  maxUploadBatchFiles: number;
  maxUploadBatchBytes: number;
  maxBuildingSnapshotsPerUser: number;
  maxReadySnapshotsPerUser: number;
};

export const DEFAULT_IMPORT_LIMITS: ImportLimits = {
  maxManifestEntries: 20_000,
  maxPathBytes: 2 * 1024,
  maxMarkdownFileBytes: 5 * 1024 * 1024,
  maxMarkdownTotalBytes: 256 * 1024 * 1024,
  maxMetadataBytes: 256 * 1024,
  maxUploadBatchFiles: 20,
  maxUploadBatchBytes: 10 * 1024 * 1024,
  maxBuildingSnapshotsPerUser: 3,
  maxReadySnapshotsPerUser: 10,
};
