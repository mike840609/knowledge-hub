import { importError } from "@/modules/sources/domain/import-errors";
import { compareImportText } from "@/modules/sources/domain/import-path";
import type { ImportSnapshot } from "@/modules/sources/domain/import-snapshot";
import { reconcileFolderImport } from "@/modules/sources/domain/import-reconciler";
import type {
  CanonicalImportState,
  FolderImportPlan,
  ImportDiffSummary,
  ImportPreviewChange,
  ReadyImportContent,
} from "@/modules/sources/domain/import-plan";

export type ImportPreview = {
  snapshotId: string;
  state: "READY" | "APPLIED" | "STALE";
  expired: boolean;
  workspaceId: string;
  sourceId: string | null;
  proposedSourceName: string | null;
  basedOnVersion: number | null;
  expiresAt: Date;
  hasBlockers: boolean;
  summary: ImportDiffSummary;
  changes: ImportPreviewChange[];
};

function emptySummary(): ImportDiffSummary {
  return {
    documents: { added: 0, updated: 0, moved: 0, renamed: 0, archived: 0, restored: 0, unchanged: 0 },
    folders: { added: 0, archived: 0, restored: 0 },
    assets: { added: 0, updated: 0, removed: 0, unchanged: 0 },
    warnings: 0,
    blockers: 0,
    affectedDocuments: 0,
    changed: false,
  };
}

export function summarizeImportChanges(changes: readonly ImportPreviewChange[]): ImportDiffSummary {
  const summary = emptySummary();
  for (const change of changes) {
    for (const diagnostic of change.diagnostics) {
      if (diagnostic.severity === "WARNING") summary.warnings += 1;
      else summary.blockers += 1;
    }
    const labels = new Set(change.labels);
    if (change.kind === "DOCUMENT") {
      if (labels.has("ADDED")) summary.documents.added += 1;
      if (labels.has("UPDATED")) summary.documents.updated += 1;
      if (labels.has("MOVED")) summary.documents.moved += 1;
      if (labels.has("RENAMED")) summary.documents.renamed += 1;
      if (labels.has("ARCHIVED")) summary.documents.archived += 1;
      if (labels.has("RESTORED")) summary.documents.restored += 1;
      if (labels.has("UNCHANGED")) summary.documents.unchanged += 1;
      if ([...labels].some((label) => label !== "UNCHANGED")) summary.affectedDocuments += 1;
    } else if (change.kind === "FOLDER") {
      if (labels.has("ADDED")) summary.folders.added += 1;
      if (labels.has("ARCHIVED")) summary.folders.archived += 1;
      if (labels.has("RESTORED")) summary.folders.restored += 1;
    } else {
      if (labels.has("ADDED")) summary.assets.added += 1;
      if (labels.has("UPDATED")) summary.assets.updated += 1;
      if (labels.has("REMOVED")) summary.assets.removed += 1;
      if (labels.has("UNCHANGED")) summary.assets.unchanged += 1;
    }
    if ([...labels].some((label) => label !== "UNCHANGED")) summary.changed = true;
  }
  return summary;
}

function sortChanges(changes: ImportPreviewChange[]): ImportPreviewChange[] {
  return changes.sort((left, right) => compareImportText(left.sourcePath, right.sourcePath) || compareImportText(left.kind, right.kind));
}

export function reconcileImportSnapshot(
  content: ReadyImportContent,
  current: CanonicalImportState,
  extraChanges: ImportPreviewChange[] = [],
): FolderImportPlan {
  const plan = reconcileFolderImport(content, current);
  plan.preview = sortChanges([...plan.preview, ...extraChanges]);
  plan.summary = summarizeImportChanges(plan.preview);
  return plan;
}

export function blockedImportPlan(content: ReadyImportContent, changes: ImportPreviewChange[]): FolderImportPlan {
  const preview = sortChanges([...changes]);
  return {
    planVersion: "phase2:v1",
    sourceBinding: content.sourceBinding,
    folders: { create: [], restore: [], archive: [] },
    documents: { create: [], restore: [], move: [], revise: [], archive: [], updateLocator: [] },
    assets: { upsert: [], remove: [] },
    ordering: [],
    preview,
    summary: summarizeImportChanges(preview),
  };
}

export function previewFromSnapshot(snapshot: ImportSnapshot, now: Date): ImportPreview {
  if (snapshot.state !== "READY" && snapshot.state !== "APPLIED" && snapshot.state !== "STALE") {
    throw importError("IMPORT_SNAPSHOT_NOT_READY", "Import snapshot does not have a persisted Preview.");
  }
  if (!snapshot.plan || !snapshot.summary) {
    throw importError("IMPORT_SNAPSHOT_INVALID", "Import snapshot is missing its persisted plan or summary.");
  }
  return {
    snapshotId: snapshot.id,
    state: snapshot.state,
    expired: snapshot.expiresAt.getTime() <= now.getTime(),
    workspaceId: snapshot.workspaceId,
    sourceId: snapshot.sourceId,
    proposedSourceName: snapshot.proposedSourceName,
    basedOnVersion: snapshot.basedOnVersion,
    expiresAt: snapshot.expiresAt,
    hasBlockers: snapshot.hasBlockers,
    summary: snapshot.summary,
    changes: snapshot.plan.preview,
  };
}