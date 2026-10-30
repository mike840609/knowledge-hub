import type {
  Contribution,
  DocumentBinding,
  PlannedMove,
  Publication,
  PublicationDocument,
  ReconcileReport,
} from "../domain/publication";

/**
 * Persistence for the publication mechanism. Names, workspace and lifecycle
 * are joined from `knowledge_sources` on every read — they are not stored
 * twice. Every method runs inside the caller's transaction; the mechanism
 * never opens a nested unit of work.
 */
export interface PublicationRepository {
  findById(id: string): Promise<Publication | null>;
  findBySourceId(sourceId: string): Promise<Publication | null>;
  listByTeam(teamId: string, includeArchived?: boolean): Promise<Publication[]>;
  insert(publication: Publication): Promise<void>;
  listContributions(publicationId: string): Promise<Contribution[]>;
  listByContributor(userId: string): Promise<Contribution[]>;
  insertContribution(contribution: Contribution): Promise<void>;
  setContributionState(
    id: string,
    state: Pick<Contribution, "leftAt" | "rightsFrozenAt" | "pendingCatchUp">,
  ): Promise<void>;
  listDocuments(publicationId: string): Promise<PublicationDocument[]>;
  listBindings(contributionId: string): Promise<DocumentBinding[]>;
  bind(binding: DocumentBinding): Promise<void>;
  /**
   * Forgets one contributor's remembered original. A reconciliation that moves
   * an original onto the creator's own archived copy uses this before
   * `repoint`, because one original may feed only one team document.
   */
  unbind(contributionId: string, originalDocumentId: string): Promise<void>;
  /** Reattaches a team document to a new original, replacing its creator binding only. */
  repoint(teamDocumentId: string, originalDocumentId: string): Promise<void>;
  insertDocument(document: PublicationDocument): Promise<void>;
  /**
   * Writes final paths for applied moves. The caller holds the publication
   * Source lock. Applied documents are cleared first so a legal swap is not
   * rejected row-by-row by the unique path index.
   */
  applyPaths(moves: readonly PlannedMove[]): Promise<void>;
  /** Archives/restores the publication source and keeps the claim keys in step. */
  setPublicationStatus(publicationId: string, status: "ACTIVE" | "ARCHIVED", actorId: string): Promise<void>;
  /**
   * Idempotently creates delivery rows for unconsumed events, targets that
   * have no affected contribution at all complete the event. Called only while
   * team publishing is enabled.
   */
  prepareDeliveries(limit: number): Promise<void>;
  listPendingEvents(userId?: string, limit?: number): Promise<{ eventId: string; contributionId: string }[]>;
  /** Marks one target done; the root event is consumed only when none remain. */
  completeDelivery(eventId: string, contributionId: string, outcome: "APPLIED" | "SKIPPED"): Promise<void>;
  saveReport(contributionId: string, report: ReconcileReport): Promise<void>;
  findReport(contributionId: string): Promise<ReconcileReport | null>;
}
