import type { TaskReferenceInput } from "../domain/task-references";

export type ExportBindingStatus = "ACTIVE" | "REVOKED";
export type ExportCredentialStatus = "ACTIVE" | "REVOKED";
export type TaskLifecycle = "ACTIVE" | "ARCHIVED";
export type ReferenceResolution = "RESOLVED" | "UNRESOLVED" | "AMBIGUOUS" | "UNAVAILABLE";

export type ExportBinding = {
  id: string;
  ownerUserId: string;
  sourceId: string;
  label: string;
  status: ExportBindingStatus;
  createdAt: Date;
  revokedAt: Date | null;
};

/** What the owner sees in a list: never credential material. */
export type ExportBindingSummary = {
  bindingId: string;
  sourceId: string;
  sourceName: string;
  label: string;
  status: ExportBindingStatus;
  hasActiveCredential: boolean;
  createdAt: Date;
  revokedAt: Date | null;
};

export type ExportCredential = { id: string; bindingId: string; status: ExportCredentialStatus };

export type TaskResultRow = {
  id: string;
  bindingId: string;
  taskId: string;
  lifecycle: TaskLifecycle;
  latestRevisionNo: number;
  archivedBy: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type TaskRevisionRow = {
  taskResultId: string;
  revisionNo: number;
  artifactJson: string;
  contentHash: string;
  createdAt: Date;
};

/** WIKI references carry a resolution; external ones never do. */
export type StoredTaskReference = {
  ordinal: number;
  reference: TaskReferenceInput;
  resolution: ReferenceResolution | null;
  resolvedDocumentId: string | null;
};

/** A task with what its list row shows: the binding and the latest revision's artifact. */
export type TaskListRow = { task: TaskResultRow; bindingLabel: string; bindingStatus: ExportBindingStatus; artifactJson: string };

/** A task with its binding and the Workspace derived through the binding's Source. */
export type TaskScope = { task: TaskResultRow; binding: ExportBinding; workspaceId: string };

export interface TaskExportStore {
  insertBinding(binding: { id: string; ownerUserId: string; sourceId: string; label: string }): Promise<void>;
  getBinding(bindingId: string): Promise<ExportBinding | null>;
  lockBindingShared(bindingId: string): Promise<ExportBinding | null>;
  lockBindingForUpdate(bindingId: string): Promise<ExportBinding | null>;
  revokeBinding(bindingId: string): Promise<void>;
  /** The owner's bindings whose Source lies in `workspaceId` (Workspace derived through the Source). */
  listBindings(ownerUserId: string, workspaceId: string): Promise<ExportBindingSummary[]>;

  insertCredential(credential: { id: string; bindingId: string; tokenHash: Uint8Array }): Promise<void>;
  /** Revokes the active credential and inserts the new one; callers run it inside one transaction. */
  rotateCredential(bindingId: string, credential: { id: string; tokenHash: Uint8Array }): Promise<void>;
  findCredentialByHash(tokenHash: Uint8Array): Promise<ExportCredential | null>;
  revokeCredentialsForBinding(bindingId: string): Promise<void>;

  findTask(bindingId: string, taskId: string): Promise<TaskResultRow | null>;
  lockTaskForUpdate(taskResultId: string): Promise<TaskResultRow | null>;
  /** Returns the row's id whether it was inserted now or already existed; never throws on the unique key. */
  insertTaskIfAbsent(task: { id: string; bindingId: string; taskId: string }): Promise<string>;
  /** Only ever raises the stored latest revision. */
  advanceLatestRevision(taskResultId: string, revisionNo: number): Promise<void>;
  getRevision(taskResultId: string, revisionNo: number): Promise<TaskRevisionRow | null>;
  insertRevision(revision: { id: string; taskResultId: string; revisionNo: number; artifactJson: string; contentHash: string }): Promise<void>;
  insertReferences(taskResultId: string, revisionNo: number, references: readonly StoredTaskReference[]): Promise<void>;
  listReferences(taskResultId: string, revisionNo: number): Promise<StoredTaskReference[]>;

  /** Tasks whose binding's Source lies in `workspaceId`, newest first, ids below `beforeId` when given. */
  listTasks(workspaceId: string, query: { lifecycle: TaskLifecycle; beforeId: string | null; limit: number }): Promise<TaskListRow[]>;
  getTaskScope(taskResultId: string): Promise<TaskScope | null>;
  /** Newest first. */
  listRevisions(taskResultId: string): Promise<{ revisionNo: number; createdAt: Date }[]>;
  setTaskLifecycle(taskResultId: string, lifecycle: TaskLifecycle, actorUserId: string): Promise<void>;
}
