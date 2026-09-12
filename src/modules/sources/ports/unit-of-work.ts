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
}
