/**
 * Append-only governance audit event. The application never provides
 * UPDATE/DELETE for audit rows; every governance mutation appends its event
 * in the same transaction (enforced from Task 5 onward).
 */
export type WorkspaceAuditActorKind = "USER" | "SYSTEM";

export type WorkspaceAuditEvent = {
  id: string;
  workspaceId: string;
  actorUserId: string | null;
  actorKind: WorkspaceAuditActorKind;
  eventType: string;
  targetType: string | null;
  targetId: string | null;
  payload: unknown;
  correlationId: string | null;
  createdAt: Date;
};
