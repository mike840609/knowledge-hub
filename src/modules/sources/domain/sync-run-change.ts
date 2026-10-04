import type { ImportPreviewLabel } from "./import-plan";
import type { ImportDiagnostic } from "./import-diagnostic";
export type SyncRunChangeDraft = {
  kind: "DOCUMENT" | "FOLDER" | "ASSET";
  labels: ImportPreviewLabel[];
  sourcePath: string;
  previousPath: string | null;
  title: string;
  documentId: string | null;
  beforeRevisionId: string | null;
  afterRevisionId: string | null;
  beforeRevisionNo: number | null;
  afterRevisionNo: number | null;
  diagnostics: ImportDiagnostic[];
};
export type SyncRunChange = SyncRunChangeDraft & {
  id: string;
  runId: string;
  sourceId: string;
  workspaceId: string;
  ordinal: number;
};
export type RunCursor = { completedAt: string; runId: string };
