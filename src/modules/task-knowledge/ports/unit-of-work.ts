import type { TaskDocumentLookup, TaskEntryLookup, TaskSourceLookup, TaskUserLookup, TaskWorkspaceLookup } from "./lookups";
import type { TaskExportStore } from "./task-export-store";

export type TaskKnowledgeRepositories = {
  taskExports: TaskExportStore;
  workspaces: TaskWorkspaceLookup;
  sources: TaskSourceLookup;
  entries: TaskEntryLookup;
  documents: TaskDocumentLookup;
  users: TaskUserLookup;
};

/** One connection and one READ COMMITTED transaction for every repository. */
export interface TaskKnowledgeUnitOfWork {
  run<T>(work: (repositories: TaskKnowledgeRepositories) => Promise<T>): Promise<T>;
}
