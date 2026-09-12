import type { KnowledgeMetadata } from "@/modules/knowledge/domain/content";
import type { ImportDiagnostic } from "./import-diagnostic";
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
