import type { CallerContext } from "@/modules/identity/domain/caller-context";
import { importError } from "@/modules/sources/domain/import-errors";
import type { FolderImportPlan } from "@/modules/sources/domain/import-plan";
import type { KnowledgeSource } from "@/modules/sources/domain/source";
import type { SourceRepositories } from "@/modules/sources/ports/unit-of-work";
import { uuidv7 } from "@/shared/ids/uuidv7";
import { bindSourceProjection } from "./source-knowledge-projection-service";

export type ImportApplyFailurePoint =
  | "after-folders"
  | "after-documents"
  | "after-revisions"
  | "after-assets"
  | "before-run";

export type ExecuteFolderImportPlanOptions = {
  failurePoint?: ImportApplyFailurePoint;
  now?: () => Date;
};

function failAt(options: ExecuteFolderImportPlanOptions, point: ImportApplyFailurePoint): void {
  if (options.failurePoint === point) throw importError("TEST_IMPORT_FAILURE", `Injected import failure at ${point}.`);
}

function parentPath(path: string): string | null {
  const index = path.lastIndexOf("/");
  return index < 0 ? null : path.slice(0, index);
}

export async function executeFolderImportPlan(
  repositories: SourceRepositories,
  caller: CallerContext,
  source: KnowledgeSource,
  plan: FolderImportPlan,
  options: ExecuteFolderImportPlanOptions = {},
): Promise<void> {
  if (plan.planVersion !== "phase2:v1") throw importError("IMPORT_PLAN_VERSION_UNSUPPORTED", "Unsupported import plan version.");
  if (plan.sourceBinding.workspaceId !== source.workspaceId) throw importError("IMPORT_PLAN_BINDING_MISMATCH", "Import plan Workspace binding does not match the Source.");
  if (plan.sourceBinding.sourceId !== null && plan.sourceBinding.sourceId !== source.id) throw importError("IMPORT_PLAN_BINDING_MISMATCH", "Import plan Source binding does not match the Source.");

  const now = options.now ?? (() => new Date());
  const projection = bindSourceProjection(repositories, { id: source.id, workspaceId: source.workspaceId });
  const current = await repositories.importCanonicalState.load(source.id);
  const folderNodeByPath = new Map(current.folders.map((folder) => [folder.sourcePath, folder.treeNodeId]));
  const createdNodeByKey = new Map<string, string>();
  const assetsByPath = new Map((await repositories.assets.listBySourceId(source.id)).map((asset) => [asset.sourcePath, asset]));

  for (const action of plan.folders.restore) {
    await projection.restoreProjectedFolder(caller, action.treeNodeId);
    folderNodeByPath.set(action.sourcePath, action.treeNodeId);
  }
  for (const action of plan.folders.create) {
    const parentId = action.parentPath === null ? null : folderNodeByPath.get(action.parentPath);
    if (action.parentPath !== null && !parentId) throw importError("IMPORT_PLAN_PARENT_MISSING", `Folder parent ${action.parentPath} is unavailable.`);
    const sourceEntryId = uuidv7();
    const projected = await projection.projectFolder(caller, {
      sourceId: source.id,
      mapping: { sourceEntryId, externalId: null, sourcePath: action.sourcePath },
      parentId: parentId ?? null,
      name: action.name,
      position: action.desiredPosition,
    });
    folderNodeByPath.set(action.sourcePath, projected.treeNodeId);
    createdNodeByKey.set(`folder:${action.sourcePath}`, projected.treeNodeId);
  }
  failAt(options, "after-folders");

  for (const action of plan.documents.create) {
    const parentId = action.parentPath === null ? null : folderNodeByPath.get(action.parentPath);
    if (action.parentPath !== null && !parentId) throw importError("IMPORT_PLAN_PARENT_MISSING", `Document parent ${action.parentPath} is unavailable.`);
    const sourceEntryId = uuidv7();
    const projected = await projection.projectDocument(caller, {
      sourceId: source.id,
      parentId: parentId ?? null,
      position: action.desiredPosition,
      title: action.content.title,
      markdown: action.content.markdown,
      metadata: action.content.metadata,
      mapping: { sourceEntryId, externalId: action.externalId, sourcePath: action.sourcePath },
    });
    createdNodeByKey.set(`document:${action.sourcePath}`, projected.treeNodeId);
  }
  for (const action of plan.documents.restore) {
    await projection.restoreProjectedDocument(caller, action.documentId);
  }
  for (const action of plan.documents.move) {
    const parentId = action.parentPath === null ? null : folderNodeByPath.get(action.parentPath);
    if (action.parentPath !== null && !parentId) throw importError("IMPORT_PLAN_PARENT_MISSING", `Moved document parent ${action.parentPath} is unavailable.`);
    await projection.moveProjectedNode(caller, { nodeId: action.treeNodeId, newParentId: parentId ?? null, newPosition: action.desiredPosition });
  }
  failAt(options, "after-documents");

  for (const action of plan.documents.revise) {
    await projection.projectRevision(caller, {
      documentId: action.documentId,
      expectedCurrentRevisionId: action.expectedCurrentRevisionId,
      title: action.content.title,
      markdown: action.content.markdown,
      metadata: action.content.metadata,
    });
  }
  for (const action of plan.documents.updateLocator) {
    const entry = await repositories.entries.findById(action.entryId);
    if (!entry || entry.sourceId !== source.id || entry.entryType !== "DOCUMENT") throw importError("IMPORT_PLAN_ENTRY_MISSING", "Document SourceEntry referenced by the plan is unavailable.");
    await repositories.entries.update({
      ...entry,
      sourcePath: action.sourcePath,
      contentHash: action.contentHash,
      updatedBy: caller.identity.id,
      lastSeenAt: now(),
    });
  }
  failAt(options, "after-revisions");

  for (const action of plan.assets.upsert) {
    const existing = assetsByPath.get(action.sourcePath);
    const timestamp = now();
    await repositories.assets.upsertByPath({
      id: existing?.id ?? uuidv7(),
      sourceId: source.id,
      sourcePath: action.sourcePath,
      sourcePathHash: action.sourcePathHash,
      mimeType: action.mimeType,
      contentHash: action.contentHash,
      metadata: action.metadata,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    });
  }
  for (const action of plan.documents.archive) {
    await projection.archiveProjectedDocument(caller, action.documentId);
  }
  for (const action of plan.assets.remove) {
    const existing = await repositories.assets.findById(action.assetId);
    if (existing && existing.sourceId === source.id) await repositories.assets.deleteById(action.assetId);
  }
  for (const action of plan.folders.archive) {
    await projection.archiveProjectedFolder(caller, action.treeNodeId);
    folderNodeByPath.delete(action.sourcePath);
  }
  failAt(options, "after-assets");

  for (const target of plan.ordering) {
    let nodeId: string;
    if (target.nodeKey.startsWith("tree:")) nodeId = target.nodeKey.slice("tree:".length);
    else {
      const created = createdNodeByKey.get(target.nodeKey);
      if (!created) throw importError("IMPORT_PLAN_NODE_MISSING", `Ordering node ${target.nodeKey} is unavailable.`);
      nodeId = created;
    }
    const expectedParentId = target.parentPath === null ? null : folderNodeByPath.get(target.parentPath);
    if (target.parentPath !== null && !expectedParentId) throw importError("IMPORT_PLAN_PARENT_MISSING", `Ordering parent ${target.parentPath} is unavailable.`);
    const node = await repositories.tree.findById(nodeId);
    if (!node || node.sourceId !== source.id || node.status !== "ACTIVE") throw importError("IMPORT_PLAN_NODE_MISSING", "Ordering target is unavailable in the bound Source.");
    if (node.parentId !== (expectedParentId ?? null)) {
      // Ordering is not allowed to silently reparent anything; reparenting belongs to the persisted move/create actions.
      throw importError("IMPORT_PLAN_PARENT_MISMATCH", `Ordering target parent does not match ${target.parentPath ?? "root"}.`);
    }
    if (node.position !== target.position) await repositories.tree.updatePosition(node.id, target.position, caller.identity.id);
  }

  // Defensive invariant: every desired active document must still sit beneath its persisted source-path parent.
  for (const action of plan.documents.updateLocator) {
    const entry = await repositories.entries.findById(action.entryId);
    if (!entry?.treeNodeId) continue;
    const node = await repositories.tree.findById(entry.treeNodeId);
    const expectedParentPath = parentPath(action.sourcePath);
    const expectedParentId = expectedParentPath === null ? null : folderNodeByPath.get(expectedParentPath);
    if (!node || node.parentId !== (expectedParentId ?? null)) throw importError("IMPORT_PLAN_PARENT_MISMATCH", "Document placement no longer matches the persisted import plan.");
  }
}
