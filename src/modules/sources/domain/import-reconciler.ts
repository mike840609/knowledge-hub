import { canonicalizeJsonObject, isSameRevisionContent } from "@/modules/knowledge/domain/content";
import { importError } from "./import-errors";
import { compareImportText } from "./import-path";
import type { ImportDiagnostic } from "./import-diagnostic";
import type {
  CanonicalAssetState,
  CanonicalDocumentState,
  CanonicalFolderState,
  CanonicalImportState,
  FolderImportPlan,
  ImportDiffSummary,
  ImportPreviewChange,
  ReadyImportAsset,
  ReadyImportContent,
  ReadyImportDocument,
  RevisionPayload,
} from "./import-plan";

function parentPath(path: string): string | null {
  const index = path.lastIndexOf("/");
  return index < 0 ? null : path.slice(0, index);
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function depth(path: string): number {
  return path.split("/").length;
}

function compareDepthThenPath(left: string, right: string): number {
  return depth(left) - depth(right) || compareImportText(left, right);
}

function compareDepthDescendingThenPath(left: string, right: string): number {
  return depth(right) - depth(left) || compareImportText(left, right);
}

function revisionPayload(document: ReadyImportDocument): RevisionPayload {
  return {
    title: document.title,
    markdown: document.markdown,
    metadata: document.metadata,
    contentHash: document.revisionContentHash,
  };
}

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

function emptyPlan(sourceBinding: ReadyImportContent["sourceBinding"]): FolderImportPlan {
  return {
    planVersion: "phase2:v1",
    sourceBinding,
    folders: { create: [], restore: [], archive: [] },
    documents: { create: [], restore: [], move: [], revise: [], archive: [], updateLocator: [] },
    assets: { upsert: [], remove: [] },
    ordering: [],
    preview: [],
    summary: emptySummary(),
  };
}

function deriveRequiredFolders(snapshot: ReadyImportContent): string[] {
  const folders = new Set<string>();
  for (const entry of [...snapshot.documents, ...snapshot.assets]) {
    let parent = parentPath(entry.sourcePath);
    while (parent !== null) {
      folders.add(parent);
      parent = parentPath(parent);
    }
  }
  return [...folders].sort(compareDepthThenPath);
}

function reconcileFolders(
  plan: FolderImportPlan,
  desiredFolders: string[],
  currentFolders: CanonicalFolderState[],
): Map<string, CanonicalFolderState> {
  const currentByPath = new Map(currentFolders.map((folder) => [folder.sourcePath, folder]));
  const desired = new Set(desiredFolders);

  for (const sourcePath of desiredFolders) {
    const current = currentByPath.get(sourcePath);
    if (!current) {
      plan.folders.create.push({
        sourcePath,
        parentPath: parentPath(sourcePath),
        name: basename(sourcePath),
        desiredPosition: 0,
      });
      plan.preview.push({ kind: "FOLDER", sourcePath, previousPath: null, labels: ["ADDED"], diagnostics: [] });
      continue;
    }
    if (current.status === "ARCHIVED") {
      plan.folders.restore.push({ entryId: current.entryId, treeNodeId: current.treeNodeId, sourcePath });
      plan.preview.push({ kind: "FOLDER", sourcePath, previousPath: null, labels: ["RESTORED"], diagnostics: [] });
    }
  }

  for (const current of [...currentFolders].sort((left, right) => compareDepthDescendingThenPath(left.sourcePath, right.sourcePath))) {
    if (current.status === "ACTIVE" && !desired.has(current.sourcePath)) {
      plan.folders.archive.push({ entryId: current.entryId, treeNodeId: current.treeNodeId, sourcePath: current.sourcePath });
      plan.preview.push({ kind: "FOLDER", sourcePath: current.sourcePath, previousPath: null, labels: ["ARCHIVED"], diagnostics: [] });
    }
  }

  return currentByPath;
}

function buildDocumentMatches(
  incomingDocuments: ReadyImportDocument[],
  currentDocuments: CanonicalDocumentState[],
): {
  matches: Map<string, CanonicalDocumentState>;
  ambiguous: Map<string, string[]>;
  unmatchedCurrentIds: Set<string>;
} {
  const currentSorted = [...currentDocuments].sort((left, right) => compareImportText(left.sourcePath, right.sourcePath));
  const incomingSorted = [...incomingDocuments].sort((left, right) => compareImportText(left.sourcePath, right.sourcePath));
  const byExternalId = new Map<string, CanonicalDocumentState>();
  const byPath = new Map(currentSorted.map((document) => [document.sourcePath, document]));
  const byFingerprint = new Map<string, CanonicalDocumentState[]>();
  const unmatchedCurrentIds = new Set(currentSorted.map((document) => document.entryId));
  const matches = new Map<string, CanonicalDocumentState>();
  const ambiguous = new Map<string, string[]>();

  for (const current of currentSorted) {
    if (current.externalId !== null) {
      const previous = byExternalId.get(current.externalId);
      if (previous && previous.entryId !== current.entryId) {
        throw importError("IDENTITY_CONFLICT", "Canonical source contains duplicate external identities.");
      }
      byExternalId.set(current.externalId, current);
    }
    const candidates = byFingerprint.get(current.reconciliationFingerprint) ?? [];
    candidates.push(current);
    byFingerprint.set(current.reconciliationFingerprint, candidates);
  }

  const incomingExternalIds = new Set<string>();
  for (const incoming of incomingSorted) {
    if (incoming.externalId === null) continue;
    if (incomingExternalIds.has(incoming.externalId)) {
      throw importError("IDENTITY_CONFLICT", "Import snapshot contains duplicate external identities.");
    }
    incomingExternalIds.add(incoming.externalId);
  }

  // Pass 1: stable external identity. Check path contradiction before matching.
  for (const incoming of incomingSorted) {
    if (incoming.externalId === null) continue;
    const external = byExternalId.get(incoming.externalId);
    const path = byPath.get(incoming.sourcePath);
    if (external && path && external.entryId !== path.entryId) {
      throw importError("IDENTITY_CONFLICT", "External identity and source path resolve to different documents.");
    }
    if (external && unmatchedCurrentIds.has(external.entryId)) {
      matches.set(incoming.sourcePath, external);
      unmatchedCurrentIds.delete(external.entryId);
    }
  }

  // Pass 2: exact path for every still-unmatched incoming document.
  for (const incoming of incomingSorted) {
    if (matches.has(incoming.sourcePath)) continue;
    const exact = byPath.get(incoming.sourcePath);
    if (exact && unmatchedCurrentIds.has(exact.entryId)) {
      matches.set(incoming.sourcePath, exact);
      unmatchedCurrentIds.delete(exact.entryId);
    }
  }

  // Pass 3: unique reconciliation fingerprint, unambiguous on BOTH sides (design §9.1).
  //
  // Identity may be reused only when exactly one unmatched canonical document and
  // exactly one unmatched incoming document share a fingerprint. Two canonical
  // candidates make the predecessor a guess; two incoming claimants make the
  // successor a guess — both are the same coin flip over stable knowledge
  // identity, so both stay ADDED, the canonical entries follow the normal
  // snapshot-absence path (ARCHIVED), and every claimant carries the warning.
  //
  // Only documents still unmatched after pass 1 (external id) and pass 2 (exact
  // path) count as claimants; a stronger claim never contributes ambiguity.
  const claimantsByFingerprint = new Map<string, number>();
  for (const incoming of incomingSorted) {
    if (matches.has(incoming.sourcePath)) continue;
    const fingerprint = incoming.reconciliationFingerprint;
    claimantsByFingerprint.set(fingerprint, (claimantsByFingerprint.get(fingerprint) ?? 0) + 1);
  }

  for (const incoming of incomingSorted) {
    if (matches.has(incoming.sourcePath)) continue;
    const candidates = (byFingerprint.get(incoming.reconciliationFingerprint) ?? [])
      .filter((candidate) => unmatchedCurrentIds.has(candidate.entryId))
      .sort((left, right) => compareImportText(left.sourcePath, right.sourcePath));
    if (candidates.length === 0) continue;
    if (candidates.length === 1 && claimantsByFingerprint.get(incoming.reconciliationFingerprint) === 1) {
      const candidate = candidates[0];
      matches.set(incoming.sourcePath, candidate);
      unmatchedCurrentIds.delete(candidate.entryId);
      continue;
    }
    ambiguous.set(incoming.sourcePath, candidates.map((candidate) => candidate.sourcePath));
  }

  return { matches, ambiguous, unmatchedCurrentIds };
}

function reconcileDocuments(
  plan: FolderImportPlan,
  incomingDocuments: ReadyImportDocument[],
  currentDocuments: CanonicalDocumentState[],
): Map<string, CanonicalDocumentState> {
  const { matches, ambiguous, unmatchedCurrentIds } = buildDocumentMatches(incomingDocuments, currentDocuments);

  for (const incoming of [...incomingDocuments].sort((left, right) => compareImportText(left.sourcePath, right.sourcePath))) {
    const existing = matches.get(incoming.sourcePath);
    const ambiguity = ambiguous.get(incoming.sourcePath);
    const diagnostics = [...incoming.diagnostics];
    if (ambiguity) {
      diagnostics.push({
        code: "AMBIGUOUS_IDENTITY",
        severity: "WARNING",
        sourcePath: incoming.sourcePath,
        message: "Could not safely determine which existing document this file replaces; a new identity will be created.",
        details: { candidates: ambiguity },
      });
    }

    if (!existing) {
      plan.documents.create.push({
        sourcePath: incoming.sourcePath,
        parentPath: parentPath(incoming.sourcePath),
        desiredPosition: 0,
        externalId: incoming.externalId,
        content: revisionPayload(incoming),
      });
      plan.preview.push({
        kind: "DOCUMENT",
        sourcePath: incoming.sourcePath,
        previousPath: null,
        labels: ["ADDED"],
        diagnostics,
      });
      continue;
    }

    const labels: ImportPreviewChange["labels"] = [];
    const oldParent = parentPath(existing.sourcePath);
    const newParent = parentPath(incoming.sourcePath);
    const pathChanged = existing.sourcePath !== incoming.sourcePath;
    const parentChanged = oldParent !== newParent;
    const filenameChanged = basename(existing.sourcePath) !== basename(incoming.sourcePath);
    const contentChanged = !isSameRevisionContent(existing.currentRevision, {
      title: incoming.title,
      markdown: incoming.markdown,
      metadata: incoming.metadata,
    });

    if (existing.status === "ARCHIVED") {
      plan.documents.restore.push({ entryId: existing.entryId, documentId: existing.documentId, treeNodeId: existing.treeNodeId });
      labels.push("RESTORED");
    }

    if (pathChanged) {
      plan.documents.move.push({
        entryId: existing.entryId,
        treeNodeId: existing.treeNodeId,
        fromPath: existing.sourcePath,
        toPath: incoming.sourcePath,
        parentPath: newParent,
        desiredPosition: 0,
      });
      if (parentChanged) labels.push("MOVED");
      if (filenameChanged) labels.push("RENAMED");
    }

    if (contentChanged) {
      plan.documents.revise.push({
        entryId: existing.entryId,
        documentId: existing.documentId,
        expectedCurrentRevisionId: existing.currentRevision.id,
        content: revisionPayload(incoming),
      });
      labels.push("UPDATED");
    }

    if (pathChanged || existing.currentRevision.contentHash !== incoming.revisionContentHash) {
      plan.documents.updateLocator.push({
        entryId: existing.entryId,
        sourcePath: incoming.sourcePath,
        contentHash: incoming.revisionContentHash,
      });
    }

    if (labels.length === 0) labels.push("UNCHANGED");
    plan.preview.push({
      kind: "DOCUMENT",
      sourcePath: incoming.sourcePath,
      previousPath: pathChanged ? existing.sourcePath : null,
      labels,
      diagnostics,
    });
  }

  for (const existing of [...currentDocuments].sort((left, right) => compareImportText(left.sourcePath, right.sourcePath))) {
    if (!unmatchedCurrentIds.has(existing.entryId) || existing.status !== "ACTIVE") continue;
    plan.documents.archive.push({
      entryId: existing.entryId,
      documentId: existing.documentId,
      treeNodeId: existing.treeNodeId,
      sourcePath: existing.sourcePath,
    });
    plan.preview.push({
      kind: "DOCUMENT",
      sourcePath: existing.sourcePath,
      previousPath: null,
      labels: ["ARCHIVED"],
      diagnostics: [],
    });
  }

  return matches;
}

function canonicalMetadata(metadata: Record<string, unknown>): string {
  return JSON.stringify(canonicalizeJsonObject(metadata));
}

function sameAsset(left: CanonicalAssetState, right: ReadyImportAsset): boolean {
  return (
    left.contentHash === right.contentHash &&
    left.mimeType === right.mimeType &&
    canonicalMetadata(left.metadata) === canonicalMetadata(right.metadata)
  );
}

function reconcileAssets(plan: FolderImportPlan, incomingAssets: ReadyImportAsset[], currentAssets: CanonicalAssetState[]): void {
  const currentByPath = new Map(currentAssets.map((asset) => [asset.sourcePath, asset]));
  const seenPaths = new Set<string>();

  for (const incoming of [...incomingAssets].sort((left, right) => compareImportText(left.sourcePath, right.sourcePath))) {
    seenPaths.add(incoming.sourcePath);
    const existing = currentByPath.get(incoming.sourcePath);
    if (!existing) {
      plan.assets.upsert.push({
        sourcePath: incoming.sourcePath,
        sourcePathHash: incoming.sourcePathHash,
        mimeType: incoming.mimeType,
        contentHash: incoming.contentHash,
        metadata: incoming.metadata,
      });
      plan.preview.push({ kind: "ASSET", sourcePath: incoming.sourcePath, previousPath: null, labels: ["ADDED"], diagnostics: [...incoming.diagnostics] });
      continue;
    }

    if (sameAsset(existing, incoming)) {
      plan.preview.push({ kind: "ASSET", sourcePath: incoming.sourcePath, previousPath: null, labels: ["UNCHANGED"], diagnostics: [...incoming.diagnostics] });
      continue;
    }

    plan.assets.upsert.push({
      sourcePath: incoming.sourcePath,
      sourcePathHash: incoming.sourcePathHash,
      mimeType: incoming.mimeType,
      contentHash: incoming.contentHash,
      metadata: incoming.metadata,
    });
    plan.preview.push({ kind: "ASSET", sourcePath: incoming.sourcePath, previousPath: null, labels: ["UPDATED"], diagnostics: [...incoming.diagnostics] });
  }

  for (const existing of [...currentAssets].sort((left, right) => compareImportText(left.sourcePath, right.sourcePath))) {
    if (seenPaths.has(existing.sourcePath)) continue;
    plan.assets.remove.push({ assetId: existing.id, sourcePath: existing.sourcePath });
    plan.preview.push({ kind: "ASSET", sourcePath: existing.sourcePath, previousPath: null, labels: ["REMOVED"], diagnostics: [] });
  }
}

type DesiredNode = {
  kind: "FOLDER" | "DOCUMENT";
  sourcePath: string;
  parentPath: string | null;
  nodeKey: string;
};

function buildOrdering(
  plan: FolderImportPlan,
  snapshot: ReadyImportContent,
  desiredFolders: string[],
  currentFoldersByPath: Map<string, CanonicalFolderState>,
  documentMatches: Map<string, CanonicalDocumentState>,
): void {
  const nodes: DesiredNode[] = [];

  for (const sourcePath of desiredFolders) {
    const existing = currentFoldersByPath.get(sourcePath);
    nodes.push({
      kind: "FOLDER",
      sourcePath,
      parentPath: parentPath(sourcePath),
      nodeKey: existing ? `tree:${existing.treeNodeId}` : `folder:${sourcePath}`,
    });
  }

  for (const incoming of snapshot.documents) {
    const existing = documentMatches.get(incoming.sourcePath);
    nodes.push({
      kind: "DOCUMENT",
      sourcePath: incoming.sourcePath,
      parentPath: parentPath(incoming.sourcePath),
      nodeKey: existing ? `tree:${existing.treeNodeId}` : `document:${incoming.sourcePath}`,
    });
  }

  const compareNullablePath = (left: string | null, right: string | null): number => {
    if (left === right) return 0;
    if (left === null) return -1;
    if (right === null) return 1;
    return compareImportText(left, right);
  };

  nodes.sort((left, right) => {
    const byParent = compareNullablePath(left.parentPath, right.parentPath);
    if (byParent !== 0) return byParent;
    if (left.kind !== right.kind) return left.kind === "FOLDER" ? -1 : 1;
    return compareImportText(basename(left.sourcePath), basename(right.sourcePath)) || compareImportText(left.sourcePath, right.sourcePath);
  });

  let activeParent: string | null | undefined;
  let position = 0;
  const positionByNodeKey = new Map<string, number>();
  for (const node of nodes) {
    if (activeParent !== node.parentPath) {
      activeParent = node.parentPath;
      position = 0;
    }
    plan.ordering.push({ nodeKey: node.nodeKey, parentPath: node.parentPath, position });
    positionByNodeKey.set(node.nodeKey, position);
    position += 1;
  }

  for (const action of plan.folders.create) {
    action.desiredPosition = positionByNodeKey.get(`folder:${action.sourcePath}`) ?? 0;
  }
  for (const action of plan.documents.create) {
    action.desiredPosition = positionByNodeKey.get(`document:${action.sourcePath}`) ?? 0;
  }
  for (const action of plan.documents.move) {
    action.desiredPosition = positionByNodeKey.get(`tree:${action.treeNodeId}`) ?? 0;
  }
}

function attachPreviewBlocker(plan: FolderImportPlan, kind: ImportPreviewChange["kind"], sourcePath: string, diagnostic: ImportDiagnostic): void {
  const existing = plan.preview.find((change) => change.kind === kind && change.sourcePath === sourcePath);
  if (existing) {
    existing.diagnostics.push(diagnostic);
    return;
  }
  plan.preview.push({ kind, sourcePath, previousPath: null, labels: [], diagnostics: [diagnostic] });
}

/**
 * Cross-entry-type path replacement guard (design §6.1/§9).
 *
 * Canonical `source_entries` rows keep archived history, and the canonical
 * loader rejects any duplicate `source_path` across archived and active rows
 * of any entry type. A file↔folder replacement at the same path would commit
 * exactly such a state (archived DOCUMENT + active FOLDER, or vice versa),
 * which no later sync could load again. Block the replacement at Preview
 * instead of applying a state the loader cannot accept.
 */
function applyCrossTypePathRules(
  plan: FolderImportPlan,
  snapshot: ReadyImportContent,
  current: CanonicalImportState,
  desiredFolders: string[],
): void {
  const currentDocumentPaths = new Set(current.documents.map((document) => document.sourcePath));
  const currentFolderPaths = new Set(current.folders.map((folder) => folder.sourcePath));
  const incomingDocumentPaths = new Set(snapshot.documents.map((document) => document.sourcePath));
  const desiredFolderPaths = new Set(desiredFolders);

  for (const sourcePath of desiredFolders) {
    if (incomingDocumentPaths.has(sourcePath)) {
      const diagnostic: ImportDiagnostic = {
        code: "SOURCE_PATH_TYPE_CONFLICT",
        severity: "BLOCKING",
        sourcePath,
        message: `Source path "${sourcePath}" cannot be both a document and a folder in the same import.`,
      };
      attachPreviewBlocker(plan, "FOLDER", sourcePath, { ...diagnostic });
      attachPreviewBlocker(plan, "DOCUMENT", sourcePath, { ...diagnostic });
      continue;
    }
    if (currentDocumentPaths.has(sourcePath)) {
      const diagnostic: ImportDiagnostic = {
        code: "SOURCE_PATH_TYPE_CONFLICT",
        severity: "BLOCKING",
        sourcePath,
        message: `Source path "${sourcePath}" is a document in the current source and cannot be replaced by a folder in one import.`,
      };
      attachPreviewBlocker(plan, "FOLDER", sourcePath, { ...diagnostic });
      attachPreviewBlocker(plan, "DOCUMENT", sourcePath, { ...diagnostic });
    }
  }

  for (const document of snapshot.documents) {
    if (desiredFolderPaths.has(document.sourcePath) || !currentFolderPaths.has(document.sourcePath)) continue;
    const diagnostic: ImportDiagnostic = {
      code: "SOURCE_PATH_TYPE_CONFLICT",
      severity: "BLOCKING",
      sourcePath: document.sourcePath,
      message: `Source path "${document.sourcePath}" is a folder in the current source and cannot be replaced by a document in one import.`,
    };
    attachPreviewBlocker(plan, "DOCUMENT", document.sourcePath, { ...diagnostic });
    attachPreviewBlocker(plan, "FOLDER", document.sourcePath, { ...diagnostic });
  }
}

/**
 * Materialized folder name guard (design §10/§16).
 *
 * Exact parity with the canonical projection rule
 * (`normalizeFolderName` in `src/modules/knowledge/domain/tree-rules.ts`):
 * the canonical rule is a single check — `name.trim()` must be non-empty —
 * and this guard applies that same single check to every materialized folder
 * basename (`basename(sourcePath).trim().length === 0` → BLOCKING
 * `INVALID_FOLDER_NAME` with its sourcePath). No other name rule exists on
 * the canonical side (no length cap, no charset ban, no `.`/`..` ban at the
 * name layer), so there is nothing further to mirror here. Inputs that could
 * look like additional name rules are rejected earlier and never reach this
 * guard: NUL/controls by path normalization (`INVALID_SOURCE_PATH`),
 * `.`/`..`/empty segments by segment filtering, and `/`-embedding by
 * construction (`basename`). Pinned by the `normalizeFolderName` parity test
 * in `tests/unit/phase2-reconciler.test.ts`.
 */
function applyFolderNameRules(plan: FolderImportPlan, desiredFolders: string[]): void {
  for (const sourcePath of desiredFolders) {
    const name = basename(sourcePath);
    if (name.trim().length > 0) continue;
    attachPreviewBlocker(plan, "FOLDER", sourcePath, {
      code: "INVALID_FOLDER_NAME",
      severity: "BLOCKING",
      sourcePath,
      message: `Folder "${sourcePath}" has an invalid name: folder names must be non-empty after trimming.`,
    });
  }
}

function summarize(plan: FolderImportPlan): void {
  const summary = emptySummary();

  for (const change of plan.preview) {
    for (const diagnostic of change.diagnostics) {
      if (diagnostic.severity === "WARNING") summary.warnings += 1;
      else summary.blockers += 1;
    }

    if (change.kind === "DOCUMENT") {
      const labels = new Set(change.labels);
      if (labels.has("ADDED")) summary.documents.added += 1;
      if (labels.has("UPDATED")) summary.documents.updated += 1;
      if (labels.has("MOVED")) summary.documents.moved += 1;
      if (labels.has("RENAMED")) summary.documents.renamed += 1;
      if (labels.has("ARCHIVED")) summary.documents.archived += 1;
      if (labels.has("RESTORED")) summary.documents.restored += 1;
      if (labels.has("UNCHANGED")) summary.documents.unchanged += 1;
      if ([...labels].some((label) => label !== "UNCHANGED")) summary.affectedDocuments += 1;
    } else if (change.kind === "FOLDER") {
      if (change.labels.includes("ADDED")) summary.folders.added += 1;
      if (change.labels.includes("ARCHIVED")) summary.folders.archived += 1;
      if (change.labels.includes("RESTORED")) summary.folders.restored += 1;
    } else {
      if (change.labels.includes("ADDED")) summary.assets.added += 1;
      if (change.labels.includes("UPDATED")) summary.assets.updated += 1;
      if (change.labels.includes("REMOVED")) summary.assets.removed += 1;
      if (change.labels.includes("UNCHANGED")) summary.assets.unchanged += 1;
    }

    if (change.labels.some((label) => label !== "UNCHANGED")) summary.changed = true;
  }

  plan.summary = summary;
  plan.preview.sort((left, right) => compareImportText(left.sourcePath, right.sourcePath) || compareImportText(left.kind, right.kind));
}

export function reconcileFolderImport(snapshot: ReadyImportContent, current: CanonicalImportState): FolderImportPlan {
  const plan = emptyPlan(snapshot.sourceBinding);
  const desiredFolders = deriveRequiredFolders(snapshot);
  const currentFoldersByPath = reconcileFolders(plan, desiredFolders, current.folders);
  const documentMatches = reconcileDocuments(plan, snapshot.documents, current.documents);
  reconcileAssets(plan, snapshot.assets, current.assets);
  buildOrdering(plan, snapshot, desiredFolders, currentFoldersByPath, documentMatches);
  applyCrossTypePathRules(plan, snapshot, current, desiredFolders);
  applyFolderNameRules(plan, desiredFolders);
  summarize(plan);
  return plan;
}
