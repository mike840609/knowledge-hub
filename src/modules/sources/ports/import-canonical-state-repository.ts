import type { CanonicalImportState } from "../domain/import-plan";

export interface ImportCanonicalStateRepository {
  load(sourceId: string): Promise<CanonicalImportState>;
}
