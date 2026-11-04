import type { TaskDocumentLookup, TaskEntryLookup, TaskSourceLookup, TaskWorkspaceLookup } from "./lookups";
import type { TaskExportStore } from "./task-export-store";

export type TaskKnowledgeRepositories = {
  taskExports: TaskExportStore;
  workspaces: TaskWorkspaceLookup;
  sources: TaskSourceLookup;
  entries: TaskEntryLookup;
  documents: TaskDocumentLookup;
};

/** One connection and one READ COMMITTED transaction for every repository. */
export interface TaskKnowledgeUnitOfWork {
  run<T>(work: (repositories: TaskKnowledgeRepositories) => Promise<T>): Promise<T>;
}
