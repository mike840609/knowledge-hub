export type ImportLimits = {
  maxManifestEntries: number;
  maxPathBytes: number;
  maxMarkdownFileBytes: number;
  maxMarkdownTotalBytes: number;
  maxAssetFileBytes: number;
  maxAssetTotalBytes: number;
  maxMetadataBytes: number;
  maxUploadBatchFiles: number;
  maxUploadBatchBytes: number;
  maxBuildingSnapshotsPerUser: number;
  maxReadySnapshotsPerUser: number;
};

export const DEFAULT_IMPORT_LIMITS: ImportLimits = {
  maxManifestEntries: 20_000,
  maxPathBytes: 2 * 1024,
  maxMarkdownFileBytes: 3.5 * 1024 * 1024,
  maxMarkdownTotalBytes: 256 * 1024 * 1024,
  maxAssetFileBytes: 64 * 1024 * 1024,
  maxAssetTotalBytes: 512 * 1024 * 1024,
  maxMetadataBytes: 256 * 1024,
  maxUploadBatchFiles: 20,
  maxUploadBatchBytes: 10 * 1024 * 1024,
  maxBuildingSnapshotsPerUser: 3,
  maxReadySnapshotsPerUser: 10,
};

/** A byte limit as the person reading a refusal sees it: "3.5 MiB". */
export function formatLimitBytes(bytes: number): string {
  return `${Math.round((bytes / 1024 / 1024) * 10) / 10} MiB`;
}

/** The refusal of one Markdown file, by name, so the writer knows which file to split. */
export function markdownFileTooLargeMessage(path: string | null, limit: number): string {
  return `${path ? `"${path}"` : "A Markdown file"} is larger than the ${formatLimitBytes(limit)} one Markdown file may hold. Split it, then import again.`;
}
