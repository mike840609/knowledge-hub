import type { CallerContext } from "@/modules/identity/domain/caller-context";
import { DomainError } from "@/shared/domain/errors";
import { uuidv7 } from "@/shared/ids/uuidv7";
import { MAX_NAMED_SHARE_RECIPIENTS, type DocumentShareLink } from "../domain/document-share-link";
import type { KnowledgeRepositories } from "../ports/unit-of-work";
import { followForMention } from "./follow-for-mention";
import { openShareLinkTarget, reachableChain } from "./internal/folder-link-reach";

export const SHARE_RECIPIENT_ADDED_EVENT = "DOCUMENT_SHARE_RECIPIENT_ADDED";

/**
 * Names more people on a NAMED link — the only place recipient rows are inserted, so an owner's add from
 * Manage and an approved proposal are the same write (mention proposals spec, "Owner decision API").
 * People already named are skipped; the total stays within the cap. Each person added is audited, any
 * pending proposal for them is approved, and they follow every discussion a mention through this link
 * names them in. Ids must be normalised and known to exist. Runs inside the caller's transaction, which
 * must hold the link's lock. Returns the people actually added.
 */
export async function addNamedRecipients(
  r: KnowledgeRepositories,
  caller: CallerContext,
  link: DocumentShareLink,
  workspaceId: string,
  userIds: readonly string[],
  at: Date,
): Promise<string[]> {
  const named = new Set((await r.shareLinks.listRecipients(link.id)).map((recipient) => recipient.userId));
  const added = [...new Set(userIds)].filter((id) => !named.has(id));
  if (named.size + added.length > MAX_NAMED_SHARE_RECIPIENTS) throw new DomainError("INVALID_REQUEST", `A link can name at most ${MAX_NAMED_SHARE_RECIPIENTS} recipients.`);
  if (added.length === 0) return [];
  await r.shareLinks.insertRecipients(link.id, added, caller.identity.id, at);
  for (const userId of added) {
    await appendRecipientEvent(r, caller, workspaceId, link.id, SHARE_RECIPIENT_ADDED_EVENT, userId, at);
    await r.shareProposals.approvePending(link.id, userId, caller.identity.id, at);
    await followMentionedThreads(r, link, userId, at);
  }
  return added;
}

export function appendRecipientEvent(r: KnowledgeRepositories, caller: CallerContext, workspaceId: string, linkId: string, eventType: string, userId: string, at: Date, extra: Record<string, unknown> = {}) {
  return r.auditEvents.append({
    id: uuidv7(),
    workspaceId,
    actorUserId: caller.identity.id,
    actorKind: "USER",
    eventType,
    targetType: "DOCUMENT_SHARE_LINK",
    targetId: linkId,
    payload: { ...extra, userId },
    correlationId: null,
    createdAt: at,
  });
}

/**
 * The follow every mention gives (`DocumentReviewService.mentionOnWrite`), for each discussion where a stored
 * mention through this link names the person. Their recipient row is already written, so the link admits them.
 */
async function followMentionedThreads(r: KnowledgeRepositories, link: DocumentShareLink, userId: string, at: Date): Promise<void> {
  const commentIds = [...new Set((await r.reviewMentions.listByLinkAndUser(link.id, userId)).map((mention) => mention.commentId))];
  if (commentIds.length === 0) return;
  const threadIds = [...new Set((await r.reviewComments.findByIds(commentIds)).map((comment) => comment.threadId))];
  for (const thread of await r.reviewThreads.findByIds(threadIds)) {
    await followForMention(r.reviewFollows, {
      threadId: thread.id, userId, shareLinkId: link.id, at,
      currentLinkValid: (linkId) => linkOpensOnDocument(r, linkId, thread.documentId, userId, at),
    });
  }
}

/** Whether a link opens this document for this person now: the judgement `mentionOnWrite` makes of a current follow's link. */
async function linkOpensOnDocument(r: KnowledgeRepositories, linkId: string, documentId: string, userId: string, now: Date): Promise<boolean> {
  const link = (await r.shareLinks.findByIds([linkId]))[0];
  if (!link) return false;
  const document = await r.documents.findById(documentId);
  if (!document) return false;
  if (link.target.kind === "DOCUMENT") return link.target.documentId === documentId && !!await openShareLinkTarget(r, link, document, now, userId);
  const folder = await r.tree.findById(link.target.folderNodeId);
  return !!folder && !!await reachableChain(r, folder, document) && !!await openShareLinkTarget(r, link, folder, now, userId);
}
