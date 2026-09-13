import { createHash } from "node:crypto";
import type { FolderImportPlan } from "./import-plan";
import { compareImportText } from "./import-path";
import type { ImportSnapshot, ImportSnapshotEntry } from "./import-snapshot";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hashableEntry(entry: ImportSnapshotEntry): unknown {
  return {
    uploadKey: entry.uploadKey,
    clientRelativePath: entry.clientRelativePath,
    sourcePath: entry.sourcePath,
    sourcePathHash: entry.sourcePathHash,
    entryType: entry.entryType,
    sourceFileHash: entry.sourceFileHash,
    resolvedTitle: entry.resolvedTitle,
    titleSource: entry.titleSource,
    markdown: entry.markdown,
    metadata: entry.metadata,
    revisionContentHash: entry.revisionContentHash,
    reconciliationFingerprint: entry.reconciliationFingerprint,
    mimeType: entry.mimeType,
    assetContentHash: entry.assetContentHash,
    assetSize: entry.assetSize,
    assetLastModified: entry.assetLastModified?.toISOString() ?? null,
    diagnostics: entry.diagnostics,
  };
}

export function hashImportPlan(plan: FolderImportPlan): string {
  return sha256(JSON.stringify(plan));
}

export function hashReadyImportSnapshot(
  snapshot: Pick<ImportSnapshot, "adapterVersion" | "workspaceId" | "sourceId" | "basedOnVersion">,
  entries: readonly ImportSnapshotEntry[],
): string {
  const orderedEntries = [...entries].sort(
    (left, right) =>
      compareImportText(left.sourcePath ?? left.clientRelativePath, right.sourcePath ?? right.clientRelativePath) ||
      compareImportText(left.uploadKey, right.uploadKey),
  );
  return sha256(JSON.stringify({
    adapterVersion: snapshot.adapterVersion,
    sourceBinding: {
      workspaceId: snapshot.workspaceId,
      sourceId: snapshot.sourceId,
      basedOnVersion: snapshot.basedOnVersion,
    },
    entries: orderedEntries.map(hashableEntry),
  }));
}
