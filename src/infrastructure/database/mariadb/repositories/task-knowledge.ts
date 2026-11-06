import { DomainError } from "@/shared/domain/errors";
import { normalizeImportPath } from "@/modules/sources/domain/import-path";
import { IntegrityError } from "@/modules/knowledge/domain/errors";
import type { TaskReferenceInput } from "@/modules/task-knowledge/domain/task-references";
import type { TaskSearchProjection } from "@/modules/task-knowledge/domain/task-search-projection";
import type { TaskSearchQuery } from "@/modules/task-knowledge/domain/task-search-query";
import type { TaskSearchCursor } from "@/modules/task-knowledge/domain/task-search-cursor";
import { TaskSearchUnavailableError } from "@/modules/task-knowledge/domain/task-errors";
import { buildTaskSearchSql } from "./task-search-sql";
import type {
  TaskDocumentLookup,
  TaskDocumentState,
  TaskEntryLookup,
  TaskEntryMatch,
  TaskSourceLookup,
  TaskSourceState,
  TaskWorkspaceLookup,
  TaskWorkspaceState,
} from "@/modules/task-knowledge/ports/lookups";
import type {
  ExportBinding,
  ExportBindingSummary,
  ExportCredential,
  ReferenceResolution,
  StoredTaskReference,
  TaskExportStore,
  TaskLifecycle,
  TaskListRow,
  TaskSearchRow,
  TaskResultRow,
  TaskRevisionRow,
  TaskScope,
} from "@/modules/task-knowledge/ports/task-export-store";
import type { TaskKnowledgeRepositories } from "@/modules/task-knowledge/ports/unit-of-work";
import { uuidv7 } from "@/shared/ids/uuidv7";
import { asDate, asNullableDate, asNumber, type DbRow, type QueryConnection } from "./shared";

const asId = (value: unknown) => String(value);
const asNullableId = (value: unknown) => (value === null || value === undefined ? null : String(value));
/** Unlike sequence numbers, UTC epoch milliseconds can be negative (year 0000). */
function signedEpochMillis(value: unknown): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new IntegrityError("Database returned an invalid completed timestamp.");
  return n;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) throw new IntegrityError(`Database returned an invalid ${field}.`);
  return value as T;
}

function mapBinding(row: DbRow): ExportBinding {
  return {
    id: asId(row.id),
    ownerUserId: asId(row.owner_user_id),
    workspaceId: asId(row.workspace_id),
    label: String(row.label),
    status: oneOf(row.status, ["ACTIVE", "REVOKED"] as const, "binding status"),
    createdAt: asDate(row.created_at),
    revokedAt: asNullableDate(row.revoked_at),
  };
}

function mapTask(row: DbRow): TaskResultRow {
  return {
    id: asId(row.id),
    bindingId: asId(row.binding_id),
    taskId: String(row.task_id),
    lifecycle: oneOf(row.lifecycle, ["ACTIVE", "ARCHIVED"] as const, "task lifecycle"),
    latestRevisionNo: asNumber(row.latest_revision_no, "latest revision"),
    archivedBy: asNullableId(row.archived_by),
    archivedAt: asNullableDate(row.archived_at),
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
  };
}

type StoredType = "WIKI_PATH" | "WIKI_DOCUMENT" | "CODE_FILE" | "COMMIT" | "PR_URL";

function toStored(reference: TaskReferenceInput): { type: StoredType; locator: string } {
  if (reference.type === "WIKI") {
    return "path" in reference ? { type: "WIKI_PATH", locator: reference.path } : { type: "WIKI_DOCUMENT", locator: reference.documentId };
  }
  if (reference.type === "COMMIT") return { type: "COMMIT", locator: reference.id };
  if (reference.type === "PR_URL") return { type: "PR_URL", locator: reference.url };
  return { type: "CODE_FILE", locator: reference.path };
}

function fromStored(type: StoredType, locator: string): TaskReferenceInput {
  if (type === "WIKI_PATH") return { type: "WIKI", path: locator };
  if (type === "WIKI_DOCUMENT") return { type: "WIKI", documentId: locator };
  if (type === "COMMIT") return { type, id: locator };
  if (type === "PR_URL") return { type, url: locator };
  return { type, path: locator };
}

export class MariaDbTaskExportStore implements TaskExportStore {
  constructor(private readonly connection: QueryConnection) {}

  async insertBinding(binding: { id: string; ownerUserId: string; workspaceId: string; label: string }): Promise<void> {
    await this.connection.query("INSERT INTO task_export_bindings (id, owner_user_id, workspace_id, label) VALUES (?, ?, ?, ?)", [
      binding.id, binding.ownerUserId, binding.workspaceId, binding.label,
    ]);
  }

  private async binding(sql: string, bindingId: string): Promise<ExportBinding | null> {
    const rows = await this.connection.query<DbRow[]>(sql, [bindingId]);
    return rows[0] ? mapBinding(rows[0]) : null;
  }

  getBinding(bindingId: string) {
    return this.binding("SELECT * FROM task_export_bindings WHERE id = ?", bindingId);
  }

  lockBindingShared(bindingId: string) {
    return this.binding("SELECT * FROM task_export_bindings WHERE id = ? LOCK IN SHARE MODE", bindingId);
  }

  lockBindingForUpdate(bindingId: string) {
    return this.binding("SELECT * FROM task_export_bindings WHERE id = ? FOR UPDATE", bindingId);
  }

  async revokeBinding(bindingId: string): Promise<void> {
    await this.connection.query(
      "UPDATE task_export_bindings SET status = 'REVOKED', revoked_at = CURRENT_TIMESTAMP(6) WHERE id = ? AND status = 'ACTIVE'",
      [bindingId],
    );
  }

  async listBindings(ownerUserId: string, workspaceId: string): Promise<ExportBindingSummary[]> {
    const rows = await this.connection.query<DbRow[]>(
      `SELECT b.*,
          EXISTS (SELECT 1 FROM task_export_credentials c WHERE c.binding_id = b.id AND c.status = 'ACTIVE') AS has_active
        FROM task_export_bindings b
        WHERE b.owner_user_id = ? AND b.workspace_id = ?
        ORDER BY b.created_at DESC, b.id DESC`,
      [ownerUserId, workspaceId],
    );
    return rows.map((row) => {
      const binding = mapBinding(row);
      return {
        bindingId: binding.id, label: binding.label,
        status: binding.status, hasActiveCredential: Number(row.has_active) === 1, createdAt: binding.createdAt, revokedAt: binding.revokedAt,
      };
    });
  }

  async insertCredential(credential: { id: string; bindingId: string; tokenHash: Uint8Array }): Promise<void> {
    await this.connection.query("INSERT INTO task_export_credentials (id, binding_id, token_hash) VALUES (?, ?, ?)", [
      credential.id, credential.bindingId, Buffer.from(credential.tokenHash),
    ]);
  }

  async rotateCredential(bindingId: string, credential: { id: string; tokenHash: Uint8Array }): Promise<void> {
    await this.revokeCredentialsForBinding(bindingId);
    await this.insertCredential({ ...credential, bindingId });
  }

  async findCredentialByHash(tokenHash: Uint8Array): Promise<ExportCredential | null> {
    const rows = await this.connection.query<DbRow[]>("SELECT id, binding_id, status FROM task_export_credentials WHERE token_hash = ?", [
      Buffer.from(tokenHash),
    ]);
    const row = rows[0];
    if (!row) return null;
    return { id: asId(row.id), bindingId: asId(row.binding_id), status: oneOf(row.status, ["ACTIVE", "REVOKED"] as const, "credential status") };
  }

  async revokeCredentialsForBinding(bindingId: string): Promise<void> {
    await this.connection.query(
      "UPDATE task_export_credentials SET status = 'REVOKED', revoked_at = CURRENT_TIMESTAMP(6) WHERE binding_id = ? AND status = 'ACTIVE'",
      [bindingId],
    );
  }

  async findTask(bindingId: string, taskId: string): Promise<TaskResultRow | null> {
    const rows = await this.connection.query<DbRow[]>("SELECT * FROM task_results WHERE binding_id = ? AND task_id = ?", [bindingId, taskId]);
    return rows[0] ? mapTask(rows[0]) : null;
  }

  async lockTaskForUpdate(taskResultId: string): Promise<TaskResultRow | null> {
    const rows = await this.connection.query<DbRow[]>("SELECT * FROM task_results WHERE id = ? FOR UPDATE", [taskResultId]);
    return rows[0] ? mapTask(rows[0]) : null;
  }

  async insertTaskIfAbsent(task: { id: string; bindingId: string; taskId: string }): Promise<string> {
    // foundRows is on, so affectedRows cannot tell an insert from an existing row; read the id back instead.
    await this.connection.query("INSERT INTO task_results (id, binding_id, task_id) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE id = id", [
      task.id, task.bindingId, task.taskId,
    ]);
    const rows = await this.connection.query<DbRow[]>("SELECT id FROM task_results WHERE binding_id = ? AND task_id = ?", [task.bindingId, task.taskId]);
    if (!rows[0]) throw new IntegrityError("Task result row vanished after insert.");
    return asId(rows[0].id);
  }

  async advanceLatestRevision(taskResultId: string, revisionNo: number): Promise<void> {
    await this.connection.query(
      "UPDATE task_results SET latest_revision_no = ?, updated_at = CURRENT_TIMESTAMP(6) WHERE id = ? AND latest_revision_no < ?",
      [revisionNo, taskResultId, revisionNo],
    );
  }

  async getRevision(taskResultId: string, revisionNo: number): Promise<TaskRevisionRow | null> {
    const rows = await this.connection.query<DbRow[]>(
      "SELECT task_result_id, revision_no, artifact_json, content_hash, created_at FROM task_result_revisions WHERE task_result_id = ? AND revision_no = ?",
      [taskResultId, revisionNo],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      taskResultId: asId(row.task_result_id),
      revisionNo: asNumber(row.revision_no, "revision number"),
      artifactJson: String(row.artifact_json),
      contentHash: String(row.content_hash),
      createdAt: asDate(row.created_at),
    };
  }

  async insertRevision(revision: { id: string; taskResultId: string; revisionNo: number; artifactJson: string; contentHash: string }): Promise<void> {
    await this.connection.query(
      "INSERT INTO task_result_revisions (id, task_result_id, revision_no, artifact_json, content_hash) VALUES (?, ?, ?, ?, ?)",
      [revision.id, revision.taskResultId, revision.revisionNo, revision.artifactJson, revision.contentHash],
    );
  }

  async insertReferences(taskResultId: string, revisionNo: number, references: readonly StoredTaskReference[]): Promise<void> {
    for (const item of references) {
      const { type, locator } = toStored(item.reference);
      await this.connection.query(
        "INSERT INTO task_result_references (id, task_result_id, revision_no, ordinal, reference_type, locator, resolution, resolved_document_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [uuidv7(), taskResultId, revisionNo, item.ordinal, type, locator, item.resolution, item.resolvedDocumentId],
      );
    }
  }

  /** An older backfill snapshot may never replace a newer atomic ingest. */
  async upsertSearchProjection(projection: TaskSearchProjection): Promise<void> {
    await this.connection.query(
      "INSERT INTO task_result_search (task_result_id, revision_no, completed_at_epoch_ms, agent, verification_status, title, summary, search_body) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?) " +
      "ON DUPLICATE KEY UPDATE " +
      "completed_at_epoch_ms = IF(VALUES(revision_no) >= revision_no, VALUES(completed_at_epoch_ms), completed_at_epoch_ms), " +
      "agent = IF(VALUES(revision_no) >= revision_no, VALUES(agent), agent), " +
      "verification_status = IF(VALUES(revision_no) >= revision_no, VALUES(verification_status), verification_status), " +
      "title = IF(VALUES(revision_no) >= revision_no, VALUES(title), title), " +
      "summary = IF(VALUES(revision_no) >= revision_no, VALUES(summary), summary), " +
      "search_body = IF(VALUES(revision_no) >= revision_no, VALUES(search_body), search_body), " +
      "revision_no = GREATEST(revision_no, VALUES(revision_no))",
      [
        projection.taskResultId, projection.revisionNo, projection.completedAtEpochMs,
        projection.agent, projection.verificationStatus, projection.title, projection.summary, projection.searchBody,
      ],
    );
  }

  async listReferences(taskResultId: string, revisionNo: number): Promise<StoredTaskReference[]> {
    const rows = await this.connection.query<DbRow[]>(
      "SELECT ordinal, reference_type, locator, resolution, resolved_document_id FROM task_result_references WHERE task_result_id = ? AND revision_no = ? ORDER BY ordinal",
      [taskResultId, revisionNo],
    );
    return rows.map((row) => ({
      ordinal: asNumber(row.ordinal, "reference ordinal"),
      reference: fromStored(oneOf(row.reference_type, ["WIKI_PATH", "WIKI_DOCUMENT", "CODE_FILE", "COMMIT", "PR_URL"] as const, "reference type"), String(row.locator)),
      resolution: row.resolution === null ? null : oneOf(row.resolution, ["RESOLVED", "UNRESOLVED", "AMBIGUOUS", "UNAVAILABLE"] as const satisfies readonly ReferenceResolution[], "reference resolution"),
      resolvedDocumentId: asNullableId(row.resolved_document_id),
    }));
  }

  async listTasks(workspaceId: string, query: { lifecycle: TaskLifecycle; beforeId: string | null; limit: number }): Promise<TaskListRow[]> {
    // ids are UUIDv7, so id order is creation order and a keyset cursor.
    const rows = await this.connection.query<DbRow[]>(
      `SELECT t.*, b.label AS binding_label, b.status AS binding_status, r.artifact_json
        FROM task_results t
        JOIN task_export_bindings b ON b.id = t.binding_id
        JOIN task_result_revisions r ON r.task_result_id = t.id AND r.revision_no = t.latest_revision_no
        WHERE b.workspace_id = ? AND t.lifecycle = ? AND (? IS NULL OR t.id < ?)
        ORDER BY t.id DESC LIMIT ?`,
      [workspaceId, query.lifecycle, query.beforeId, query.beforeId, query.limit],
    );
    return rows.map((row) => ({
      task: mapTask(row),
      bindingLabel: String(row.binding_label),
      bindingStatus: oneOf(row.binding_status, ["ACTIVE", "REVOKED"] as const, "binding status"),
      artifactJson: String(row.artifact_json),
    }));
  }

  async searchTasks(
    workspaceId: string, ownerUserId: string, query: TaskSearchQuery,
    cursor: TaskSearchCursor | null, limit: number,
  ): Promise<TaskSearchRow[]> {
    const { sql, params } = buildTaskSearchSql(workspaceId, ownerUserId, query, cursor, limit);
    let rows: DbRow[];
    try {
      rows = await this.connection.query<DbRow[]>(sql, params);
    } catch (error) {
      if (typeof error === "object" && error !== null && "errno" in error &&
          Number(error.errno) === 1969) throw new TaskSearchUnavailableError();
      throw error;
    }
    return rows.map((row) => ({
      taskResultId: asId(row.task_result_id),
      lifecycle: oneOf(row.lifecycle, ["ACTIVE", "ARCHIVED"] as const, "task lifecycle"),
      latestRevisionNo: asNumber(row.latest_revision_no, "latest revision"),
      bindingLabel: String(row.binding_label),
      bindingStatus: oneOf(row.binding_status, ["ACTIVE", "REVOKED"] as const, "binding status"),
      completedAtEpochMs: signedEpochMillis(row.completed_at_epoch_ms),
      agent: String(row.agent),
      verificationStatus: String(row.verification_status),
      title: String(row.title),
      summary: String(row.summary),
      searchBody: String(row.search_body),
    }));
  }

  async hasTasksInLifecycle(workspaceId: string, ownerUserId: string, lifecycle: TaskLifecycle): Promise<boolean> {
    try {
      const rows = await this.connection.query<DbRow[]>(
        `SET STATEMENT max_statement_time=5 FOR SELECT EXISTS (
          SELECT 1 FROM task_results t JOIN task_export_bindings b ON b.id = t.binding_id
          WHERE b.workspace_id = ? AND b.owner_user_id = ? AND t.lifecycle = ?
        ) AS has_tasks`,
        [workspaceId, ownerUserId, lifecycle],
      );
      return Number(rows[0]?.has_tasks ?? 0) === 1;
    } catch (error) {
      if (typeof error === "object" && error !== null && "errno" in error &&
          Number(error.errno) === 1969) throw new TaskSearchUnavailableError();
      throw error;
    }
  }

  async getTaskScope(taskResultId: string): Promise<TaskScope | null> {
    const rows = await this.connection.query<DbRow[]>(
      `SELECT t.*, b.id AS b_id, b.owner_user_id AS b_owner_user_id, b.workspace_id AS b_workspace_id, b.label AS b_label,
          b.status AS b_status, b.created_at AS b_created_at, b.revoked_at AS b_revoked_at
        FROM task_results t JOIN task_export_bindings b ON b.id = t.binding_id
        WHERE t.id = ?`,
      [taskResultId],
    );
    const row = rows[0];
    if (!row) return null;
    const binding = mapBinding({
      id: row.b_id, owner_user_id: row.b_owner_user_id, workspace_id: row.b_workspace_id, label: row.b_label,
      status: row.b_status, created_at: row.b_created_at, revoked_at: row.b_revoked_at,
    });
    return { task: mapTask(row), binding };
  }

  async listRevisions(taskResultId: string): Promise<{ revisionNo: number; createdAt: Date }[]> {
    const rows = await this.connection.query<DbRow[]>(
      "SELECT revision_no, created_at FROM task_result_revisions WHERE task_result_id = ? ORDER BY revision_no DESC",
      [taskResultId],
    );
    return rows.map((row) => ({ revisionNo: asNumber(row.revision_no, "revision number"), createdAt: asDate(row.created_at) }));
  }

  async setTaskLifecycle(taskResultId: string, lifecycle: TaskLifecycle, actorUserId: string): Promise<void> {
    const archived = lifecycle === "ARCHIVED";
    await this.connection.query(
      "UPDATE task_results SET lifecycle = ?, archived_by = ?, archived_at = ?, updated_at = CURRENT_TIMESTAMP(6) WHERE id = ?",
      [lifecycle, archived ? actorUserId : null, archived ? new Date() : null, taskResultId],
    );
  }
}

const LIFECYCLE = ["ACTIVE", "ARCHIVED"] as const;

class MariaDbTaskWorkspaceLookup implements TaskWorkspaceLookup {
  constructor(private readonly connection: QueryConnection) {}

  async lockSharedById(workspaceId: string): Promise<TaskWorkspaceState | null> {
    // MariaDB 10.11 rejects FOR SHARE; share mode is the only lock this port takes.
    const rows = await this.connection.query<DbRow[]>(
      "SELECT id, workspace_type, lifecycle_state, personal_owner_user_id FROM workspaces WHERE id = ? LOCK IN SHARE MODE",
      [workspaceId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      workspaceId: asId(row.id),
      kind: oneOf(row.workspace_type, ["TEAM", "PERSONAL"] as const, "workspace type"),
      status: oneOf(row.lifecycle_state, LIFECYCLE, "workspace lifecycle"),
      ownerUserId: asNullableId(row.personal_owner_user_id),
    };
  }
}

function mapSource(row: DbRow): TaskSourceState {
  return {
    sourceId: asId(row.id),
    workspaceId: asId(row.workspace_id),
    sourceType: String(row.source_type),
    status: oneOf(row.status, LIFECYCLE, "source status"),
  };
}

class MariaDbTaskSourceLookup implements TaskSourceLookup {
  constructor(private readonly connection: QueryConnection) {}

  async getById(sourceId: string): Promise<TaskSourceState | null> {
    const rows = await this.connection.query<DbRow[]>("SELECT id, workspace_id, source_type, status FROM knowledge_sources WHERE id = ?", [sourceId]);
    return rows[0] ? mapSource(rows[0]) : null;
  }
}

class MariaDbTaskEntryLookup implements TaskEntryLookup {
  constructor(private readonly connection: QueryConnection) {}

  async findActiveEntriesByPath(workspaceId: string, rawPath: string): Promise<TaskEntryMatch> {
    let sourcePath: string;
    try {
      ({ sourcePath } = normalizeImportPath(rawPath));
    } catch (error) {
      // Folder Sync would never have stored this path, so nothing can match it.
      if (error instanceof DomainError) return { kind: "INVALID_PATH" };
      throw error;
    }
    const rows = await this.connection.query<DbRow[]>(
      `SELECT e.document_id FROM source_entries e JOIN knowledge_sources s ON s.id = e.source_id
        WHERE s.workspace_id = ? AND s.source_type = 'FOLDER_SYNC' AND s.status = 'ACTIVE'
          AND BINARY e.source_path = BINARY ? AND e.status = 'ACTIVE' AND e.entry_type = 'DOCUMENT'
        ORDER BY e.document_id`,
      [workspaceId, sourcePath],
    );
    return { kind: "FOUND", candidates: rows.map((row) => ({ documentId: asId(row.document_id) })) };
  }
}

class MariaDbTaskDocumentLookup implements TaskDocumentLookup {
  constructor(private readonly connection: QueryConnection) {}

  async getState(documentId: string): Promise<TaskDocumentState | null> {
    const rows = await this.connection.query<DbRow[]>(
      "SELECT d.id, d.source_id, d.status, r.title FROM knowledge_documents d LEFT JOIN knowledge_revisions r ON r.id = d.current_revision_id WHERE d.id = ?",
      [documentId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      documentId: asId(row.id), sourceId: asId(row.source_id), status: oneOf(row.status, LIFECYCLE, "document status"),
      title: row.title === null || row.title === undefined ? null : String(row.title),
    };
  }
}

export function createTaskKnowledgeRepositories(connection: QueryConnection): TaskKnowledgeRepositories {
  return {
    taskExports: new MariaDbTaskExportStore(connection),
    workspaces: new MariaDbTaskWorkspaceLookup(connection),
    sources: new MariaDbTaskSourceLookup(connection),
    entries: new MariaDbTaskEntryLookup(connection),
    documents: new MariaDbTaskDocumentLookup(connection),
  };
}
