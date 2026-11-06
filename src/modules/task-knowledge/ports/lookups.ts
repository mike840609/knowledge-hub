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

/** `title` is the current revision's title; null before a document has one. */
export type TaskDocumentState = { documentId: string; sourceId: string; status: "ACTIVE" | "ARCHIVED"; title: string | null };

export type TaskEntryMatch = { kind: "FOUND"; candidates: { documentId: string }[] } | { kind: "INVALID_PATH" };

/** Share mode only: task-knowledge writers never take the Workspace FOR UPDATE. */
export interface TaskWorkspaceLookup {
  lockSharedById(workspaceId: string): Promise<TaskWorkspaceState | null>;
}

export interface TaskSourceLookup {
  getById(sourceId: string): Promise<TaskSourceState | null>;
}

export interface TaskEntryLookup {
  /**
   * Normalizes `rawPath` exactly as Folder Sync did and compares byte-exactly,
   * across the Workspace's ACTIVE FOLDER_SYNC Sources; ACTIVE document entries only.
   */
  findActiveEntriesByPath(workspaceId: string, rawPath: string): Promise<TaskEntryMatch>;
}

export interface TaskDocumentLookup {
  getState(documentId: string): Promise<TaskDocumentState | null>;
}
