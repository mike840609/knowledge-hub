import type { CallerContext } from "@/modules/identity/domain/caller-context";
import { parseGenericMarkdownText } from "@/modules/sources/adapters/generic-markdown-folder-adapter";
import type { ImportDiagnostic } from "@/modules/sources/domain/import-diagnostic";
import { importError, SourceImportError } from "@/modules/sources/domain/import-errors";
import { hashImportPlan, hashReadyImportSnapshot } from "@/modules/sources/domain/import-integrity";
import { DEFAULT_IMPORT_LIMITS, type ImportLimits } from "@/modules/sources/domain/import-limits";
import { compareImportText, isIgnoredImportPath, normalizeImportPath } from "@/modules/sources/domain/import-path";
import type { ReadyImportAsset, ReadyImportContent, ReadyImportDocument, ImportPreviewChange } from "@/modules/sources/domain/import-plan";
import type { FinalizedImportSnapshotEntry, ImportSnapshot, ImportSnapshotEntry } from "@/modules/sources/domain/import-snapshot";
import type { SourceRepositories, SourceUnitOfWork } from "@/modules/sources/ports/unit-of-work";
import {
  blockedImportPlan,
  previewFromSnapshot,
  reconcileImportSnapshot,
  type ImportPreview,
} from "./reconcile-import-snapshot";

export type { ImportPreview } from "./reconcile-import-snapshot";

type Options = { limits?: ImportLimits; now?: () => Date; readyTtlMs?: number };

type NormalizedEntry = {
  staged: ImportSnapshotEntry;
  sourcePath: string | null;
  sourcePathHash: string | null;
  ignored: boolean;
  diagnostics: ImportDiagnostic[];
};

function blocker(code: string, sourcePath: string | null, message: string): ImportDiagnostic {
  return { code, severity: "BLOCKING", sourcePath, message };
}

function hasBlocker(diagnostics: readonly ImportDiagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === "BLOCKING");
}

const MAX_RESOLVED_TITLE_CHARS = 512;

function normalizeEntries(entries: ImportSnapshotEntry[]): NormalizedEntry[] {
  return entries.map((staged) => {
    const diagnostics = [...staged.diagnostics];
    try {
      const normalized = normalizeImportPath(staged.clientRelativePath);
      return {
        staged,
        sourcePath: normalized.sourcePath,
        sourcePathHash: normalized.sourcePathHash,
        ignored: isIgnoredImportPath(normalized.sourcePath),
        diagnostics,
      };
    } catch (error) {
      if (!(error instanceof SourceImportError)) throw error;
      diagnostics.push(blocker(error.code, staged.clientRelativePath, error.message));
      return { staged, sourcePath: null, sourcePathHash: null, ignored: false, diagnostics };
    }
  });
}

function applyCollisions(entries: NormalizedEntry[]): void {
  const groups = new Map<string, NormalizedEntry[]>();
  for (const entry of entries) {
    if (entry.ignored || entry.sourcePath === null) continue;
    const group = groups.get(entry.sourcePath) ?? [];
    group.push(entry);
    groups.set(entry.sourcePath, group);
  }
  for (const [sourcePath, group] of groups) {
    if (group.length < 2) continue;
    for (const entry of group) {
      entry.sourcePathHash = null;
      entry.diagnostics.push(blocker("PATH_COLLISION", sourcePath, `Multiple imported files normalize to ${sourcePath}.`));
    }
  }
}

function diagnosticChange(entry: NormalizedEntry): ImportPreviewChange {
  return {
    kind: entry.staged.entryType,
    sourcePath: entry.sourcePath ?? entry.staged.clientRelativePath,
    previousPath: null,
    labels: [],
    diagnostics: [...entry.diagnostics],
  };
}

function finalizedBase(entry: NormalizedEntry): FinalizedImportSnapshotEntry {
  return {
    ...entry.staged,
    sourcePath: entry.sourcePath,
    sourcePathHash: entry.sourcePathHash,
    uploadStatus: "RECEIVED",
    rawMarkdown: null,
    diagnostics: [...entry.diagnostics],
    previewChange: null,
  };
}

export class FinalizeFolderImportService {
  private readonly limits: ImportLimits;
  private readonly now: () => Date;
  private readonly readyTtlMs: number;
  private readonly quotaLockTimeoutSeconds = 10;

  constructor(private readonly uow: SourceUnitOfWork, options: Options = {}) {
    this.limits = options.limits ?? DEFAULT_IMPORT_LIMITS;
    this.now = options.now ?? (() => new Date());
    this.readyTtlMs = options.readyTtlMs ?? 30 * 60 * 1000;
  }

  async finalize(caller: CallerContext, snapshotId: string): Promise<ImportPreview> {
    const now = this.now();
    return this.uow.runWithCreatorQuotaLock(caller.identity.id, this.quotaLockTimeoutSeconds, async (repositories) =>
      this.finalizeLocked(caller, snapshotId, now, repositories),
    );
  }

  private async finalizeLocked(
    caller: CallerContext,
    snapshotId: string,
    now: Date,
    repositories: SourceRepositories,
  ): Promise<ImportPreview> {
    const snapshot = await repositories.importSnapshots.lockById(snapshotId);
    if (!snapshot || snapshot.createdBy !== caller.identity.id) throw importError("IMPORT_SNAPSHOT_NOT_FOUND", "Import snapshot was not found.");
    await repositories.workspaceAccess.requireMembership(caller, snapshot.workspaceId);
    if (snapshot.state === "READY") return previewFromSnapshot(snapshot, now);
    if (snapshot.state !== "BUILDING") throw importError("IMPORT_SNAPSHOT_NOT_BUILDING", "Only BUILDING snapshots can be finalized.");
    if (snapshot.expiresAt.getTime() <= now.getTime()) throw importError("IMPORT_SNAPSHOT_EXPIRED", "Import snapshot has expired.");

    const staged = await repositories.importSnapshotEntries.listBySnapshotId(snapshot.id);
    if (staged.some((entry) => entry.entryType === "DOCUMENT" && entry.uploadStatus !== "RECEIVED")) {
      throw importError("UPLOAD_INCOMPLETE", "Every Markdown file must be received before finalization.");
    }

    const normalized = normalizeEntries(staged);
    applyCollisions(normalized);
    const kept = normalized.filter((entry) => !entry.ignored);
    const documents: ReadyImportDocument[] = [];
    const assets: ReadyImportAsset[] = [];
    const finalized: FinalizedImportSnapshotEntry[] = [];
    const extraChanges: ImportPreviewChange[] = [];

    for (const entry of kept.sort((left, right) => compareImportText(left.sourcePath ?? left.staged.clientRelativePath, right.sourcePath ?? right.staged.clientRelativePath) || compareImportText(left.staged.uploadKey, right.staged.uploadKey))) {
      let row = finalizedBase(entry);
      if (entry.staged.entryType === "DOCUMENT") {
        if (!hasBlocker(entry.diagnostics) && entry.sourcePath !== null && entry.staged.rawMarkdown !== null && entry.staged.sourceFileHash !== null) {
          try {
            const parsed = parseGenericMarkdownText({ sourcePath: entry.sourcePath, text: entry.staged.rawMarkdown, sourceFileHash: entry.staged.sourceFileHash });
            const diagnostics = [...entry.diagnostics, ...parsed.diagnostics];
            if (new TextEncoder().encode(JSON.stringify(parsed.metadata)).byteLength > this.limits.maxMetadataBytes) {
              diagnostics.push(blocker("METADATA_TOO_LARGE", entry.sourcePath, "Parsed frontmatter metadata exceeds the configured byte limit."));
            }
            const titleTooLong = Array.from(parsed.resolvedTitle).length > MAX_RESOLVED_TITLE_CHARS;
            if (titleTooLong) {
              diagnostics.push(blocker("TITLE_TOO_LONG", entry.sourcePath, `Resolved title exceeds the ${MAX_RESOLVED_TITLE_CHARS}-character storage limit; shorten the frontmatter title or H1.`));
            }
            entry.diagnostics = diagnostics;
            row = {
              ...row,
              resolvedTitle: titleTooLong ? null : parsed.resolvedTitle,
              titleSource: titleTooLong ? null : parsed.titleSource,
              markdown: parsed.markdown,
              metadata: parsed.metadata,
              revisionContentHash: parsed.revisionContentHash,
              reconciliationFingerprint: parsed.reconciliationFingerprint,
              diagnostics,
            };
            if (!hasBlocker(diagnostics)) {
              documents.push({
                sourcePath: parsed.sourcePath,
                externalId: null,
                title: parsed.resolvedTitle,
                markdown: parsed.markdown,
                metadata: parsed.metadata,
                revisionContentHash: parsed.revisionContentHash,
                reconciliationFingerprint: parsed.reconciliationFingerprint,
                diagnostics,
              });
            }
          } catch (error) {
            if (!(error instanceof SourceImportError)) throw error;
            entry.diagnostics.push(blocker(error.code, entry.sourcePath, error.message));
            row = { ...row, diagnostics: [...entry.diagnostics] };
          }
        }
        if (hasBlocker(entry.diagnostics)) extraChanges.push(diagnosticChange(entry));
      } else {
        if (!hasBlocker(entry.diagnostics) && entry.sourcePath !== null && entry.sourcePathHash !== null && entry.staged.assetContentHash !== null) {
          const metadata = {
            size: entry.staged.assetSize,
            lastModified: entry.staged.assetLastModified?.toISOString() ?? null,
          };
          assets.push({
            sourcePath: entry.sourcePath,
            sourcePathHash: entry.sourcePathHash,
            contentHash: entry.staged.assetContentHash,
            mimeType: entry.staged.mimeType,
            metadata,
            diagnostics: [...entry.diagnostics],
          });
          row = { ...row, metadata };
        }
        if (hasBlocker(entry.diagnostics)) extraChanges.push(diagnosticChange(entry));
      }
      finalized.push(row);
    }

    const content: ReadyImportContent = {
      sourceBinding: { workspaceId: snapshot.workspaceId, sourceId: snapshot.sourceId, basedOnVersion: snapshot.basedOnVersion },
      documents,
      assets,
    };

    let plan;
    try {
      const current = snapshot.sourceId === null
        ? { documents: [], folders: [], assets: [] }
        : await repositories.importCanonicalState.load(snapshot.sourceId);
      plan = reconcileImportSnapshot(content, current, extraChanges);
    } catch (error) {
      if (!(error instanceof SourceImportError)) throw error;
      const globalChange: ImportPreviewChange = {
        kind: "FOLDER",
        sourcePath: snapshot.rootName,
        previousPath: null,
        labels: [],
        diagnostics: [blocker(
          error.code === "CANONICAL_PATH_CONFLICT" ? "CANONICAL_SOURCE_PATH_CONFLICT" : error.code,
          null,
          error.message,
        )],
      };
      plan = blockedImportPlan(content, [...extraChanges, globalChange]);
    }

    const previewByPath = new Map(plan.preview.map((change) => [change.sourcePath, change]));
    const persistedEntries = finalized.map((entry) => ({ ...entry, previewChange: entry.sourcePath === null ? null : (previewByPath.get(entry.sourcePath) ?? null) }));
    const snapshotHash = hashReadyImportSnapshot(snapshot, persistedEntries);
    const planHash = hashImportPlan(plan);
    const expiresAt = new Date(now.getTime() + this.readyTtlMs);
    const hasBlockers = plan.summary.blockers > 0;

    const activeReady = await repositories.importSnapshots.countActiveByCreatorAndState(caller.identity.id, "READY", now);
    if (activeReady >= this.limits.maxReadySnapshotsPerUser) {
      throw importError("IMPORT_READY_QUOTA_EXCEEDED", "Too many active READY import snapshots.");
    }

    await repositories.importSnapshotEntries.replaceFinalizedEntries(snapshot.id, persistedEntries);
    await repositories.importSnapshots.markReady({
      snapshotId: snapshot.id,
      snapshotHash,
      planHash,
      summary: plan.summary,
      plan,
      hasBlockers,
      finalizedAt: now,
      expiresAt,
    });

    const ready: ImportSnapshot = {
      ...snapshot,
      state: "READY",
      snapshotHash,
      planHash,
      summary: plan.summary,
      plan,
      hasBlockers,
      finalizedAt: now,
      expiresAt,
    };
    return previewFromSnapshot(ready, now);
  }
}
