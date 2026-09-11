import type { CallerContext } from "@/modules/identity/domain/caller-context";
import {
  InvalidSourceMappingError,
  NotFoundError,
  SourceEntryConflictError,
} from "@/modules/knowledge/domain/errors";
import type { SourceEntry, SourceEntryType } from "../domain/source-entry";
import type { SourceRepositories } from "../ports/unit-of-work";

export type CreateSourceEntryMappingInput = {
  sourceEntryId: string;
  externalId: string | null;
  sourcePath: string;
  entryType: SourceEntryType;
  contentHash: string | null;
  documentId: string | null;
  treeNodeId: string | null;
};

function requireMappingId(sourceEntryId: string): void {
  if (!sourceEntryId) throw new InvalidSourceMappingError("SourceEntry mapping requires a preallocated stable ID.");
}

function requireSourcePath(sourcePath: string): void {
  if (!sourcePath) throw new InvalidSourceMappingError("SourceEntry mapping requires a non-empty source path.");
}

function requireExternalId(externalId: string | null): void {
  if (externalId !== null && externalId.length === 0) {
    throw new InvalidSourceMappingError("SourceEntry external ID must be null or non-empty.");
  }
}

/**
 * Internal transaction-bound SourceEntry mapping primitives (plan Task 7).
 *
 * The resolved Source scope (`sourceId`) and the trusted `CallerContext` are
 * supplied by the owning unit of work — never inferred from locator payload —
 * and every primitive verifies the entry belongs to that scope. These
 * functions never open a nested unit of work; the owning orchestration
 * commits once. Mapping writes never touch revisions or titles: a path change
 * preserves identity and never infers a title from a filename.
 */
export async function createSourceEntryMapping(
  repositories: SourceRepositories,
  caller: CallerContext,
  sourceId: string,
  input: CreateSourceEntryMappingInput,
): Promise<SourceEntry> {
  requireMappingId(input.sourceEntryId);
  requireSourcePath(input.sourcePath);
  requireExternalId(input.externalId);
  if (input.entryType === "FOLDER") {
    if (input.documentId !== null) throw new InvalidSourceMappingError("Folder mappings must not reference a document.");
    if (!input.treeNodeId) throw new InvalidSourceMappingError("Folder mappings require a tree node.");
    const node = await repositories.tree.lockById(input.treeNodeId);
    if (!node || node.sourceId !== sourceId || node.nodeType !== "FOLDER") {
      throw new InvalidSourceMappingError("Folder mappings require a folder tree node in the same source.");
    }
  } else {
    if (!input.documentId || !input.treeNodeId) {
      throw new InvalidSourceMappingError("Document mappings require a document and a tree node.");
    }
    const document = await repositories.documents.lockById(input.documentId);
    if (!document || document.sourceId !== sourceId) {
      throw new InvalidSourceMappingError("Document mappings require a document in the same source.");
    }
    const node = await repositories.tree.lockById(input.treeNodeId);
    if (!node || node.sourceId !== sourceId || node.nodeType !== "DOCUMENT" || node.documentId !== input.documentId) {
      throw new InvalidSourceMappingError("Document mappings require the document tree node in the same source.");
    }
  }
  if (input.externalId !== null) {
    const conflicting = await repositories.entries.findByExternalId(sourceId, input.externalId);
    if (conflicting) throw new SourceEntryConflictError();
  }
  const now = new Date();
  const entry: SourceEntry = {
    id: input.sourceEntryId,
    sourceId,
    externalId: input.externalId,
    sourcePath: input.sourcePath,
    entryType: input.entryType,
    contentHash: input.contentHash,
    documentId: input.documentId,
    treeNodeId: input.treeNodeId,
    status: "ACTIVE",
    updatedBy: caller.identity.id,
    archivedBy: null,
    archivedAt: null,
    firstSeenAt: now,
    lastSeenAt: now,
  };
  await repositories.entries.insert(entry);
  return entry;
}

export async function getSourceEntry(
  repositories: SourceRepositories,
  entryId: string,
): Promise<SourceEntry> {
  const entry = await repositories.entries.findById(entryId);
  if (!entry) throw new NotFoundError("SourceEntry mapping was not found.");
  return entry;
}

export async function resolveByExternalId(
  repositories: SourceRepositories,
  sourceId: string,
  externalId: string | null,
): Promise<SourceEntry | null> {
  if (externalId === null) return null;
  return repositories.entries.findByExternalId(sourceId, externalId);
}

function requireBoundEntry(entry: SourceEntry | null, sourceId: string): SourceEntry {
  if (!entry) throw new NotFoundError("SourceEntry mapping was not found.");
  if (entry.sourceId !== sourceId) {
    throw new InvalidSourceMappingError("SourceEntry mapping belongs to a different source.");
  }
  return entry;
}

export async function updateSourceLocator(
  repositories: SourceRepositories,
  caller: CallerContext,
  sourceId: string,
  entryId: string,
  sourcePath: string,
  contentHash: string | null,
): Promise<SourceEntry> {
  requireSourcePath(sourcePath);
  const entry = requireBoundEntry(await repositories.entries.findById(entryId), sourceId);
  const updated: SourceEntry = {
    ...entry,
    sourcePath,
    contentHash,
    updatedBy: caller.identity.id,
    lastSeenAt: new Date(),
  };
  await repositories.entries.update(updated);
  return updated;
}

export async function archiveSourceEntry(
  repositories: SourceRepositories,
  caller: CallerContext,
  sourceId: string,
  entryId: string,
): Promise<SourceEntry> {
  const entry = requireBoundEntry(await repositories.entries.findById(entryId), sourceId);
  if (entry.status === "ARCHIVED") return entry;
  const now = new Date();
  const archived: SourceEntry = {
    ...entry,
    status: "ARCHIVED",
    updatedBy: caller.identity.id,
    archivedBy: caller.identity.id,
    archivedAt: now,
    lastSeenAt: now,
  };
  await repositories.entries.update(archived);
  return archived;
}

export async function restoreSourceEntry(
  repositories: SourceRepositories,
  caller: CallerContext,
  sourceId: string,
  entryId: string,
): Promise<SourceEntry> {
  const entry = requireBoundEntry(await repositories.entries.findById(entryId), sourceId);
  if (entry.status === "ACTIVE") return entry;
  const restored: SourceEntry = {
    ...entry,
    status: "ACTIVE",
    updatedBy: caller.identity.id,
    archivedBy: null,
    archivedAt: null,
    lastSeenAt: entry.lastSeenAt,
  };
  await repositories.entries.update(restored);
  return restored;
}
