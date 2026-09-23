import type { WorkspaceGroupMappingRepository } from "@/modules/workspaces/ports/workspace-group-mapping-repository";
import type { UserRepository } from "@/modules/identity/ports/user-repository";
import type { DocumentRepository } from "./document-repository";
import type { DocumentShareLinkRepository } from "./document-share-link-repository";
import type { KnowledgeSearchRepository } from "./knowledge-search-repository";
import type { LinkedEntryRepository } from "./linked-entry";
import type { RevisionRepository } from "./revision-repository";
import type { SourcePolicyPort } from "./source-policy";
import type { TreeRepository } from "./tree-repository";
import type { WorkspaceAccessPolicy } from "@/modules/workspaces/ports/workspace-access-policy";
import type { WorkspaceMembershipRepository } from "@/modules/workspaces/ports/workspace-membership-repository";
import type { WorkspaceRepository } from "@/modules/workspaces/ports/workspace-repository";
import type { WorkspaceAuditEventRepository } from "@/modules/workspaces/ports/workspace-audit-event-repository";

export type KnowledgeRepositories = {
  users: UserRepository;
  documents: DocumentRepository;
  revisions: RevisionRepository;
  tree: TreeRepository;
  linkedEntries: LinkedEntryRepository;
  sourcePolicy: SourcePolicyPort;
  /** Phase 4 keyword discovery; read-only and never used by mutation paths. */
  search: KnowledgeSearchRepository;
  /**
   * Phase 3 §14.2: every Hub content mutation holds the parent Workspace
   * row FOR UPDATE before writing. The MariaDB implementation already
   * supplies this repository at runtime; the port makes it available to
   * the shared Tree preamble.
   */
  workspaces: WorkspaceRepository;
  workspaceAccess: WorkspaceAccessPolicy;
  /** Current direct and group grants are re-read under the Workspace lock. */
  workspaceMemberships: WorkspaceMembershipRepository;
  groupMappings: WorkspaceGroupMappingRepository;
  shareLinks: DocumentShareLinkRepository;
  /** Share-link create/revoke append governance events in the same transaction (share-link spec §7.3). */
  auditEvents: WorkspaceAuditEventRepository;
};

export interface KnowledgeUnitOfWork {
  run<T>(work: (repositories: KnowledgeRepositories) => Promise<T>): Promise<T>;
}
