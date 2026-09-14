import type { UserRepository } from "@/modules/identity/ports/user-repository";
import type { DocumentRepository } from "./document-repository";
import type { LinkedEntryRepository } from "./linked-entry";
import type { RevisionRepository } from "./revision-repository";
import type { SourcePolicyPort } from "./source-policy";
import type { TreeRepository } from "./tree-repository";
import type { WorkspaceAccessPolicy } from "@/modules/workspaces/ports/workspace-access-policy";
import type { WorkspaceMembershipRepository } from "@/modules/workspaces/ports/workspace-membership-repository";
import type { WorkspaceRepository } from "@/modules/workspaces/ports/workspace-repository";

export type KnowledgeRepositories = {
  users: UserRepository;
  documents: DocumentRepository;
  revisions: RevisionRepository;
  tree: TreeRepository;
  linkedEntries: LinkedEntryRepository;
  sourcePolicy: SourcePolicyPort;
  /**
   * Phase 3 §14.2: every Hub content mutation holds the parent Workspace
   * row FOR UPDATE before writing. The MariaDB implementation already
   * supplies this repository at runtime; the port makes it available to
   * the shared Tree preamble.
   */
  workspaces: WorkspaceRepository;
  workspaceAccess: WorkspaceAccessPolicy;
  /**
   * Phase 3 §9 direct-role write gate: content/import writers revalidate the
   * caller's direct role on the same locked connection. The MariaDB
   * implementation already supplies this repository at runtime (same T5/T6
   * precedent as `workspaces` above); the port makes it available to the
   * mutation guard.
   */
  workspaceMemberships: WorkspaceMembershipRepository;
};

export interface KnowledgeUnitOfWork {
  run<T>(work: (repositories: KnowledgeRepositories) => Promise<T>): Promise<T>;
}
