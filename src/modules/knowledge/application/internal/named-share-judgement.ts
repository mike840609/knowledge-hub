import type { CallerContext } from "@/modules/identity/domain/caller-context";
import type { DocumentShareLink } from "../../domain/document-share-link";
import type { ReceivedShareLink } from "../../ports/document-share-link-repository";
import type { KnowledgeRepositories } from "../../ports/unit-of-work";
import { openShareLinkTarget } from "./folder-link-reach";

/** What a named link opens for its viewer: a document, or a folder (by name). */
export type NamedShareTarget = { documentId: string } | { folderName: string };

/** What a named link opens for this viewer now: its document, or its folder's name; null for every refusal. Proposal entries judge through it too. */
export async function openNamedTarget(r: KnowledgeRepositories, link: DocumentShareLink, userId: string, now: Date): Promise<NamedShareTarget | null> {
  if (link.target.kind === "DOCUMENT") {
    const document = await r.documents.findById(link.target.documentId);
    return document && await openShareLinkTarget(r, link, document, now, userId) ? { documentId: document.id } : null;
  }
  const folder = await r.tree.findById(link.target.folderNodeId);
  return folder?.nodeType === "FOLDER" && await openShareLinkTarget(r, link, folder, now, userId) ? { folderName: folder.name ?? "" } : null;
}

async function judgeRows(r: KnowledgeRepositories, userId: string, now: Date, rows: readonly ReceivedShareLink[]) {
  const judged = [];
  for (const { link, addedAt, readAt } of rows) judged.push({ link, addedAt, readAt, target: await openNamedTarget(r, link, userId, now) });
  return judged;
}

/**
 * The shares that name `userId` (at most `limit`, newest first), each judged now: `target` is what the link
 * opens for this viewer, or null for every refusal (revoked, archived, moved out of reach, not named).
 * The Inbox and the Shares page both read through this, so the two lists cannot disagree.
 * `unreadOnly` (the Inbox's unread list and badge) reads only unread rows and returns only live ones: a dead one
 * is marked read here, as an unread mention is, so it cannot fill the window and hide an older live share, and
 * is not judged again on every poll. ponytail: a document archived and restored loses its share's unread mark.
 * ponytail: a few reads per share, bounded by `limit`; paging once readers are named more.
 */
export async function judgeNamedShares(r: KnowledgeRepositories, userId: string, limit: number, now: Date, unreadOnly = false) {
  if (!unreadOnly) return judgeRows(r, userId, now, await r.shareLinks.listForRecipient(userId, limit));
  for (;;) {
    const judged = await judgeRows(r, userId, now, await r.shareLinks.listUnreadForRecipient(userId, limit));
    const dead = judged.filter(share => !share.target);
    for (const { link } of dead) await r.shareLinks.markRecipientRead(link.id, userId, now);
    if (dead.length === 0 || judged.length < limit) return judged.filter(share => share.target);
  }
}

/**
 * The title a named share shows its recipient: the document's current title, or the folder's name. `target` is what the
 * link opened for `caller`. `caller` is unused here, but it reads a revision, and every knowledge entry that reads content
 * must require a caller (`tests/unit/share-link-single-exception.test.ts`): it keeps this from becoming a caller-less read.
 */
export async function namedShareTitle(r: KnowledgeRepositories, caller: CallerContext, target: NamedShareTarget): Promise<string> {
  return "documentId" in target ? (await r.revisions.findCurrent(target.documentId))?.title ?? "" : target.folderName;
}
