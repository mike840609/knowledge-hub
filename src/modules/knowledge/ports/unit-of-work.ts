import type { UserRepository } from "@/modules/identity/ports/user-repository";
import type { DocumentRepository } from "./document-repository";
import type { RevisionRepository } from "./revision-repository";
import type { SourcePolicyPort } from "./source-policy";
import type { TreeRepository } from "./tree-repository";
import type { WorkspaceRepository } from "@/modules/workspaces/ports/workspace-repository";
import type { WorkspaceAccessPolicy } from "@/modules/workspaces/ports/workspace-access-policy";
import type { WorkspaceMembershipRepository } from "@/modules/workspaces/ports/workspace-membership-repository";

export type KnowledgeRepositories = {
  users: UserRepository;
  documents: DocumentRepository;
  revisions: RevisionRepository;
  tree: TreeRepository;
  sourcePolicy: SourcePolicyPort;
  workspaces: WorkspaceRepository;
  workspaceMemberships: WorkspaceMembershipRepository;
  workspaceAccess: WorkspaceAccessPolicy;
};

export interface KnowledgeUnitOfWork {
  run<T>(work: (repositories: KnowledgeRepositories) => Promise<T>): Promise<T>;
}
