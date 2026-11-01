import { syncCallerIdentity } from "@/modules/identity/application/sync-caller-identity";
import { uuidv7 } from "@/shared/ids/uuidv7";
import type { CallerContext } from "@/modules/identity/domain/caller-context";
import { lockWorkspaceForMutation } from "@/modules/workspaces/application/workspace-mutation-guard";
import { IntegrityViolationError, VersionConflictError, SourceNotFoundError, NotFoundError, SourceEntryConflictError, SourceReadOnlyError, ValidationError } from "@/modules/knowledge/domain/errors";
import { MAX_FOLDER_NAME_LENGTH } from "@/modules/knowledge/domain/tree-rules";
import type { ContentInput } from "@/modules/knowledge/domain/content";
import { fingerprintRevisionContent } from "@/modules/knowledge/domain/content";
import type { SourceUnitOfWork } from "../ports/unit-of-work";
import type { SourceEntry } from "../domain/source-entry";
import type { KnowledgeAsset } from "../domain/asset";
import { SourceImportError, type ImportErrorCode } from "../domain/import-errors";
import { bindSourceProjection } from "./source-knowledge-projection-service";
import { requireSourceManagedSource } from "@/modules/knowledge/application/internal/tree-transaction";
import { recordPersonalPublicationEvent } from "@/modules/knowledge/application/internal/publication-event-recording";
import { archiveSourceEntry, updateSourceLocator } from "./source-entry-mapping-service";

export type KnownSourceApplyInput = {
  sourceId: string;
  basedOnVersion: number;
  entryId: string;
  documentId: string;
  externalId: string | null;
  sourcePath: string;
  content: ContentInput;
  restore?: boolean;
  asset?: KnowledgeAsset;
  summary?: Record<string, unknown>;
  /** Test-only fault injection; never exposed through a Web action. */
  failurePoint?: "knowledge" | "entry" | "asset" | "run";
};

/**
 * Failure-audit marker for the Phase 1 known-entry path (#9 item 22). Same
 * `failureCode` shape as the Phase 2 Apply path: the import error's own code
 * when the failure is an import diagnostic, otherwise the generic fallback.
 */
function knownEntryFailureCode(error: unknown): ImportErrorCode {
  return error instanceof SourceImportError ? error.code : "IMPORT_APPLY_FAILED";
}

function failedSummary(summary: Record<string, unknown> | undefined, error: unknown): Record<string, unknown> {
  const { failure: _dropped, ...rest } = summary ?? {};
  void _dropped;
  return { ...rest, failureCode: knownEntryFailureCode(error) };
}

/**
 * Phase 1 Source container lifecycle contract (plan §3, verbatim). Archive is
 * a visibility gate for both ownerships: only the Source row changes status
 * and provenance, descendants keep their lifecycle values. This is a
 * container operation and never rewrites SOURCE_MANAGED content.
 */
export interface SourceLifecycleCommands {
  archiveSource(caller: CallerContext, sourceId: string): Promise<void>;
  restoreSource(caller: CallerContext, sourceId: string): Promise<void>;
  renameSource(caller: CallerContext, sourceId: string, name: string): Promise<void>;
}

function normalizedSourceName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_FOLDER_NAME_LENGTH) {
    throw new ValidationError(`Source name must be between 1 and ${MAX_FOLDER_NAME_LENGTH} characters.`);
  }
  return trimmed;
}

/**
 * Source lifecycle and rename belong to the publication mechanism for a
 * publication source (unpublish/restore/rename have their own rules and
 * callers). The generic commands refuse it outright.
 */
function requireOrdinarySource(source: { sourceType: string }): void {
  if (source.sourceType === "PUBLICATION") {
    throw new SourceReadOnlyError("Publication sources are archived, restored and renamed by the publication lifecycle.");
  }
}

export class SourceApplicationService implements SourceLifecycleCommands {
  private readonly unitOfWork: SourceUnitOfWork;

  constructor(unitOfWork: SourceUnitOfWork) {
    this.unitOfWork = unitOfWork;
  }

  async applyKnownEntry(caller: CallerContext, input: KnownSourceApplyInput): Promise<{ runId: string; resultVersion: number; changed: boolean }> {
    const runId = uuidv7();
    try {
      return await this.unitOfWork.run(async (repositories) => {
        await syncCallerIdentity(repositories.users, caller);
        const source = await repositories.sources.lockById(input.sourceId);
        if (!source) throw new SourceNotFoundError();
        const workspace = await lockWorkspaceForMutation(repositories, caller, source.workspaceId, "source-import");
        await requireSourceManagedSource(repositories, caller, input.sourceId);
        const projection = bindSourceProjection(repositories, { id: source.id, workspaceId: source.workspaceId });
        const resultVersion = await repositories.sources.guardAndAdvanceVersion(input.sourceId, input.basedOnVersion, caller.identity.id);
        if (resultVersion === null) throw new VersionConflictError();
        const stored = await repositories.entries.findById(input.entryId);
        if (!stored || stored.sourceId !== input.sourceId || stored.documentId !== input.documentId) throw new NotFoundError("Known SourceEntry mapping was not found.");
        if (input.restore) {
          await projection.restoreProjectedDocument(caller, input.documentId);
        }
        const current = await repositories.revisions.findCurrent(input.documentId);
        if (!current) throw new IntegrityViolationError("Document current revision is missing.");
        const knowledgeResult = await projection.projectRevision(caller, { documentId: input.documentId, expectedCurrentRevisionId: current.id, ...input.content });
        if (input.failurePoint === "knowledge") throw new Error("Injected source apply failure after Knowledge mutation.");
        const entry = await repositories.entries.findById(input.entryId);
        if (!entry || entry.sourceId !== input.sourceId || entry.documentId !== input.documentId) throw new NotFoundError("Known SourceEntry mapping was not found.");
        if (input.externalId !== null && input.externalId !== entry.externalId) {
          const conflicting = await repositories.entries.findByExternalId(input.sourceId, input.externalId);
          if (conflicting && conflicting.id !== entry.id) throw new SourceEntryConflictError();
        }
        const now = new Date();
        const desiredEntry: SourceEntry = {
          ...entry,
          externalId: input.externalId,
          sourcePath: input.sourcePath,
          contentHash: fingerprintRevisionContent(input.content).contentHash,
          status: input.restore ? "ACTIVE" : entry.status,
          updatedBy: caller.identity.id,
          archivedBy: input.restore ? null : entry.archivedBy ?? null,
          archivedAt: input.restore ? null : entry.archivedAt ?? null,
          lastSeenAt: entry.lastSeenAt,
        };
        const entryChanged = desiredEntry.externalId !== entry.externalId || desiredEntry.sourcePath !== entry.sourcePath || desiredEntry.contentHash !== entry.contentHash || desiredEntry.status !== entry.status || desiredEntry.archivedBy !== entry.archivedBy || desiredEntry.archivedAt !== entry.archivedAt;
        if (entryChanged) await repositories.entries.update({ ...desiredEntry, lastSeenAt: now });
        // A same-hash save writes no revision, but moving the file is still a
        // placement change the team has to see.
        if (desiredEntry.sourcePath !== entry.sourcePath) {
          await recordPersonalPublicationEvent(repositories, workspace, {
            documentId: null, treeNodeId: entry.treeNodeId, sourceId: null, kind: "TREE", at: now,
          });
        }
        if (input.failurePoint === "entry") throw new Error("Injected source apply failure after SourceEntry update.");
        if (input.asset) {
          if (input.asset.sourceId !== input.sourceId) throw new NotFoundError("Asset metadata belongs to a different source.");
          await repositories.assets.insert(input.asset);
          if (input.failurePoint === "asset") throw new Error("Injected source apply failure after asset metadata update.");
        }
        if (input.failurePoint === "run") throw new Error("Injected source apply failure before SyncRun record.");
        await repositories.syncRuns.insert({ id: runId, sourceId: input.sourceId, triggeredBy: caller.identity.id, basedOnVersion: input.basedOnVersion, resultVersion, status: "APPLIED", summary: input.summary ?? { changed: knowledgeResult.changed }, startedAt: now, completedAt: new Date() });
        return { runId, resultVersion, changed: knowledgeResult.changed };
      });
    } catch (error) {
      try { await this.recordFailedRun({ id: runId, caller, sourceId: input.sourceId, basedOnVersion: input.basedOnVersion, summary: failedSummary(input.summary, error) }); } catch { /* Preserve the original failure. */ }
      throw error;
    }
  }

  async archiveKnownEntry(caller: CallerContext, input: Omit<KnownSourceApplyInput, "content" | "restore" | "asset" | "failurePoint">): Promise<{ runId: string; resultVersion: number }> {
    const runId = uuidv7();
    try {
      return await this.unitOfWork.run(async (repositories) => {
        await syncCallerIdentity(repositories.users, caller);
        const source = await repositories.sources.lockById(input.sourceId);
        if (!source) throw new SourceNotFoundError();
        const workspace = await lockWorkspaceForMutation(repositories, caller, source.workspaceId, "source-import");
        await requireSourceManagedSource(repositories, caller, input.sourceId);
        const projection = bindSourceProjection(repositories, { id: source.id, workspaceId: source.workspaceId });
        const resultVersion = await repositories.sources.guardAndAdvanceVersion(input.sourceId, input.basedOnVersion, caller.identity.id);
        if (resultVersion === null) throw new VersionConflictError();
        const entry = await repositories.entries.findById(input.entryId);
        if (!entry || entry.sourceId !== input.sourceId || entry.documentId !== input.documentId) throw new NotFoundError("Known SourceEntry mapping was not found.");
        await projection.archiveProjectedDocument(caller, input.documentId);
        await archiveSourceEntry(repositories, caller, input.sourceId, input.entryId);
        await updateSourceLocator(repositories, caller, input.sourceId, input.entryId, input.sourcePath, entry.contentHash);
        // Archiving an already-archived document writes no lifecycle event, so
        // a path change here would otherwise be the one unrecorded mutation.
        if (entry.status === "ARCHIVED" && input.sourcePath !== entry.sourcePath) {
          await recordPersonalPublicationEvent(repositories, workspace, {
            documentId: null, treeNodeId: entry.treeNodeId, sourceId: null, kind: "TREE", at: new Date(),
          });
        }
        const now = new Date();
        await repositories.syncRuns.insert({ id: runId, sourceId: input.sourceId, triggeredBy: caller.identity.id, basedOnVersion: input.basedOnVersion, resultVersion, status: "APPLIED", summary: input.summary ?? { archived: true }, startedAt: now, completedAt: new Date() });
        return { runId, resultVersion };
      });
    } catch (error) {
      try { await this.recordFailedRun({ id: runId, caller, sourceId: input.sourceId, basedOnVersion: input.basedOnVersion, summary: failedSummary(input.summary, error) }); } catch { /* Preserve original failure. */ }
      throw error;
    }
  }

  async archiveSource(caller: CallerContext, sourceId: string): Promise<void> {
    await this.setSourceStatus(caller, sourceId, "ARCHIVED");
  }

  async renameSource(caller: CallerContext, sourceId: string, name: string): Promise<void> {
    const next = normalizedSourceName(name);
    await this.unitOfWork.run(async (repositories) => {
      await syncCallerIdentity(repositories.users, caller);
      const source = await repositories.sources.lockById(sourceId);
      if (!source) throw new SourceNotFoundError();
      requireOrdinarySource(source);
      await lockWorkspaceForMutation(repositories, caller, source.workspaceId, "source-import");
      if (source.name === next) return;
      await repositories.sources.updateName(sourceId, next, caller.identity.id);
    });
  }

  async restoreSource(caller: CallerContext, sourceId: string): Promise<void> {
    await this.setSourceStatus(caller, sourceId, "ACTIVE");
  }

  private async setSourceStatus(caller: CallerContext, sourceId: string, status: "ACTIVE" | "ARCHIVED"): Promise<void> {
    await this.unitOfWork.run(async (repositories) => {
      await syncCallerIdentity(repositories.users, caller);
      const source = await repositories.sources.lockById(sourceId);
      if (!source) throw new SourceNotFoundError();
      requireOrdinarySource(source);
      const workspace = await lockWorkspaceForMutation(repositories, caller, source.workspaceId, "source-import");
      if (source.status === status) return;
      await repositories.sources.updateStatus(sourceId, status, caller.identity.id);
      // Whole-source lifecycle: the target is the Source itself, and the
      // consumer expands it to every original inside.
      await recordPersonalPublicationEvent(repositories, workspace, {
        documentId: null, treeNodeId: null, sourceId, kind: "SOURCE", at: new Date(),
      });
    });
  }

  async recordFailedRun(input: { id?: string; sourceId: string; caller: CallerContext; basedOnVersion: number; summary: Record<string, unknown> }): Promise<string> {
    const id = input.id ?? uuidv7();
    await this.unitOfWork.run(async (repositories) => {
      await syncCallerIdentity(repositories.users, input.caller);
      const source = await repositories.sources.findById(input.sourceId);
      if (!source) throw new SourceNotFoundError();
      await repositories.workspaceAccess.requireMembership(input.caller, source.workspaceId);
      await repositories.syncRuns.insert({ id, sourceId: input.sourceId, triggeredBy: input.caller.identity.id, basedOnVersion: input.basedOnVersion, resultVersion: null, status: "FAILED", summary: input.summary, startedAt: new Date(), completedAt: new Date() });
    });
    return id;
  }
}
