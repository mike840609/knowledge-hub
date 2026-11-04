/**
 * Local views of Workspace, Source, SourceEntry and Document state. The
 * module never imports `sources`; the infrastructure adapter implements these.
 */

export type TaskWorkspaceState = {
  workspaceId: string;
  kind: "TEAM" | "PERSONAL";
  status: "ACTIVE" | "ARCHIVED";
  ownerUserId: string | null;
};

export type TaskSourceState = {
  sourceId: string;
  workspaceId: string;
  sourceType: string;
  status: "ACTIVE" | "ARCHIVED";
};

export type TaskDocumentState = { documentId: string; sourceId: string; status: "ACTIVE" | "ARCHIVED" };

export type TaskEntryMatch = { kind: "FOUND"; candidates: { documentId: string }[] } | { kind: "INVALID_PATH" };

/** Share mode only: task-knowledge writers never take the Workspace FOR UPDATE. */
export interface TaskWorkspaceLookup {
  lockSharedById(workspaceId: string): Promise<TaskWorkspaceState | null>;
}

export interface TaskSourceLookup {
  getById(sourceId: string): Promise<TaskSourceState | null>;
  /** `LOCK IN SHARE MODE`; used only by binding create. */
  lockSharedById(sourceId: string): Promise<TaskSourceState | null>;
}

export interface TaskEntryLookup {
  /** Normalizes `rawPath` exactly as Folder Sync did and compares byte-exactly; ACTIVE document entries only. */
  findActiveEntriesByPath(sourceId: string, rawPath: string): Promise<TaskEntryMatch>;
}

export interface TaskDocumentLookup {
  getState(documentId: string): Promise<TaskDocumentState | null>;
}
