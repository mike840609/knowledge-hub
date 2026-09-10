import type { UserRepository } from "@/modules/identity/ports/user-repository";
import type { WorkspaceRepository } from "./workspace-repository";
import type { WorkspaceMembershipRepository } from "./workspace-membership-repository";

export type WorkspaceRepositories = {
  users: UserRepository;
  workspaces: WorkspaceRepository;
  workspaceMemberships: WorkspaceMembershipRepository;
};

export interface WorkspaceUnitOfWork {
  run<T>(work: (repositories: WorkspaceRepositories) => Promise<T>): Promise<T>;
}
