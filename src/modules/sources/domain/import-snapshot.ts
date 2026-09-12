import type { KnowledgeMetadata } from "@/modules/knowledge/domain/content";
import type { ImportDiagnostic } from "./import-diagnostic";
import type { ImportDiffSummary, FolderImportPlan, ImportPreviewChange } from "./import-plan";
import type { ImportTitleSource } from "./import-title";

export type ImportSnapshotState = "BUILDING" | "READY" | "APPLIED" | "STALE";
export type ImportEntryType = "DOCUMENT" | "ASSET";
export type ImportUploadStatus = "PENDING" | "RECEIVED";

export type ParsedMarkdownEntry = {
  sourcePath: string;
  externalId: null;
  resolvedTitle: string;
  titleSource: ImportTitleSource;
  markdown: string;
  metadata: KnowledgeMetadata;
  revisionContentHash: string;
  reconciliationFingerprint: string;
  sourceFileHash: string;
  diagnostics: ImportDiagnostic[];
};

export type ImportSnapshot = {
  id: string;
  workspaceId: string;
  sourceId: string | null;
  basedOnVersion: number | null;
  createdBy: string;
  rootName: string;
  proposedSourceName: string | null;
  adapterType: "GENERIC_MARKDOWN_FOLDER";
  adapterVersion: "phase2:v1";
  planVersion: "phase2:v1";
  state: ImportSnapshotState;
  manifestHash: string;
  snapshotHash: string | null;
  planHash: string | null;
  hasBlockers: boolean;
  summary: ImportDiffSummary | null;
  plan: FolderImportPlan | null;
  createdAt: Date;
  finalizedAt: Date | null;
  expiresAt: Date;
  appliedAt: Date | null;
  staleAt: Date | null;
  resultSourceId: string | null;
  resultVersion: number | null;
};

export type ImportSnapshotEntry = {
  id: string;
  snapshotId: string;
  uploadKey: string;
  clientRelativePath: string;
  sourcePath: string | null;
  sourcePathHash: string | null;
  entryType: ImportEntryType;
  uploadStatus: ImportUploadStatus;
  declaredSize: number;
  sourceFileHash: string | null;
  rawMarkdown: string | null;
  resolvedTitle: string | null;
  titleSource: ImportTitleSource | null;
  markdown: string | null;
  metadata: KnowledgeMetadata | null;
  revisionContentHash: string | null;
  reconciliationFingerprint: string | null;
  mimeType: string | null;
  assetContentHash: string | null;
  assetSize: number | null;
  assetLastModified: Date | null;
  diagnostics: ImportDiagnostic[];
  previewChange: ImportPreviewChange | null;
};

export type FinalizedImportSnapshotEntry = ImportSnapshotEntry & {
  uploadStatus: "RECEIVED";
  rawMarkdown: null;
};
