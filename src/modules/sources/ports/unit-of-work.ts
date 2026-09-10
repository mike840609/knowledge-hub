import type { KnowledgeRepositories } from "@/modules/knowledge/ports/unit-of-work";
import type { AssetRepository } from "./asset-repository";
import type { EntryRepository } from "./entry-repository";
import type { SourceRepository } from "./source-repository";
import type { SyncRunRepository } from "./sync-run-repository";

import type { WorkspaceRepository } from "@/modules/workspaces/ports/workspace-repository";
import type { WorkspaceMembershipRepository } from "@/modules/workspaces/ports/workspace-membership-repository";

export type SourceRepositories = KnowledgeRepositories & {
  sources: SourceRepository;
  entries: EntryRepository;
  assets: AssetRepository;
  syncRuns: SyncRunRepository;
  workspaces: WorkspaceRepository;
  /**
   * Raw membership access stays available on the source context for
   * fixtures and membership administration. Application authorization
   * must go through `workspaceAccess`, never this repository.
   */
  workspaceMemberships: WorkspaceMembershipRepository;
};

export interface SourceUnitOfWork {
  run<T>(work: (repositories: SourceRepositories) => Promise<T>): Promise<T>;
}
