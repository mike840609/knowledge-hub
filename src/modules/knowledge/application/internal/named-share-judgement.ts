import type { CallerContext } from "@/modules/identity/domain/caller-context";
import type { DocumentShareLink } from "../../domain/document-share-link";
import type { ReceivedShareLink } from "../../ports/document-share-link-repository";
import type { KnowledgeRepositories } from "../../ports/unit-of-work";
import { openShareLinkTarget } from "./folder-link-reach";

/** What a named link opens for its viewer: a document, or a folder (by name). */
export type NamedShareTarget = { documentId: string } | { folderName: string } | { sourceName: string };

/**
 * Whether the link itself is dead for good: revoked, or expired. `!= null` (not `=== null`) so a
 * partial test double that omits these fields is not mistaken for a revoked link.
 */
function isLinkRevokedOrExpired(link: Pick<DocumentShareLink, "revokedAt" | "expiresAt">, now: Date): boolean {
  return link.revokedAt != null || (link.expiresAt != null && link.expiresAt.getTime() <= now.getTime());
}

/**
 * What this link opens for `userId` now, and whether a refusal is permanent. Permanently dead means the
 * link is revoked or expired, or its target row (document, folder node, or Source) is gone: nothing the
 * owner does can bring it back. A target that exists but does not open now (archived, moved out of reach,
 * viewer no longer named) is only temporarily unreachable, so its unread mark must survive.
 */
async function judgeNamedTarget(r: KnowledgeRepositories, link: DocumentShareLink, userId: string, now: Date): Promise<{ target: NamedShareTarget | null; permanentDead: boolean }> {
  if (isLinkRevokedOrExpired(link, now)) return { target: null, permanentDead: true };
  if (link.target.kind === "DOCUMENT") {
    const document = await r.documents.findById(link.target.documentId);
    if (!document) return { target: null, permanentDead: true };
    return { target: await openShareLinkTarget(r, link, document, now, userId) ? { documentId: document.id } : null, permanentDead: false };
  }
  if (link.target.kind === "SOURCE") {
    const source = await r.sourcePolicy.findById(link.target.sourceId);
    if (!source) return { target: null, permanentDead: true };
    return { target: await openShareLinkTarget(r, link, { sourceId: source.id, status: source.status }, now, userId) ? { sourceName: source.name } : null, permanentDead: false };
  }
  const folder = await r.tree.findById(link.target.folderNodeId);
  if (!folder || folder.nodeType !== "FOLDER") return { target: null, permanentDead: true };
  return { target: await openShareLinkTarget(r, link, folder, now, userId) ? { folderName: folder.name ?? "" } : null, permanentDead: false };
}

/** What a named link opens for this viewer now: its document, or its folder's name; null for every refusal. Proposal entries judge through it too. */
export async function openNamedTarget(r: KnowledgeRepositories, link: DocumentShareLink, userId: string, now: Date): Promise<NamedShareTarget | null> {
  return (await judgeNamedTarget(r, link, userId, now)).target;
}

async function judgeRows(r: KnowledgeRepositories, userId: string, now: Date, rows: readonly ReceivedShareLink[]) {
  const judged = [];
  for (const { link, addedAt, readAt } of rows) judged.push({ link, addedAt, readAt, ...await judgeNamedTarget(r, link, userId, now) });
  return judged;
}

/**
 * The shares that name `userId` (at most `limit`, newest first), each judged now: `target` is what the link
 * opens for this viewer, or null for every refusal (revoked, archived, moved out of reach, not named).
 * The Inbox and the Shares page both read through this, so the two lists cannot disagree.
 * `unreadOnly` (the Inbox's unread list and badge) reads only unread rows and returns only live ones. A
 * permanently dead row is marked read here, as a dead mention is, so it cannot fill the window and hide an
 * older live share; a temporarily unreachable one keeps its unread mark and is paged past instead.
 * ponytail: a few reads per share, bounded by `limit`; paging once readers are named more.
 */
export async function judgeNamedShares(r: KnowledgeRepositories, userId: string, limit: number, now: Date, unreadOnly = false) {
  if (!unreadOnly) return judgeRows(r, userId, now, await r.shareLinks.listForRecipient(userId, limit));
  let offset = 0;
  const live: Awaited<ReturnType<typeof judgeRows>> = [];
  for (;;) {
    const batch = offset > 0
      ? await r.shareLinks.listUnreadForRecipient(userId, limit, offset)
      : await r.shareLinks.listUnreadForRecipient(userId, limit);
    const judged = await judgeRows(r, userId, now, batch);
    const permanentDead = judged.filter(share => share.permanentDead);
    for (const { link } of permanentDead) await r.shareLinks.markRecipientRead(link.id, userId, now);
    for (const share of judged) if (share.target !== null) live.push(share);
    // Permanently dead rows are now read and drop out of `read_at IS NULL`; everything else still occupies
    // the unread list, so the next page starts after it.
    const remainingUnreadInBatch = judged.filter(share => !share.permanentDead).length;
    if (batch.length < limit || live.length >= limit || (permanentDead.length === 0 && remainingUnreadInBatch === 0)) return live.slice(0, limit);
    offset += remainingUnreadInBatch;
  }
}

/**
 * The title a named share shows its recipient: the document's current title, or the folder's name. `target` is what the
 * link opened for `caller`. `caller` is unused here, but it reads a revision, and every knowledge entry that reads content
 * must require a caller (`tests/unit/share-link-single-exception.test.ts`): it keeps this from becoming a caller-less read.
 */
export async function namedShareTitle(r: KnowledgeRepositories, caller: CallerContext, target: NamedShareTarget): Promise<string> {
  return "documentId" in target ? (await r.revisions.findCurrent(target.documentId))?.title ?? "" : "sourceName" in target ? target.sourceName : target.folderName;
}
