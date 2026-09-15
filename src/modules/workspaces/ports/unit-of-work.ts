import type { UserRepository } from "@/modules/identity/ports/user-repository";
import type { ExternalIdentityLinkRepository } from "@/modules/identity/ports/external-identity-link-repository";
import type { WorkspaceRepository } from "./workspace-repository";
import type { WorkspaceMembershipRepository } from "./workspace-membership-repository";
import type { WorkspaceGroupMappingRepository } from "./workspace-group-mapping-repository";
import type { WorkspaceAuditEventRepository } from "./workspace-audit-event-repository";

export type WorkspaceRepositories = {
  users: UserRepository;
  workspaces: WorkspaceRepository;
  workspaceMemberships: WorkspaceMembershipRepository;
  groupMappings: WorkspaceGroupMappingRepository;
  auditEvents: WorkspaceAuditEventRepository;
  identityLinks: ExternalIdentityLinkRepository;
};

export interface WorkspaceUnitOfWork {
  run<T>(work: (repositories: WorkspaceRepositories) => Promise<T>): Promise<T>;
}
