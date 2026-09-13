import type { CallerContext } from "@/modules/identity/domain/caller-context";
import { importError } from "@/modules/sources/domain/import-errors";
import { hashImportPlan, hashReadyImportSnapshot } from "@/modules/sources/domain/import-integrity";
import type { ImportDiffSummary } from "@/modules/sources/domain/import-plan";
import type { KnowledgeSource } from "@/modules/sources/domain/source";
import type { SyncRun } from "@/modules/sources/domain/sync-run";
import type { SourceUnitOfWork } from "@/modules/sources/ports/unit-of-work";
import { DomainError } from "@/shared/domain/errors";
import { uuidv7 } from "@/shared/ids/uuidv7";
import { executeFolderImportPlan, type ImportApplyFailurePoint } from "./source-import-plan-executor";

export type ApplyFolderImportResult =
  | { kind: "APPLIED"; sourceId: string; resultVersion: number; runId: string | null; alreadyApplied: boolean }
  | { kind: "VERSION_CONFLICT"; sourceId: string; currentVersion: number };

type Options = { now?: () => Date; failurePoint?: ImportApplyFailurePoint };

/**
 * Snapshot provenance every SyncRun carries (spec §22). Snapshots are deleted
 * 24h after APPLIED, so the counts alone would leave canonical history with
 * nothing linking a run back to the import that produced it.
 */
type RunProvenance = { snapshotId: string; snapshotHash: string; planHash: string };

type FailedAttempt = { sourceId: string; basedOnVersion: number; summary: ImportDiffSummary; provenance: RunProvenance; callerId: string };

function runSummary(summary: ImportDiffSummary, provenance: RunProvenance): Record<string, unknown> {
  return { ...summary, ...provenance };
}

/** Spec §17.1 names the marker `failureCode`; it is always a code, never prose. */
function failedSummary(summary: ImportDiffSummary, provenance: RunProvenance, failureCode: string): Record<string, unknown> {
  return { ...runSummary(summary, provenance), failureCode };
}

/**
 * Canonical history must never absorb raw driver text: an `error.message` can
 * carry SQL fragments, connection details, or source paths (spec §18.4).
 */
function applyFailureCode(error: unknown): string {
  return error instanceof DomainError && error.code ? error.code : "IMPORT_APPLY_FAILED";
}

function assertImportableSource(source: KnowledgeSource): void {
  if (source.status !== "ACTIVE" || source.sourceType !== "FOLDER_SYNC" || source.ownership !== "SOURCE_MANAGED") {
    throw importError("SOURCE_IMPORT_NOT_ALLOWED", "Only active SOURCE_MANAGED folder sources can be applied.");
  }
}

export class ApplyFolderImportService {
  private readonly now: () => Date;
  private readonly failurePoint?: ImportApplyFailurePoint;

  constructor(private readonly uow: SourceUnitOfWork, options: Options = {}) {
    this.now = options.now ?? (() => new Date());
    this.failurePoint = options.failurePoint;
  }

  async apply(caller: CallerContext, snapshotId: string): Promise<ApplyFolderImportResult> {
    const failedAttempt: { value: FailedAttempt | null } = { value: null };
    try {
      return await this.uow.run(async (repositories) => {
        const snapshot = await repositories.importSnapshots.lockById(snapshotId);
        if (!snapshot || snapshot.createdBy !== caller.identity.id) throw importError("IMPORT_SNAPSHOT_NOT_FOUND", "Import snapshot was not found.");
        await repositories.workspaceAccess.requireMembership(caller, snapshot.workspaceId);

        if (snapshot.state === "APPLIED") {
          if (!snapshot.resultSourceId || snapshot.resultVersion === null) throw importError("IMPORT_SNAPSHOT_INVALID", "Applied snapshot is missing its persisted result.");
          return { kind: "APPLIED", sourceId: snapshot.resultSourceId, resultVersion: snapshot.resultVersion, runId: null, alreadyApplied: true };
        }
        if (snapshot.state === "STALE") throw importError("IMPORT_SNAPSHOT_STALE", "Import snapshot is stale and cannot be applied.");
        if (snapshot.state !== "READY" || !snapshot.plan || !snapshot.summary) throw importError("IMPORT_SNAPSHOT_NOT_READY", "Only READY snapshots can be applied.");
        const timestamp = this.now();
        if (snapshot.expiresAt.getTime() <= timestamp.getTime()) throw importError("IMPORT_SNAPSHOT_EXPIRED", "Import snapshot has expired.");
        if (snapshot.hasBlockers || snapshot.summary.blockers > 0) throw importError("IMPORT_SNAPSHOT_BLOCKED", "Import snapshot contains blocking diagnostics.");
        if (!snapshot.snapshotHash || !snapshot.planHash) {
          throw importError("IMPORT_SNAPSHOT_INVALID", "READY snapshot is missing its persisted integrity hashes.");
        }
        const persistedEntries = await repositories.importSnapshotEntries.listBySnapshotId(snapshot.id);
        const planHash = hashImportPlan(snapshot.plan);
        const snapshotHash = hashReadyImportSnapshot(snapshot, persistedEntries);
        if (planHash !== snapshot.planHash || snapshotHash !== snapshot.snapshotHash) {
          throw importError("IMPORT_SNAPSHOT_INTEGRITY_MISMATCH", "Import preview integrity validation failed; create a fresh preview before applying.");
        }
        const provenance: RunProvenance = { snapshotId: snapshot.id, snapshotHash: snapshot.snapshotHash, planHash: snapshot.planHash };

        if (snapshot.sourceId !== null) {
          const source = await repositories.sources.lockById(snapshot.sourceId);
          if (!source) throw importError("IMPORT_SOURCE_NOT_FOUND", "Import source was not found.");
          assertImportableSource(source);
          if (source.workspaceId !== snapshot.workspaceId) throw importError("IMPORT_PLAN_BINDING_MISMATCH", "Snapshot Workspace does not match its Source.");
          const basedOnVersion = snapshot.basedOnVersion;
          if (basedOnVersion === null) throw importError("IMPORT_SNAPSHOT_INVALID", "Resync snapshot is missing basedOnVersion.");
          if (source.syncVersion !== basedOnVersion) {
            const runId = uuidv7();
            const run: SyncRun = {
              id: runId,
              sourceId: source.id,
              triggeredBy: caller.identity.id,
              basedOnVersion,
              resultVersion: null,
              status: "FAILED",
              summary: failedSummary(snapshot.summary, provenance, "SOURCE_VERSION_CONFLICT"),
              startedAt: timestamp,
              completedAt: timestamp,
            };
            await repositories.syncRuns.insert(run);
            await repositories.importSnapshots.markStale({ snapshotId: snapshot.id, staleAt: timestamp });
            return { kind: "VERSION_CONFLICT", sourceId: source.id, currentVersion: source.syncVersion };
          }

          failedAttempt.value = { sourceId: source.id, basedOnVersion, summary: snapshot.summary, provenance, callerId: caller.identity.id };
          await executeFolderImportPlan(repositories, caller, source, snapshot.plan, { failurePoint: this.failurePoint, now: this.now });
          if (this.failurePoint === "before-run") throw importError("TEST_IMPORT_FAILURE", "Injected import failure before SyncRun.");
          const resultVersion = await repositories.sources.guardAndAdvanceVersion(source.id, basedOnVersion, caller.identity.id);
          if (resultVersion === null) throw importError("SOURCE_VERSION_CONFLICT", "Source version changed while applying the persisted plan.");
          const runId = uuidv7();
          await repositories.syncRuns.insert({
            id: runId,
            sourceId: source.id,
            triggeredBy: caller.identity.id,
            basedOnVersion,
            resultVersion,
            status: "APPLIED",
            summary: runSummary(snapshot.summary, provenance),
            startedAt: timestamp,
            completedAt: this.now(),
          });
          await repositories.importSnapshots.markApplied({ snapshotId: snapshot.id, sourceId: source.id, resultVersion, appliedAt: this.now() });
          failedAttempt.value = null;
          return { kind: "APPLIED", sourceId: source.id, resultVersion, runId, alreadyApplied: false };
        }

        if (snapshot.basedOnVersion !== null || snapshot.proposedSourceName === null) throw importError("IMPORT_SNAPSHOT_INVALID", "Initial snapshot has invalid Source binding.");
        const sourceId = uuidv7();
        const source: KnowledgeSource = {
          id: sourceId,
          name: snapshot.proposedSourceName,
          workspaceId: snapshot.workspaceId,
          sourceType: "FOLDER_SYNC",
          ownership: "SOURCE_MANAGED",
          status: "ACTIVE",
          syncVersion: 0,
          createdBy: caller.identity.id,
          updatedBy: caller.identity.id,
          archivedBy: null,
          archivedAt: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        await repositories.sources.insert(source);
        await executeFolderImportPlan(repositories, caller, source, snapshot.plan, { failurePoint: this.failurePoint, now: this.now });
        if (this.failurePoint === "before-run") throw importError("TEST_IMPORT_FAILURE", "Injected import failure before SyncRun.");
        const resultVersion = await repositories.sources.guardAndAdvanceVersion(source.id, 0, caller.identity.id);
        if (resultVersion !== 1) throw importError("IMPORT_VERSION_ADVANCE_FAILED", "Initial Source could not advance to sync version 1.");
        const runId = uuidv7();
        await repositories.syncRuns.insert({
          id: runId,
          sourceId: source.id,
          triggeredBy: caller.identity.id,
          basedOnVersion: 0,
          resultVersion,
          status: "APPLIED",
          summary: runSummary(snapshot.summary, provenance),
          startedAt: timestamp,
          completedAt: this.now(),
        });
        await repositories.importSnapshots.markApplied({ snapshotId: snapshot.id, sourceId: source.id, resultVersion, appliedAt: this.now() });
        return { kind: "APPLIED", sourceId: source.id, resultVersion, runId, alreadyApplied: false };
      });
    } catch (error) {
      const attempt = failedAttempt.value;
      if (attempt !== null) {
        try {
          const timestamp = this.now();
          await this.uow.run(async (repositories) => {
            const source = await repositories.sources.findById(attempt.sourceId);
            if (!source) return;
            await repositories.syncRuns.insert({
              id: uuidv7(),
              sourceId: attempt.sourceId,
              triggeredBy: attempt.callerId,
              basedOnVersion: attempt.basedOnVersion,
              resultVersion: null,
              status: "FAILED",
              summary: failedSummary(attempt.summary, attempt.provenance, applyFailureCode(error)),
              startedAt: timestamp,
              completedAt: timestamp,
            });
          });
        } catch {
          // Preserve the canonical Apply failure; failure-audit insertion must never mask it.
        }
      }
      throw error;
    }
  }
}
