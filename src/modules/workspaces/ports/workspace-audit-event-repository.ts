import type { WorkspaceAuditEvent } from "../domain/workspace-audit-event";

export interface WorkspaceAuditEventRepository {
  /** Append-only: no update/delete API exists by design (spec §16). */
  append(event: WorkspaceAuditEvent): Promise<void>;
  listPage(workspaceId: string, cursor: string | undefined, limit: number): Promise<WorkspaceAuditEvent[]>;
  listByWorkspace(workspaceId: string): Promise<WorkspaceAuditEvent[]>;
}
