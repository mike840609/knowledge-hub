import { ValidationError } from "./errors";
export const REVIEW_LIMITS = Object.freeze({ body:3000, quote:512, context:64, visibleThreads:200, visibleOpenPerCreator:20, replies:100, hourlyWrites:30 });
export type ReviewStatus = "OPEN" | "RESOLVED";
export type ReviewVisibility = "VISIBLE" | "HIDDEN";
export type ReviewAnchor = { schemaVersion:1; blockPath:number[]; blockKind:"heading"|"paragraph"|"listItem"|"blockquote"|"tableCell"|"code"; startUtf16:number; endUtf16:number; exact:string; prefix:string; suffix:string };
export type CurrentAnchorProjection = { match:"MATCHED"|"MOVED"|"OUTDATED"; anchor?:ReviewAnchor };
type HiddenMetadata = { visibility:ReviewVisibility; hiddenBy:string|null; hiddenAt:Date|null; hiddenReason:string|null };
export type ReviewThread = HiddenMetadata & { id:string; documentId:string; createdRevisionId:string; createdBy:string; creationIdempotencyKey:string; creationRequestHash:string; originShareLinkId:string|null; anchor:ReviewAnchor; status:ReviewStatus; resolvedBy:string|null; resolvedAt:Date|null; createdAt:Date; updatedAt:Date };
/** `deletedAt` is the author's own retraction: the row and its body stay, and no projection shows the body again. */
export type ReviewComment = HiddenMetadata & { id:string; threadId:string; authorUserId:string; body:string; createdAt:Date; editedAt:Date|null; deletedAt:Date|null; idempotencyKey:string; requestHash:string };
/**
 * What a share link reads. It names people by display name only and carries no user or document
 * ID: a link holder is outside the Workspace, and the public page adds no identifier that reaches
 * past its one document (share-link spec §6.1). The thread and comment IDs are the review's own.
 */
export type ReviewCommentView = { id:string; threadId:string; authorName?:string; body:string; visibility:ReviewVisibility; createdAt:Date; editedAt:Date|null; deleted:boolean; /** The caller wrote it. Said as a fact about the caller, so no author ID is handed out. */ own:boolean };
export type ReviewThreadView = { id:string; status:ReviewStatus; createdAt:Date; updatedAt:Date; currentAnchor:CurrentAnchorProjection; comments:ReviewCommentView[]; /** A signed-in reader, not the owner, follows it. Absent for anyone else. */ following?:boolean };
/** What the document's owner reads in My Space: the same threads, with who and what moderation needs. */
export type OwnerReviewThreadView = ReviewThreadView & { documentId:string; createdBy:string; visibility:ReviewVisibility; hiddenBy:string|null; hiddenAt:Date|null; hiddenReason:string|null; originalAnchor:ReviewAnchor; resolvedBy:string|null; resolvedAt:Date|null; comments:(ReviewCommentView & { authorUserId:string; hiddenBy:string|null; hiddenAt:Date|null; hiddenReason:string|null })[] };
export type CreateReviewThreadInput = { token:string; expectedRevisionId:string; anchor:ReviewAnchor; body:string; idempotencyKey:string };
/** The owner starts a discussion on their own document: no link stands between them and it. */
export type CreateOwnerReviewThreadInput = Omit<CreateReviewThreadInput,"token"> & { documentId:string };
export type ReplyReviewInput = { token:string; threadId:string; body:string; idempotencyKey:string };
export function validateReviewBody(body:unknown):string {
  if(typeof body!=="string" || !body.trim() || [...body].length>REVIEW_LIMITS.body) throw new ValidationError("Comment body must contain 1–3,000 characters.");
  return body;
}
export function validateReviewIdempotencyKey(key:unknown):string {
  if(typeof key!=="string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) throw new ValidationError("An unpredictable UUIDv4 idempotency key is required.");
  return key.toLowerCase();
}
/** Explicit allowlist: persisted/client JSON must never carry extra fields into DTOs. */
export function copyReviewAnchor(anchor:ReviewAnchor):ReviewAnchor {
 return {schemaVersion:1,blockPath:[...anchor.blockPath],blockKind:anchor.blockKind,startUtf16:anchor.startUtf16,endUtf16:anchor.endUtf16,exact:anchor.exact,prefix:anchor.prefix,suffix:anchor.suffix};
}
export function projectReviewComment(comment:ReviewComment,callerUserId?:string|null):ReviewCommentView {
  const deleted=!!comment.deletedAt;
  return { id:comment.id, threadId:comment.threadId, createdAt:comment.createdAt, visibility:comment.visibility, editedAt:deleted?null:comment.editedAt??null, deleted, own:!!callerUserId&&comment.authorUserId===callerUserId, body:deleted?"":comment.visibility==="HIDDEN"?"Comment hidden by document owner":comment.body };
}
/** Every comment in it was deleted by its author: there is nothing left to discuss, and it is listed for no one. */
export function isRetractedThread(comments:ReviewComment[]):boolean { return comments.length>0 && comments.every(comment=>!!comment.deletedAt); }
function baseThread(thread:ReviewThread, currentAnchor:CurrentAnchorProjection):Omit<ReviewThreadView,"comments"> {
  return {id:thread.id, status:thread.status, createdAt:thread.createdAt, updatedAt:thread.updatedAt, currentAnchor:currentAnchor.match==="OUTDATED"?{match:"OUTDATED"}:{match:currentAnchor.match,...(currentAnchor.anchor?{anchor:copyReviewAnchor(currentAnchor.anchor)}:{})}};
}
export function projectReviewerThread(thread:ReviewThread,comments:ReviewComment[],currentAnchor:CurrentAnchorProjection,callerUserId?:string|null):ReviewThreadView|null {
  if(thread.visibility==="HIDDEN") return null;
  return {...baseThread(thread,currentAnchor),comments:comments.map(c=>projectReviewComment(c,callerUserId))};
}
export function projectOwnerThread(thread:ReviewThread,comments:ReviewComment[],currentAnchor:CurrentAnchorProjection,callerUserId?:string|null):OwnerReviewThreadView {
  return {...baseThread(thread,currentAnchor),documentId:thread.documentId,createdBy:thread.createdBy,visibility:thread.visibility,hiddenBy:thread.hiddenBy,hiddenAt:thread.hiddenAt,hiddenReason:thread.hiddenReason, originalAnchor:copyReviewAnchor(thread.anchor),resolvedBy:thread.resolvedBy,resolvedAt:thread.resolvedAt,comments:comments.map(c=>({...projectReviewComment(c,callerUserId),authorUserId:c.authorUserId,body:c.deletedAt?"":c.body,hiddenBy:c.hiddenBy,hiddenAt:c.hiddenAt,hiddenReason:c.hiddenReason}))};
}
