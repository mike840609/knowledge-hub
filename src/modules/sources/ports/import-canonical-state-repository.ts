import type { CanonicalDocumentLocation, CanonicalImportState } from "../domain/import-plan";

export interface ImportCanonicalStateRepository {
  load(sourceId: string): Promise<CanonicalImportState>;
  /**
   * Identity, path and lifecycle only. Display-only publication notices use
   * this so a preview/apply response never re-reads every Markdown body.
   */
  listDocumentLocations(sourceId: string): Promise<CanonicalDocumentLocation[]>;
}
