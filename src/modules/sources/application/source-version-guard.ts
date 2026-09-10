import { uuidv7 } from "@/shared/ids/uuidv7";
import type { CallerContext } from "@/modules/identity/domain/caller-context";
import { IntegrityViolationError, VersionConflictError, SourceNotFoundError, NotFoundError, SourceEntryConflictError } from "@/modules/knowledge/domain/errors";
import type { ContentInput } from "@/modules/knowledge/domain/content";
import { contentFingerprint } from "@/modules/knowledge/domain/content";
import type { SourceUnitOfWork } from "../ports/unit-of-work";
import type { SourceEntry } from "../domain/source-entry";
import type { KnowledgeAsset } from "../domain/asset";
import type { KnowledgeSource } from "../domain/source";
import { bindSourceProjection } from "./source-knowledge-projection-service";
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
 * Phase 1 Source container lifecycle contract (plan §3, verbatim). Archive is
 * a visibility gate for both ownerships: only the Source row changes status
 * and provenance, descendants keep their lifecycle values. This is a
 * container operation and never rewrites SOURCE_MANAGED content.
 */
export interface SourceLifecycleCommands {
  archiveSource(caller: CallerContext, sourceId: string): Promise<void>;
  restoreSource(caller: CallerContext, sourceId: string): Promise<void>;
}

export class SourceApplicationService implements SourceLifecycleCommands {
  private readonly unitOfWork: SourceUnitOfWork;

  constructor(unitOfWork: SourceUnitOfWork) {
    this.unitOfWork = unitOfWork;
  }

  async listSources(caller: CallerContext, workspaceId?: string): Promise<KnowledgeSource[]> {
    const trustedCaller = caller;
    return this.unitOfWork.run(async (repositories) => {
      await repositories.users.upsertIdentity(trustedCaller.identity);
      if (workspaceId) {
        await repositories.workspaceAccess.requireMembership(trustedCaller, workspaceId);
        return repositories.sources.findActiveByWorkspaceId(workspaceId);
      }
      const workspaces = await repositories.workspaces.listForUser(trustedCaller.identity.id);
      const sources = await Promise.all(workspaces.map((workspace) => repositories.sources.findActiveByWorkspaceId(workspace.id)));
      return sources.flat().sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
    });
  }

  async applyKnownEntry(caller: CallerContext, input: KnownSourceApplyInput): Promise<{ runId: string; resultVersion: number; changed: boolean }> {
    const runId = uuidv7();
    try {
      return await this.unitOfWork.run(async (repositories) => {
        await repositories.users.upsertIdentity(caller.identity);
        const source = await repositories.sources.lockById(input.sourceId);
        if (!source) throw new SourceNotFoundError();
        await repositories.workspaceAccess.requireMembership(caller, source.workspaceId);
        const resultVersion = await repositories.sources.guardAndAdvanceVersion(input.sourceId, input.basedOnVersion, caller.identity.id);
        if (resultVersion === null) throw new VersionConflictError();
        const stored = await repositories.entries.findById(input.entryId);
        if (!stored || stored.sourceId !== input.sourceId || stored.documentId !== input.documentId) throw new NotFoundError("Known SourceEntry mapping was not found.");
        const projection = bindSourceProjection(repositories, { id: source.id, workspaceId: source.workspaceId });
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
          contentHash: contentFingerprint(input.content),
          status: input.restore ? "ACTIVE" : entry.status,
          updatedBy: caller.identity.id,
          archivedBy: input.restore ? null : entry.archivedBy ?? null,
          archivedAt: input.restore ? null : entry.archivedAt ?? null,
          lastSeenAt: entry.lastSeenAt,
        };
        const entryChanged = desiredEntry.externalId !== entry.externalId || desiredEntry.sourcePath !== entry.sourcePath || desiredEntry.contentHash !== entry.contentHash || desiredEntry.status !== entry.status || desiredEntry.archivedBy !== entry.archivedBy || desiredEntry.archivedAt !== entry.archivedAt;
        if (entryChanged) await repositories.entries.update({ ...desiredEntry, lastSeenAt: now });
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
      try { await this.recordFailedRun({ id: runId, caller, sourceId: input.sourceId, basedOnVersion: input.basedOnVersion, summary: { ...(input.summary ?? {}), failure: true } }); } catch { /* Preserve the original failure. */ }
      throw error;
    }
  }

  async archiveKnownEntry(caller: CallerContext, input: Omit<KnownSourceApplyInput, "content" | "restore" | "asset" | "failurePoint">): Promise<{ runId: string; resultVersion: number }> {
    const runId = uuidv7();
    try {
      return await this.unitOfWork.run(async (repositories) => {
        await repositories.users.upsertIdentity(caller.identity);
        const source = await repositories.sources.lockById(input.sourceId);
        if (!source) throw new SourceNotFoundError();
        await repositories.workspaceAccess.requireMembership(caller, source.workspaceId);
        const resultVersion = await repositories.sources.guardAndAdvanceVersion(input.sourceId, input.basedOnVersion, caller.identity.id);
        if (resultVersion === null) throw new VersionConflictError();
        const entry = await repositories.entries.findById(input.entryId);
        if (!entry || entry.sourceId !== input.sourceId || entry.documentId !== input.documentId) throw new NotFoundError("Known SourceEntry mapping was not found.");
        const projection = bindSourceProjection(repositories, { id: source.id, workspaceId: source.workspaceId });
        await projection.archiveProjectedDocument(caller, input.documentId);
        await archiveSourceEntry(repositories, caller, input.sourceId, input.entryId);
        await updateSourceLocator(repositories, caller, input.sourceId, input.entryId, input.sourcePath, entry.contentHash);
        const now = new Date();
        await repositories.syncRuns.insert({ id: runId, sourceId: input.sourceId, triggeredBy: caller.identity.id, basedOnVersion: input.basedOnVersion, resultVersion, status: "APPLIED", summary: input.summary ?? { archived: true }, startedAt: now, completedAt: new Date() });
        return { runId, resultVersion };
      });
    } catch (error) {
      try { await this.recordFailedRun({ id: runId, caller, sourceId: input.sourceId, basedOnVersion: input.basedOnVersion, summary: { ...(input.summary ?? {}), failure: true } }); } catch { /* Preserve original failure. */ }
      throw error;
    }
  }

  async archiveSource(caller: CallerContext, sourceId: string): Promise<void> {
    await this.setSourceStatus(caller, sourceId, "ARCHIVED");
  }

  async restoreSource(caller: CallerContext, sourceId: string): Promise<void> {
    await this.setSourceStatus(caller, sourceId, "ACTIVE");
  }

  private async setSourceStatus(caller: CallerContext, sourceId: string, status: "ACTIVE" | "ARCHIVED"): Promise<void> {
    await this.unitOfWork.run(async (repositories) => {
      await repositories.users.upsertIdentity(caller.identity);
      const source = await repositories.sources.lockById(sourceId);
      if (!source) throw new SourceNotFoundError();
      await repositories.workspaceAccess.requireMembership(caller, source.workspaceId);
      if (source.status === status) return;
      await repositories.sources.updateStatus(sourceId, status, caller.identity.id);
    });
  }

  async recordFailedRun(input: { id?: string; sourceId: string; caller: CallerContext; basedOnVersion: number; summary: Record<string, unknown> }): Promise<string> {
    const id = input.id ?? uuidv7();
    await this.unitOfWork.run(async (repositories) => {
      await repositories.users.upsertIdentity(input.caller.identity);
      const source = await repositories.sources.findById(input.sourceId);
      if (!source) throw new SourceNotFoundError();
      await repositories.workspaceAccess.requireMembership(input.caller, source.workspaceId);
      await repositories.syncRuns.insert({ id, sourceId: input.sourceId, triggeredBy: input.caller.identity.id, basedOnVersion: input.basedOnVersion, resultVersion: null, status: "FAILED", summary: input.summary, startedAt: new Date(), completedAt: new Date() });
    });
    return id;
  }
}
