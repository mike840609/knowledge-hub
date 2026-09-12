import type { KnowledgeRepositories } from "@/modules/knowledge/ports/unit-of-work";
import type { AssetRepository } from "./asset-repository";
import type { EntryRepository } from "./entry-repository";
import type { SourceRepository } from "./source-repository";
import type { SyncRunRepository } from "./sync-run-repository";
import type { ImportSnapshotRepository } from "./import-snapshot-repository";
import type { ImportSnapshotEntryRepository } from "./import-snapshot-entry-repository";
import type { ImportCanonicalStateRepository } from "./import-canonical-state-repository";

import type { WorkspaceRepository } from "@/modules/workspaces/ports/workspace-repository";
import type { WorkspaceMembershipRepository } from "@/modules/workspaces/ports/workspace-membership-repository";

export type SourceRepositories = KnowledgeRepositories & {
  sources: SourceRepository;
  entries: EntryRepository;
  assets: AssetRepository;
  syncRuns: SyncRunRepository;
  importSnapshots: ImportSnapshotRepository;
  importSnapshotEntries: ImportSnapshotEntryRepository;
  importCanonicalState: ImportCanonicalStateRepository;
  workspaces: WorkspaceRepository;
  workspaceMemberships: WorkspaceMembershipRepository;
};

export interface SourceUnitOfWork {
  run<T>(work: (repositories: SourceRepositories) => Promise<T>): Promise<T>;
  /**
   * Serializes import quota checks per creator across the full transaction.
   * The creator lock is acquired on the backing connection before the
   * transaction begins and released only after commit/rollback, so a
   * concurrent quota check cannot pass on still-uncommitted state.
   */
  runWithCreatorQuotaLock<T>(
    creatorId: string,
    timeoutSeconds: number,
    work: (repositories: SourceRepositories) => Promise<T>,
  ): Promise<T>;
}
