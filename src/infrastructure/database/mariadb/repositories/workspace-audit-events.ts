import { IntegrityViolationError } from "@/modules/knowledge/domain/errors";
import type { WorkspaceAuditActorKind, WorkspaceAuditEvent } from "@/modules/workspaces/domain/workspace-audit-event";
import type { WorkspaceAuditEventRepository } from "@/modules/workspaces/ports/workspace-audit-event-repository";
import type { DbRow, QueryConnection } from "./shared";
import { asDate, asJsonObject, asRequiredString } from "./shared";

function asActorKind(value: unknown): WorkspaceAuditActorKind {
  if (value === "USER" || value === "SYSTEM") return value;
  throw new IntegrityViolationError("Database returned an invalid audit actor kind.");
}

function asPayload(value: unknown): unknown {
  if (value === null || typeof value === "undefined") return null;
  if (typeof value === "string") {
    if (value.length === 0) return null;
    return asJsonObject(value, "audit payload");
  }
  if (typeof value === "object") return value;
  throw new IntegrityViolationError("Database returned an invalid audit payload.");
}

function asNullableUuid(value: unknown): string | null {
  if (value === null || typeof value === "undefined") return null;
  return String(value);
}

function toPayloadJson(payload: unknown): string | null {
  if (payload === null || typeof payload === "undefined") return null;
  return JSON.stringify(payload);
}

function mapAuditEvent(row: DbRow): WorkspaceAuditEvent {
  return {
    id: asRequiredString(row.id, "audit event id"),
    workspaceId: asRequiredString(row.workspace_id, "audit event workspace"),
    actorUserId: asNullableUuid(row.actor_user_id),
    actorKind: asActorKind(row.actor_kind),
    eventType: asRequiredString(row.event_type, "audit event type"),
    targetType: row.target_type === null || typeof row.target_type === "undefined" ? null : String(row.target_type),
    targetId: asNullableUuid(row.target_id),
    payload: asPayload(row.payload),
    correlationId: asNullableUuid(row.correlation_id),
    createdAt: asDate(row.created_at),
  };
}

export class MariaDbWorkspaceAuditEventRepository implements WorkspaceAuditEventRepository {
  constructor(private readonly connection: QueryConnection) {}

  async append(event: WorkspaceAuditEvent): Promise<void> {
    await this.connection.query(
      `INSERT INTO workspace_audit_events (id, workspace_id, actor_user_id, actor_kind, event_type, target_type, target_id, payload, correlation_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        event.id, event.workspaceId, event.actorUserId, event.actorKind, event.eventType,
        event.targetType, event.targetId, toPayloadJson(event.payload), event.correlationId, event.createdAt,
      ],
    );
  }

  async listByWorkspace(workspaceId: string): Promise<WorkspaceAuditEvent[]> {
    const rows = await this.connection.query<DbRow[]>(
      "SELECT * FROM workspace_audit_events WHERE workspace_id = ? ORDER BY created_at, id",
      [workspaceId],
    );
    return rows.map(mapAuditEvent);
  }
}
