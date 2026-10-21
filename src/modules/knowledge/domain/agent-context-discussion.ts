import type { CurrentAnchorProjection, ReviewComment, ReviewStatus, ReviewThread } from "./document-review";
import { isRetractedThread } from "./document-review";

/** Export allowlist: never carry owner moderation fields or suppressed bodies. */
export type AgentContextDiscussion = {
  id: string;
  status: ReviewStatus;
  createdRevisionId: string;
  createdAt: Date;
  updatedAt: Date;
  currentAnchor: CurrentAnchorProjection;
  comments: { id: string; authorName: string; createdAt: Date; editedAt: Date | null; body: string }[];
};

export function projectAgentDiscussion(
  thread: ReviewThread,
  comments: readonly ReviewComment[],
  currentAnchor: CurrentAnchorProjection,
  authors: ReadonlyMap<string, string>,
): AgentContextDiscussion | null {
  if (thread.visibility === "HIDDEN" || isRetractedThread([...comments])) return null;
  return {
    id: thread.id, status: thread.status, createdRevisionId: thread.createdRevisionId,
    createdAt: thread.createdAt, updatedAt: thread.updatedAt, currentAnchor,
    comments: [...comments].sort(byCreation).map(comment => ({
      id: comment.id,
      authorName: authors.get(comment.authorUserId) ?? "Unknown author",
      createdAt: comment.createdAt,
      editedAt: comment.deletedAt || comment.visibility === "HIDDEN" ? null : comment.editedAt,
      body: comment.deletedAt ? "[Comment deleted]" : comment.visibility === "HIDDEN" ? "[Comment hidden]" : comment.body,
    })),
  };
}

export function byCreation(a: { id: string; createdAt: Date }, b: { id: string; createdAt: Date }): number {
  return a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);
}

export function formatAgentDiscussion(thread: AgentContextDiscussion): string {
  const passage = thread.currentAnchor.match === "OUTDATED"
    ? { match: "OUTDATED", note: "The original passage has changed and cannot be located in this saved version." }
    : { match: thread.currentAnchor.match, quote: thread.currentAnchor.anchor?.exact };
  return `\n#### Discussion\n\nThread: ${JSON.stringify({ id: thread.id, status: thread.status, createdRevisionId: thread.createdRevisionId, createdAt: thread.createdAt.toISOString(), updatedAt: thread.updatedAt.toISOString() })}\n\nPassage: ${JSON.stringify(passage)}\n` + thread.comments.map(comment =>
    `\nComment: ${JSON.stringify({ id: comment.id, author: comment.authorName, createdAt: comment.createdAt.toISOString(), editedAt: comment.editedAt?.toISOString() ?? null })}\n\n${comment.body}\n`,
  ).join("");
}
