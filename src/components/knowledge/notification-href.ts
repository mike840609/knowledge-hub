import type { ShareCommentNotificationView } from "@/modules/knowledge/domain/share-comment-event";

type Entry = Pick<ShareCommentNotificationView, "kind" | "linkAvailable" | "replyCount" | "workspaceId" | "sourceId" | "documentId" | "threadId" | "authorName" | "excerpt" | "documentTitle" | "href" | "proposalStatus" | "personName" | "targetKind">;

/** SHARED_WITH_YOU is a document, not a discussion: it has no thread to show beside the list, only a page to open. */
export const isSharedEntry = (kind?: string) => kind === "SHARED_WITH_YOU";

/** A proposal to add someone to a NAMED link: a notice, with nothing to open. */
export const isProposalEntry = (kind?: string) => kind === "PROPOSAL_REQUEST" || kind === "PROPOSAL_PENDING" || kind === "PROPOSAL_DECIDED";

/** Only the owner's own request, still pending on a link that opens, can be decided. */
export const canDecideProposal = (entry: Pick<ShareCommentNotificationView, "kind" | "proposalStatus" | "linkAvailable">) =>
  entry.kind === "PROPOSAL_REQUEST" && entry.proposalStatus === "PENDING" && entry.linkAvailable === true;

/** FOLLOW, MENTION and SHARED_WITH_YOU entries open through a link; only OWNER entries open the owner's document. */
export const isLinkEntry = (kind?: string) => kind === "FOLLOW" || kind === "MENTION" || isSharedEntry(kind);

/** The entry's last label: what kind it is, or the state of its discussion. A dead proposal entry has no status to show. */
export const notificationLabel = (entry: Pick<ShareCommentNotificationView, "kind" | "threadStatus" | "proposalStatus" | "linkAvailable">): string | null =>
  isProposalEntry(entry.kind) && !entry.linkAvailable ? null
  : entry.kind === "PROPOSAL_REQUEST" ? (entry.proposalStatus === "APPROVED" ? "Approved" : entry.proposalStatus === "DECLINED" ? "Declined" : "Wants to add someone")
  : entry.kind === "PROPOSAL_PENDING" ? "Waiting for owner"
  : entry.kind === "PROPOSAL_DECIDED" ? (entry.proposalStatus === "APPROVED" ? "Owner approved" : "Owner declined")
  : entry.kind === "FOLLOW" ? "Discussion you follow" : entry.kind === "MENTION" ? "Mentioned you" : entry.kind === "SHARED_WITH_YOU" ? "Shared with you" : entry.threadStatus === "OPEN" ? "Open discussion" : "Resolved";

/**
 * Where an Inbox entry opens: the owner's document in its Workspace, or the `href` the server built for a link entry
 * (`shareDiscussionHref`: `/s/<token>` for a LINK share, the Hub reader for a NAMED one). A dead link opens nothing.
 */
export function notificationHref(entry: Entry): string | null {
  if (isProposalEntry(entry.kind)) return null;
  if (!isLinkEntry(entry.kind)) return `/w/${entry.workspaceId}/knowledge/${entry.sourceId}/${entry.documentId}?thread=${entry.threadId}`;
  return entry.linkAvailable && entry.href ? entry.href : null;
}

/** What a proposal is about: the link's document, or its folder named as one, so the owner sees how wide the grant is. */
const proposalTarget = (entry: Entry) => entry.targetKind === "FOLDER" ? `《${entry.documentTitle}》 folder` : `《${entry.documentTitle}》`;

function proposalLine(entry: Entry): string {
  const target = proposalTarget(entry);
  if (entry.kind === "PROPOSAL_REQUEST") {
    if (entry.proposalStatus === "APPROVED") return `You approved adding ${entry.personName ?? "someone"} to ${target}.`;
    if (entry.proposalStatus === "DECLINED") return `You declined adding ${entry.personName ?? "someone"} to ${target}.`;
    return `${entry.authorName ?? "Someone"} wants to add ${entry.personName ?? "someone"} to ${target}`;
  }
  if (entry.kind === "PROPOSAL_PENDING") return `${entry.authorName ?? "Someone"} mentioned you in ${target} — someone proposed sharing a document with you. Waiting for the owner.`;
  if (entry.proposalStatus === "APPROVED") return `The owner added ${entry.personName ?? "someone"} to ${target}.`;
  // Declined: the proposer's notice names the person; the proposed person's own does not, it is about them.
  return entry.personName ? `The owner declined adding ${entry.personName} to ${target}.` : `The owner declined sharing ${target} with you.`;
}

/** An entry whose link no longer opens for this caller: it names nothing. */
const deadEntry = (entry: Pick<Entry, "kind" | "linkAvailable">) => (isLinkEntry(entry.kind) || isProposalEntry(entry.kind)) && !entry.linkAvailable;

export function notificationLine(entry: Entry): string {
  if (deadEntry(entry)) return "This link is no longer available.";
  if (isProposalEntry(entry.kind)) return proposalLine(entry);
  if (isSharedEntry(entry.kind)) return `${entry.authorName ?? "Someone"} shared 《${entry.documentTitle}》 with you`;
  const said = `${entry.authorName ?? "Someone"}: ${entry.excerpt}`;
  return (entry.replyCount ?? 0) > 1 ? `${entry.replyCount} new replies · ${said}` : said;
}

/** A dead link's entry has no title of its own to show. */
export const notificationTitle = (entry: Pick<ShareCommentNotificationView, "kind" | "linkAvailable" | "documentTitle">) =>
  deadEntry(entry) ? (isLinkEntry(entry.kind) && !isSharedEntry(entry.kind) ? "A shared discussion" : "A shared document") : entry.documentTitle;
