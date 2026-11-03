import type { ProposalParty, ShareProposal, ShareProposalStatus } from "../domain/share-proposal";

export type NewShareProposal = Omit<ShareProposal, "status" | "decidedBy" | "decidedAt" | "ownerReadAt" | "proposedReadAt" | "proposerReadAt">;

export interface ShareProposalRepository {
  /** False when a row for (link, user) already exists, whatever its status. */
  insertIfAbsent(proposal: NewShareProposal): Promise<boolean>;
  findById(id: string): Promise<ShareProposal | null>;
  /** SELECT ... FOR UPDATE. */
  lockById(id: string): Promise<ShareProposal | null>;
  /** Oldest first. */
  listByLink(linkId: string, status?: ShareProposalStatus): Promise<ShareProposal[]>;
  countPending(linkId: string): Promise<number>;
  /** Only from PENDING; true when it changed. */
  decide(id: string, status: "APPROVED" | "DECLINED", by: string, at: Date): Promise<boolean>;
  /** APPROVED for the row of (link, user) whatever its status, if any: the owner adding them outranks a decline. An APPROVED row is left as it was. */
  approveFor(linkId: string, userId: string, by: string, at: Date): Promise<void>;
  /** Proposals on links this user created, PENDING first, then newest: a pending one is never pushed out of `limit`. */
  listForOwner(ownerUserId: string, limit: number): Promise<ShareProposal[]>;
  /** Proposals of this user, ordered as `listForOwner`. */
  listForProposed(userId: string, limit: number): Promise<ShareProposal[]>;
  /** Decided rows only, newest first. */
  listForProposer(userId: string, limit: number): Promise<ShareProposal[]>;
  markRead(id: string, party: ProposalParty, at: Date): Promise<void>;
  /** Every party column where this user is that party; only unread ones. */
  markAllRead(userId: string, at: Date): Promise<void>;
}
