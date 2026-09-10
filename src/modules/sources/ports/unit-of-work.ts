import type { KnowledgeRepositories } from "@/modules/knowledge/ports/unit-of-work";
import type { AssetRepository } from "./asset-repository";
import type { EntryRepository } from "./entry-repository";
import type { SourceRepository } from "./source-repository";
import type { SyncRunRepository } from "./sync-run-repository";

export type SourceRepositories = KnowledgeRepositories & {
  sources: SourceRepository;
  entries: EntryRepository;
  assets: AssetRepository;
  syncRuns: SyncRunRepository;
};

export interface SourceUnitOfWork {
  run<T>(work: (repositories: SourceRepositories) => Promise<T>): Promise<T>;
}
