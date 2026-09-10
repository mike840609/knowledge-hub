import type { Workspace } from "../domain/workspace";

export interface WorkspaceRepository {
  findById(workspaceId: string): Promise<Workspace | null>;
  listForUser(userId: string): Promise<Workspace[]>;
  insert(workspace: Workspace): Promise<void>;
}
