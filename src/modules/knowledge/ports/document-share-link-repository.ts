import type { DocumentShareLink } from "../domain/document-share-link";

export type ShareLinkViewTotals = { totalViews: number; lastViewedAt: Date | null };

export interface DocumentShareLinkRepository {
  insert(link: DocumentShareLink): Promise<void>;
  findByToken(token: string): Promise<DocumentShareLink | null>;
  lockById(id: string): Promise<DocumentShareLink | null>;
  /** Newest first, including revoked and expired links. */
  listByDocument(documentId: string): Promise<DocumentShareLink[]>;
  countActiveByDocument(documentId: string, now: Date): Promise<number>;
  /** Only an unrevoked link is revoked; revocation is final (spec §5.4). */
  revoke(id: string, revokedBy: string, revokedAt: Date): Promise<void>;
  viewTotals(linkIds: readonly string[]): Promise<Map<string, ShareLinkViewTotals>>;
  /** One row per link per UTC day; carries nothing about the viewer (spec §7.2). */
  recordView(linkId: string, at: Date): Promise<void>;
}
