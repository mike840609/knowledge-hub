import type {
  Contribution,
  DocumentBinding,
  PlannedMove,
  Publication,
  PublicationDocument,
  PublicationDocumentView,
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
  /**
   * Every contribution with its publication, for the caller-less catch-up
   * repair script. Reconciliation itself decides lifecycle and rights; this
   * read must not pre-filter so left/archived rows are visibly skipped.
   */
  listAllContributions(): Promise<{ publicationId: string; contributionId: string }[]>;
  insertContribution(contribution: Contribution): Promise<void>;
  setContributionState(
    id: string,
    state: Pick<Contribution, "leftAt" | "rightsFrozenAt" | "pendingCatchUp">,
  ): Promise<void>;
  listDocuments(publicationId: string): Promise<PublicationDocument[]>;
  /**
   * The publication's team copies as the team tree lists them: path,
   * lifecycle, creator (the only person who may update it) and content time.
   * Names are joined from `users` so the tree never loads a personal origin.
   */
  listDocumentViews(publicationId: string): Promise<PublicationDocumentView[]>;
  /**
   * The newest `updated_at` among the publication's team documents, or null
   * when it has none (for example an empty publication). Content copies are
   * written without touching the publication source's timestamp, so this is
   * the read-side "updated" for a team list.
   */
  latestDocumentUpdatedAt(publicationId: string): Promise<Date | null>;
  /** The publication-side metadata of one team document, joined to its creator's contribution. */
  findDocument(teamDocumentId: string): Promise<{ creatorUserId: string; publicationId: string; sourcePath: string | null } | null>;
  listBindings(contributionId: string): Promise<DocumentBinding[]>;
  bind(binding: DocumentBinding): Promise<void>;
  /**
   * Forgets one contributor's remembered original inside one publication. A
   * reconciliation that moves an original onto the creator's own archived copy
   * uses this before `repoint`, because one original may feed only one team
   * document.
   */
  unbind(publicationId: string, contributionId: string, originalDocumentId: string): Promise<void>;
  /** Reattaches a team document to a new original, replacing its creator binding only. */
  repoint(teamDocumentId: string, originalDocumentId: string): Promise<void>;
  /**
   * The active claim on an original in a team, held by another publication.
   * `active_team_workspace_id` is non-null only while the publication source is
   * ACTIVE, so a returned row is a live claim.
   */
  findClaim(
    originalDocumentId: string,
    teamWorkspaceId: string,
    excludePublicationId: string,
  ): Promise<{ publicationId: string; publicationName: string } | null>;
  /**
   * Runs one claim attempt (create + bind, or repoint) inside a savepoint. A
   * `PUBLICATION_ORIGINAL_TAKEN` duplicate rolls back only that attempt, so one
   * losing original never aborts the contribution's other work.
   */
  runClaimAttempt<T>(work: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: Error }>;
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
  /**
   * Pending deliveries in event order. `publicationId` is joined from the
   * contribution so a drain can reconcile without a second lookup per row.
   * `respectBackoff` skips deliveries deferred by a worker (`next_attempt_at`),
   * but never hides them from the contributor's own caller-scoped retry.
   */
  listPendingEvents(
    userId?: string,
    limit?: number,
    now?: Date,
    respectBackoff?: boolean,
  ): Promise<{ eventId: string; contributionId: string; publicationId: string }[]>;
  /** Keeps a worker's unprocessable delivery out of the next bounded head window. */
  deferDelivery(eventId: string, contributionId: string, nextAttemptAt: Date): Promise<void>;
  /** Marks one target done; the root event is consumed only when none remain. */
  completeDelivery(eventId: string, contributionId: string, outcome: "APPLIED" | "SKIPPED"): Promise<void>;
  saveReport(contributionId: string, report: ReconcileReport): Promise<void>;
  findReport(contributionId: string): Promise<ReconcileReport | null>;
}
