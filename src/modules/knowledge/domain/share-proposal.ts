export type ShareProposalStatus = "PENDING" | "APPROVED" | "DECLINED";

/**
 * A recipient's proposal that another person join a NAMED link, made by mentioning them. `userId` is the
 * proposed person, `proposedBy` the recipient who first mentioned them. The three `*ReadAt` are each party's own Inbox read state.
 */
export type ShareProposal = {
  id: string; shareLinkId: string; userId: string; proposedBy: string; commentId: string;
  status: ShareProposalStatus; createdAt: Date; decidedBy: string | null; decidedAt: Date | null;
  ownerReadAt: Date | null; proposedReadAt: Date | null; proposerReadAt: Date | null;
};

export type ProposalParty = "OWNER" | "PROPOSED" | "PROPOSER";
