import type { KnowledgeMetadata } from "@/modules/knowledge/domain/content";
import type { ImportDiagnostic } from "./import-diagnostic";

export type RevisionPayload = {
  title: string;
  markdown: string;
  metadata: KnowledgeMetadata;
  contentHash: string;
};

export type ImportPreviewLabel =
  | "ADDED"
  | "UPDATED"
  | "MOVED"
  | "RENAMED"
  | "ARCHIVED"
  | "RESTORED"
  | "UNCHANGED"
  | "REMOVED";

export type ImportPreviewChange = {
  kind: "DOCUMENT" | "FOLDER" | "ASSET";
  sourcePath: string;
  previousPath: string | null;
  labels: ImportPreviewLabel[];
  diagnostics: ImportDiagnostic[];
};

export type ImportDiffSummary = {
  documents: Record<"added" | "updated" | "moved" | "renamed" | "archived" | "restored" | "unchanged", number>;
  folders: Record<"added" | "archived" | "restored", number>;
  assets: Record<"added" | "updated" | "removed" | "unchanged", number>;
  warnings: number;
  blockers: number;
  affectedDocuments: number;
  changed: boolean;
};

export type ReadyImportDocument = {
  sourcePath: string;
  externalId: string | null;
  title: string;
  markdown: string;
  metadata: KnowledgeMetadata;
  revisionContentHash: string;
  reconciliationFingerprint: string;
  diagnostics: ImportDiagnostic[];
};

export type ReadyImportAsset = {
  sourcePath: string;
  sourcePathHash: string;
  contentHash: string;
  mimeType: string | null;
  metadata: Record<string, unknown>;
  diagnostics: ImportDiagnostic[];
};

export type ReadyImportContent = {
  sourceBinding: {
    workspaceId: string;
    sourceId: string | null;
    basedOnVersion: number | null;
  };
  documents: ReadyImportDocument[];
  assets: ReadyImportAsset[];
};

export type CanonicalDocumentState = {
  entryId: string;
  documentId: string;
  treeNodeId: string;
  externalId: string | null;
  sourcePath: string;
  status: "ACTIVE" | "ARCHIVED";
  currentRevision: {
    id: string;
    title: string;
    markdown: string;
    metadata: KnowledgeMetadata;
    contentHash: string;
  };
  reconciliationFingerprint: string;
};

export type CanonicalFolderState = {
  entryId: string;
  treeNodeId: string;
  sourcePath: string;
  status: "ACTIVE" | "ARCHIVED";
};

export type CanonicalAssetState = {
  id: string;
  sourcePath: string;
  sourcePathHash: string;
  contentHash: string | null;
  mimeType: string | null;
  metadata: Record<string, unknown>;
};

export type CanonicalImportState = {
  documents: CanonicalDocumentState[];
  folders: CanonicalFolderState[];
  assets: CanonicalAssetState[];
};

export type FolderImportPlan = {
  planVersion: "phase2:v1";
  sourceBinding: ReadyImportContent["sourceBinding"];
  folders: {
    create: { sourcePath: string; parentPath: string | null; name: string; desiredPosition: number }[];
    restore: { entryId: string; treeNodeId: string; sourcePath: string }[];
    archive: { entryId: string; treeNodeId: string; sourcePath: string }[];
  };
  documents: {
    create: {
      sourcePath: string;
      parentPath: string | null;
      desiredPosition: number;
      externalId: string | null;
      content: RevisionPayload;
    }[];
    restore: { entryId: string; documentId: string; treeNodeId: string }[];
    move: {
      entryId: string;
      treeNodeId: string;
      fromPath: string;
      toPath: string;
      parentPath: string | null;
      desiredPosition: number;
    }[];
    revise: {
      entryId: string;
      documentId: string;
      expectedCurrentRevisionId: string;
      content: RevisionPayload;
    }[];
    archive: { entryId: string; documentId: string; treeNodeId: string; sourcePath: string }[];
    updateLocator: { entryId: string; sourcePath: string; contentHash: string }[];
  };
  assets: {
    upsert: {
      sourcePath: string;
      sourcePathHash: string;
      mimeType: string | null;
      contentHash: string;
      metadata: Record<string, unknown>;
    }[];
    remove: { assetId: string; sourcePath: string }[];
  };
  ordering: { nodeKey: string; parentPath: string | null; position: number }[];
  preview: ImportPreviewChange[];
  summary: ImportDiffSummary;
};
