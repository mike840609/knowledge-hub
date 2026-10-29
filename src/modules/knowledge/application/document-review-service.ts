import { createHash } from "node:crypto";
import type { CallerContext } from "@/modules/identity/domain/caller-context";
import { DomainError } from "@/shared/domain/errors";
import { isUuid, uuidv7 } from "@/shared/ids/uuidv7";
import { evaluateShareLinkValidity, isShareToken, ShareLinkNotFoundError } from "../domain/document-share-link";
import { REVIEW_LIMITS, isRetractedThread, projectOwnerThread, projectReviewerThread, projectReviewComment, validateReviewBody, validateReviewIdempotencyKey, type ReviewThread, type ReviewComment, type ReviewAnchor, type ReviewStatus, type ReviewVisibility, type ReviewThreadView, type OwnerReviewThreadView, type CreateReviewThreadInput, type CreateOwnerReviewThreadInput, type ReplyReviewInput, type ReplyOwnerReviewInput } from "../domain/document-review";
import { MENTION_LIMIT, MENTION_PREFIX, normalizeMentions, type ReviewMention } from "../domain/review-mention";
import { createReviewAnchorRelocator, validateReviewAnchor } from "../domain/review-anchor";
import { projectShareCommentNotification, EXCERPT_LIMIT, type ShareCommentNotificationView } from "../domain/share-comment-event";
import { orderFollowedDiscussions, summarizeFollowedThread, type FollowedDiscussionView } from "../domain/review-follow";
import type { DocumentShareLink } from "../domain/document-share-link";
import type { KnowledgeRepositories, KnowledgeUnitOfWork } from "../ports/unit-of-work";

function fail(code:string, message:string):never { throw new DomainError(code,message); }
function canonicalAnchor(a:ReviewAnchor) { if(!a || typeof a!=="object") fail("INVALID_REQUEST","Provide an anchor."); return {schemaVersion:a.schemaVersion,blockPath:a.blockPath,blockKind:a.blockKind,startUtf16:a.startUtf16,endUtf16:a.endUtf16,exact:a.exact,prefix:a.prefix,suffix:a.suffix}; }
const hash = (payload:unknown) => createHash("sha256").update(JSON.stringify(payload)).digest("hex");
const FOLLOW_PREFIX = "follow:";
const FOLLOW_LIMIT = 100;
/** The mentions a write carries: validated ids and, for the owner, the link they hand over. `hashed` joins the request hash only when someone is named. */
type MentionRequest = { ids: string[]; linkId: string | null; hashed: Record<string, unknown> };
const newestFirst = (views: ShareCommentNotificationView[]) => views.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));
export class DocumentReviewService {
  constructor(private readonly uow:KnowledgeUnitOfWork, private readonly clock:()=>Date=()=>new Date(), private readonly writesEnabled:()=>boolean=()=>false) {}
  /**
   * The one entry that answers without a caller: a live share token reads the visible discussion.
   * It takes no locks. A reader must never queue the owner's edits or a folder sync behind a page
   * load, and it writes nothing a lock would protect; `readShared` reads the same way.
   */
  async queryForLink(caller:CallerContext | null,token:string) {
    return this.uow.run(async r => { const s=await this.linkScope(r,token,false); return {threads:await this.withFollowing(r,s,caller,await this.views(r,s.document.id,false,caller?.identity.id)),revisionId:s.document.currentRevisionId,writesEnabled:!!caller && this.writesEnabled(),callerUserId:caller?.identity.id ?? null}; });
  }
  async queryForOwner(caller:CallerContext,documentId:string) {
    return this.uow.run(async r => { const s=await this.ownerScope(r,caller,documentId,false); return {threads:await this.views(r,documentId,true,caller.identity.id),revisionId:s.document.currentRevisionId,writesEnabled:this.writesEnabled(),callerUserId:caller.identity.id}; });
  }
  /** Only events owned by the caller are selected at the repository boundary. */
  private async notificationViews(r: KnowledgeRepositories, events: Awaited<ReturnType<KnowledgeRepositories["shareCommentEvents"]["listUnreadByRecipient"]>>) {
    const views = [];
    for (const e of events) {
      const thread = await r.reviewThreads.findById(e.threadId);
      const document = await r.documents.findById(e.documentId);
      const revision = await r.revisions.findCurrent(e.documentId);
      const comments = await r.reviewComments.listByThread(e.threadId);
      const comment = comments.find(c => c.id === e.commentId);
      if (!thread || thread.visibility === "HIDDEN" || isRetractedThread(comments)) continue;
      if (!document || !revision || !comment || comment.deletedAt || comment.visibility === "HIDDEN") continue;
      const author = await r.users.findById(e.createdByUserId);
      views.push({ ...projectShareCommentNotification({
        id: e.id, workspaceId: e.workspaceId, documentId: e.documentId,
        sourceId: document.sourceId, documentTitle: revision.title,
        threadId: e.threadId, commentId: e.commentId,
        authorName: author?.name, body: comment.body, createdAt: e.createdAt,
        readAt: e.readAt, threadStatus: thread.status,
      }), kind: "OWNER" as const });
    }
    return views;
  }
  /** The caller's unread: comments on their shared documents, replies in discussions they follow, and comments naming them. */
  async listUnreadForOwner(caller: CallerContext) {
    return this.uow.run(async r => ({
      notifications: newestFirst([
        ...await this.notificationViews(r, await r.shareCommentEvents.listUnreadByRecipient(caller.identity.id)),
        ...(await this.followViews(r, caller.identity.id)).filter(view => view.readAt === null),
        ...(await this.mentionViews(r, caller.identity.id)).filter(view => view.readAt === null),
      ]),
    }));
  }
  /** The Inbox badge: as many as `listUnreadForOwner` lists, without loading a body, title or author. */
  async countUnreadForOwner(caller: CallerContext): Promise<{ count: number }> {
    return this.uow.run(async r => {
      const owner = (await r.shareCommentEvents.listUnreadCountsByRecipient(caller.identity.id)).reduce((sum, row) => sum + row.unreadCount, 0);
      const follows = (await this.followedThreads(r, caller.identity.id)).filter(({ summary }) => !("unavailable" in summary) && !!summary.latestReply && summary.unread > 0).length;
      const mentions = (await this.judgedMentions(r, caller.identity.id)).filter(judged => "comment" in judged && judged.mention.readAt === null).length;
      return { count: owner + follows + mentions };
    });
  }
  /** Lightweight counts for My shares. No comment bodies or full revisions are loaded. */
  async listUnreadShareCountsForOwner(caller: CallerContext) {
    return this.uow.run(r => r.shareCommentEvents.listUnreadCountsByRecipient(caller.identity.id));
  }
  /** A bounded, cursor-paged cross-document activity feed, including already-read comments. */
  async listActivityForOwner(caller: CallerContext, before?: { createdAt: Date; id: string }) {
    return this.uow.run(async r => {
      const size = 50;
      const events = await r.shareCommentEvents.listRecentByRecipient(caller.identity.id, before, size + 1);
      const page = events.slice(0, size);
      // Follows and mentions are not paged: at most FOLLOW_LIMIT each, all on the first page (specs 2026-10-22, 2026-10-29, deviation).
      const follows = before ? [] : await this.followViews(r, caller.identity.id);
      const mentions = before ? [] : await this.mentionViews(r, caller.identity.id);
      return {
        notifications: newestFirst([...await this.notificationViews(r, page), ...follows, ...mentions]),
        nextCursor: events.length > size && page.length
          ? { createdAt: page[page.length - 1].createdAt.toISOString(), id: page[page.length - 1].id }
          : null,
      };
    });
  }
  /** An owner event by its id, a followed discussion by `follow:<threadId>`, or a mention by `mention:<commentId>`; only the caller's own rows change. */
  async markEventRead(caller: CallerContext, eventId: string) {
    if (eventId.startsWith(MENTION_PREFIX)) {
      const commentId = eventId.slice(MENTION_PREFIX.length);
      // comment_id is a MariaDB UUID column: a malformed id would fail the query rather than match nothing.
      if (isUuid(commentId)) await this.uow.run(r => r.reviewMentions.markRead(caller.identity.id, commentId, this.clock()));
      return;
    }
    await this.uow.run(r => eventId.startsWith(FOLLOW_PREFIX)
      ? r.reviewFollows.markSeen(eventId.slice(FOLLOW_PREFIX.length), caller.identity.id, this.clock())
      : r.shareCommentEvents.markEventRead(caller.identity.id, eventId, this.clock()));
  }
  async markAllActivityRead(caller: CallerContext) {
    await this.uow.run(async r => {
      await r.shareCommentEvents.markAllRead(caller.identity.id, this.clock());
      await r.reviewFollows.markAllSeen(caller.identity.id, this.clock());
      await r.reviewMentions.markAllRead(caller.identity.id, this.clock());
    });
  }
  /** The owner has looked at one discussion: its notices are read, the rest of the document's are not. */
  async markThreadRead(caller: CallerContext, documentId: string, threadId: string) {
    await this.uow.run(async r => {
      await this.ownerScope(r, caller, documentId, false);
      await r.shareCommentEvents.markThreadRead(caller.identity.id, documentId, threadId, this.clock());
    });
  }
  /** A signed-in reader on a live link follows, or stops following, one of its discussions. Adds no words, so writes need not be enabled. */
  async followForLink(caller: CallerContext, input: { token: string; threadId: string; following: boolean }) {
    return this.uow.run(async r => {
      const s = await this.linkThread(r, input.token, input.threadId);
      if (s.workspace.personalOwnerUserId === caller.identity.id) return { following: false };
      if (input.following) await r.reviewFollows.follow({ threadId: input.threadId, userId: caller.identity.id, shareLinkId: s.link.id, at: this.clock() });
      else await r.reviewFollows.unfollow(input.threadId, caller.identity.id, this.clock());
      return { following: input.following };
    });
  }
  /** People to @-mention, for a caller who could write a comment on this document now: a live link, or the owner. Reads only. */
  async searchMentionCandidates(caller: CallerContext, input: { query: string; token?: string; documentId?: string }) {
    if ((input.token === undefined) === (input.documentId === undefined)) fail("INVALID_REQUEST", "Provide a share link or a document.");
    return this.uow.run(async r => {
      if (input.token !== undefined) await this.linkScope(r, input.token, false);
      else await this.ownerScope(r, caller, input.documentId!, false);
      const query = input.query.trim().slice(0, 200);
      if (!query) return { candidates: [] };
      const found = await r.users.searchExisting(query, MENTION_LIMIT);
      return { candidates: found.map(u => ({ id: u.id, name: u.name, nameEn: u.nameEn, empId: u.emp_id })) };
    });
  }
  /** The reader has looked at a discussion: its follow, if any, is seen and their mentions in it are read. */
  async markSeenForLink(caller: CallerContext, input: { token: string; threadId: string }) {
    await this.uow.run(async r => {
      await this.linkThread(r, input.token, input.threadId);
      await r.reviewFollows.markSeen(input.threadId, caller.identity.id, this.clock());
      await r.reviewMentions.markThreadRead(caller.identity.id, input.threadId, this.clock());
    });
  }
  /** Shares → Discussions: every discussion the caller follows, including ones no one has answered. */
  async listFollowedDiscussions(caller: CallerContext): Promise<{ items: FollowedDiscussionView[] }> {
    return this.uow.run(async r => {
      const items: FollowedDiscussionView[] = [];
      for (const { thread, link, summary } of await this.followedThreads(r, caller.identity.id)) {
        if ("unavailable" in summary) { items.push({ threadId: thread.id, linkAvailable: false }); continue; }
        const revision = await r.revisions.findCurrent(thread.documentId);
        items.push({
          threadId: thread.id, linkAvailable: true, token: link!.token, documentTitle: revision?.title ?? "", threadStatus: thread.status,
          authorName: (await r.users.findById(summary.latest.authorUserId))?.name,
          excerpt: [...summary.latest.body].slice(0, EXCERPT_LIMIT).join(""), latestAt: summary.latest.createdAt, unread: summary.unread,
        });
      }
      return { items: orderFollowedDiscussions(items) };
    });
  }
  /** The caller gives up their own follow. It reads nothing, so it needs no live link and answers alike for any id. */
  async unfollowOwn(caller: CallerContext, threadId: string): Promise<{ following: false }> {
    // thread_id is a MariaDB UUID column: a malformed id would fail the query rather than match nothing.
    if (isUuid(threadId)) await this.uow.run(r => r.reviewFollows.unfollow(threadId, caller.identity.id, this.clock()));
    return { following: false };
  }
  /** A visible, standing discussion on a live link's document; any other is not found. */
  private async linkThread(r: KnowledgeRepositories, token: string, threadId: string) {
    const s = await this.linkScope(r, token, false);
    const thread = typeof threadId === "string" ? await r.reviewThreads.findById(threadId) : null;
    if (!thread || thread.documentId !== s.document.id || thread.visibility === "HIDDEN" || isRetractedThread(await r.reviewComments.listByThread(thread.id))) throw new ShareLinkNotFoundError();
    return s;
  }
  private async withFollowing(r: KnowledgeRepositories, s: Awaited<ReturnType<DocumentReviewService["scope"]>>, caller: CallerContext | null, threads: ReviewThreadView[]): Promise<ReviewThreadView[]> {
    if (!caller || s.workspace.personalOwnerUserId === caller.identity.id) return threads;
    const followed = await r.reviewFollows.followingThreadIds(caller.identity.id, threads.map(thread => thread.id));
    return threads.map(thread => ({ ...thread, following: followed.has(thread.id) }));
  }
  /**
   * The caller's followed discussions with their link's state, judged now.
   * Comments come in one query; links and their judgement once per document and link.
   * ponytail: at most FOLLOW_LIMIT follows, one thread lookup each; cursor paging and one joined query once readers follow more.
   */
  private async followedThreads(r: KnowledgeRepositories, userId: string) {
    const follows = await r.reviewFollows.listFollowing(userId, FOLLOW_LIMIT);
    const commentsByThread = new Map<string, ReviewComment[]>();
    const comments = await r.reviewComments.listByThreads(follows.map(follow => follow.threadId));
    for (const comment of comments) {
      const list = commentsByThread.get(comment.threadId);
      if (list) list.push(comment); else commentsByThread.set(comment.threadId, [comment]);
    }
    // A comment naming the caller is its own Inbox entry; it is not counted again as a follow reply.
    const excludeCommentIds = await r.reviewMentions.mentionedCommentIds(userId, comments.map(comment => comment.id));
    const linksByDocument = new Map<string, DocumentShareLink[]>();
    const validByLink = new Map<string, boolean>();
    const found = [];
    for (const follow of follows) {
      const thread = await r.reviewThreads.findById(follow.threadId);
      if (!thread) continue;
      if (!linksByDocument.has(thread.documentId)) linksByDocument.set(thread.documentId, await r.shareLinks.listByDocument(thread.documentId));
      const link = linksByDocument.get(thread.documentId)!.find(candidate => candidate.id === follow.shareLinkId);
      if (link && !validByLink.has(link.id)) validByLink.set(link.id, await this.linkValid(r, link));
      const linkValid = !!link && validByLink.get(link.id)!;
      const summary = summarizeFollowedThread({ thread, comments: commentsByThread.get(thread.id) ?? [], userId, seenAt: follow.seenAt, linkValid, excludeCommentIds });
      if (summary) found.push({ follow, thread, link, summary });
    }
    return found;
  }
  /**
   * The caller's followed discussions as Inbox entries, one per discussion. A link that no longer
   * opens yields an entry naming nothing: no title, author, words or token.
   */
  private async followViews(r: KnowledgeRepositories, userId: string): Promise<ShareCommentNotificationView[]> {
    const views: ShareCommentNotificationView[] = [];
    const titles = new Map<string, string>();
    const authorNames = new Map<string, string | undefined>();
    for (const { follow, thread, link, summary } of await this.followedThreads(r, userId)) {
      const base = { id: `${FOLLOW_PREFIX}${thread.id}`, workspaceId: "", documentId: "", sourceId: "", threadId: thread.id };
      if ("unavailable" in summary) { views.push({ ...base, kind: "FOLLOW", documentTitle: "", commentId: "", authorName: undefined, excerpt: "", createdAt: follow.seenAt, readAt: follow.seenAt, threadStatus: "OPEN", linkAvailable: false }); continue; }
      if (!summary.latestReply) continue;
      if (!titles.has(thread.documentId)) titles.set(thread.documentId, (await r.revisions.findCurrent(thread.documentId))?.title ?? "");
      const authorId = summary.latestReply.authorUserId;
      if (!authorNames.has(authorId)) authorNames.set(authorId, (await r.users.findById(authorId))?.name);
      views.push({
        ...projectShareCommentNotification({ ...base, documentTitle: titles.get(thread.documentId)!, commentId: summary.latestReply.id, authorName: authorNames.get(authorId), body: summary.latestReply.body, createdAt: summary.latestReply.createdAt, readAt: summary.unread > 0 ? null : follow.seenAt, threadStatus: thread.status }),
        kind: "FOLLOW", token: link!.token, replyCount: summary.unread, linkAvailable: true,
      });
    }
    return views;
  }
  /**
   * The caller's newest mentions, each judged now: live only while its carried link opens and the
   * comment and its discussion stand visible (`projectReviewerThread`'s rules). Anything else is dead.
   * ponytail: at most FOLLOW_LIMIT mentions, one comment lookup each; paging once readers are named more.
   */
  private async judgedMentions(r: KnowledgeRepositories, userId: string) {
    const mentions = await r.reviewMentions.listRecentByRecipient(userId, FOLLOW_LIMIT);
    const threads = new Map<string, { thread: ReviewThread | null; comments: ReviewComment[] }>();
    const linksByDocument = new Map<string, DocumentShareLink[]>();
    const validByLink = new Map<string, boolean>();
    const judged: Array<{ mention: ReviewMention } | { mention: ReviewMention; thread: ReviewThread; comment: ReviewComment; link: DocumentShareLink }> = [];
    for (const mention of mentions) {
      const found = await r.reviewComments.findById(mention.commentId);
      if (found && !threads.has(found.threadId)) threads.set(found.threadId, { thread: await r.reviewThreads.findById(found.threadId), comments: await r.reviewComments.listByThread(found.threadId) });
      const { thread, comments } = found ? threads.get(found.threadId)! : { thread: null, comments: [] };
      const comment = comments.find(candidate => candidate.id === mention.commentId);
      if (!thread || !comment || thread.visibility === "HIDDEN" || isRetractedThread(comments) || comment.deletedAt || comment.visibility === "HIDDEN") { judged.push({ mention }); continue; }
      if (!linksByDocument.has(thread.documentId)) linksByDocument.set(thread.documentId, await r.shareLinks.listByDocument(thread.documentId));
      const link = linksByDocument.get(thread.documentId)!.find(candidate => candidate.id === mention.shareLinkId);
      if (link && !validByLink.has(link.id)) validByLink.set(link.id, await this.linkValid(r, link));
      judged.push(link && validByLink.get(link.id) ? { mention, thread, comment, link } : { mention });
    }
    return judged;
  }
  /** The caller's mentions as Inbox entries, one per comment. A dead one names nothing and is never unread. */
  private async mentionViews(r: KnowledgeRepositories, userId: string): Promise<ShareCommentNotificationView[]> {
    const views: ShareCommentNotificationView[] = [];
    const titles = new Map<string, string>();
    const authorNames = new Map<string, string | undefined>();
    for (const judged of await this.judgedMentions(r, userId)) {
      const { mention } = judged;
      const base = { id: `${MENTION_PREFIX}${mention.commentId}`, workspaceId: "", documentId: "", sourceId: "", commentId: mention.commentId, createdAt: mention.createdAt };
      if (!("comment" in judged)) { views.push({ ...base, kind: "MENTION", threadId: "", documentTitle: "", authorName: undefined, excerpt: "", readAt: mention.createdAt, threadStatus: "OPEN", linkAvailable: false }); continue; }
      const { thread, comment, link } = judged;
      if (!titles.has(thread.documentId)) titles.set(thread.documentId, (await r.revisions.findCurrent(thread.documentId))?.title ?? "");
      if (!authorNames.has(comment.authorUserId)) authorNames.set(comment.authorUserId, (await r.users.findById(comment.authorUserId))?.name);
      views.push({
        ...projectShareCommentNotification({ ...base, threadId: thread.id, documentTitle: titles.get(thread.documentId)!, authorName: authorNames.get(comment.authorUserId), body: comment.body, readAt: mention.readAt, threadStatus: thread.status }),
        kind: "MENTION", token: link.token, linkAvailable: true,
      });
    }
    return views;
  }
  /** Whether a link opens now: the same judgement `linkScope` makes, without refusing. */
  private async linkValid(r: KnowledgeRepositories, link: DocumentShareLink): Promise<boolean> {
    try {
      const scope = await this.scope(r, link.documentId, false);
      return this.opens(r, scope, link);
    } catch (error) {
      if (error instanceof ShareLinkNotFoundError) return false;
      throw error;
    }
  }
  private async opens(r: KnowledgeRepositories, scope: Awaited<ReturnType<DocumentReviewService["scope"]>>, link: DocumentShareLink): Promise<boolean> {
    const membership = await r.workspaceMemberships.find(scope.workspace.id, link.createdBy);
    return evaluateShareLinkValidity({ link, documentStatus: scope.document.status, sourceStatus: scope.source.status, workspaceLifecycle: scope.workspace.lifecycleState, workspaceOwnerUserId: scope.workspace.personalOwnerUserId, creatorDirectRole: membership ? membership.role ?? null : undefined, now: this.clock() }).valid;
  }
  /** Marks this document's events read. Owner scope first: a non-owner reaches nothing. */
  async markDocumentRead(caller:CallerContext,documentId:string) {
    await this.uow.run(async r => {
      await this.ownerScope(r,caller,documentId,false);
      await r.shareCommentEvents.markDocumentRead(caller.identity.id,documentId,this.clock());
    });
  }
  private views(r:KnowledgeRepositories,documentId:string,owner:true,callerUserId?:string):Promise<OwnerReviewThreadView[]>;
  private views(r:KnowledgeRepositories,documentId:string,owner:false,callerUserId?:string):Promise<ReviewThreadView[]>;
  private async views(r:KnowledgeRepositories,documentId:string,owner:boolean,callerUserId?:string):Promise<ReviewThreadView[]|OwnerReviewThreadView[]> {
    const revision=await r.revisions.findCurrent(documentId);
    if(!revision) fail("REVIEW_NOT_FOUND","Document discussion was not found.");
    const relocateAnchor=createReviewAnchorRelocator(revision.markdown);
    const results=[];
    for(const thread of await r.reviewThreads.listByDocument(documentId)) {
      if(!owner && thread.visibility==="HIDDEN") continue;
      const comments=await r.reviewComments.listByThread(thread.id);
      if(isRetractedThread(comments)) continue;
      const anchor=relocateAnchor(thread.anchor,thread.createdRevisionId===revision.id);
      const view=owner?projectOwnerThread(thread,comments,anchor,callerUserId):projectReviewerThread(thread,comments,anchor,callerUserId);
      if(view) {
        const authors=new Map(comments.map(comment=>[comment.id,comment.authorUserId]));
        for(const comment of view.comments) comment.authorName=(await r.users.findById(authors.get(comment.id)!))?.name;
        results.push(view);
      }
    }
    return results.sort((a,b)=>{
      const left=a.currentAnchor.anchor,right=b.currentAnchor.anchor;
      if(!left || !right) { if(left) return -1; if(right) return 1; }
      else {
        const length=Math.min(left.blockPath.length,right.blockPath.length);
        for(let i=0;i<length;i++) { const difference=left.blockPath[i]-right.blockPath[i]; if(difference) return difference; }
        const position=left.blockPath.length-right.blockPath.length || left.startUtf16-right.startUtf16;
        if(position) return position;
      }
      return a.createdAt.getTime()-b.createdAt.getTime() || a.id.localeCompare(b.id);
    });
  }
  /** `lock` is for writes (spec §7 lock order: link, source, workspace). Reads pass false and wait on nobody. */
  private async scope(r:KnowledgeRepositories,documentId:string,lock=true) {
    const initial=await r.documents.findById(documentId);
    if(!initial) throw new ShareLinkNotFoundError();
    const source=lock?await r.sourcePolicy.lockById(initial.sourceId):await r.sourcePolicy.findById(initial.sourceId);
    if(!source) throw new ShareLinkNotFoundError();
    const workspace=lock?await r.workspaces.lockSharedById(source.workspaceId):await r.workspaces.findById(source.workspaceId);
    const document=await r.documents.findById(documentId);
    if(!workspace || !document || document.sourceId!==source.id || workspace.workspaceType!=="PERSONAL" || workspace.lifecycleState!=="ACTIVE") throw new ShareLinkNotFoundError();
    return {document,source,workspace};
  }
  private async linkScope(r:KnowledgeRepositories,token:string,lock=true) {
    if(typeof token!=="string" || !isShareToken(token)) throw new ShareLinkNotFoundError();
    const found=await r.shareLinks.findByToken(token);
    const link=found&&lock?await r.shareLinks.lockById(found.id):found;
    // The UUID column matches and returns lower case whatever case the URL carried, as readShared accepts it.
    if(!link || link.token!==token.toLowerCase()) throw new ShareLinkNotFoundError();
    const scope=await this.scope(r,link.documentId,lock);
    if(!await this.opens(r,scope,link)) throw new ShareLinkNotFoundError();
    return {...scope,link};
  }
  private async ownerScope(r:KnowledgeRepositories,caller:CallerContext,documentId:string,lock=true) {
    const s=await this.scope(r,documentId,lock);
    if(s.workspace.personalOwnerUserId!==caller.identity.id) throw new ShareLinkNotFoundError();
    return s;
  }
  private active(s:Awaited<ReturnType<DocumentReviewService["scope"]>>) {
    if(s.document.status!=="ACTIVE" || s.source.status!=="ACTIVE") fail("REVIEW_CONFLICT","Archived documents cannot receive discussion writes.");
  }
  private enabled() { if(!this.writesEnabled()) fail("REVIEW_WRITES_DISABLED","New document comments are disabled."); }
  private async quota(r:KnowledgeRepositories,userId:string,documentId:string) {
    if(await r.reviewWriteLedger.countSince(userId,documentId,new Date(this.clock().getTime()-3600000))>=REVIEW_LIMITS.hourlyWrites) fail("REVIEW_RATE_LIMIT","The hourly discussion write limit was reached.");
  }
  private async charge(r:KnowledgeRepositories,userId:string,documentId:string) { await r.reviewWriteLedger.record({id:uuidv7(),userId,documentId,createdAt:this.clock()}); }
  private async capacity(r:KnowledgeRepositories,documentId:string,creatorId:string,open=true) {
    if(await r.reviewThreads.countVisibleByDocument(documentId)>=REVIEW_LIMITS.visibleThreads || (open && await r.reviewThreads.countVisibleOpenByCreator(documentId,creatorId)>=REVIEW_LIMITS.visibleOpenPerCreator)) fail("CAPACITY_EXCEEDED","The visible discussion limit was reached.");
  }
  async createForLink(caller:CallerContext,input:CreateReviewThreadInput) {
    const request=this.creation(input);
    return this.uow.run(async r => { const s=await this.linkScope(r,input.token); return this.create(r,caller,s,s.link.id,request,input,async()=>(await this.views(r,s.document.id,false,caller.identity.id))); });
  }
  /** The owner's own discussion, on a passage of their own document. No link is involved, so none is recorded. */
  async createForOwner(caller:CallerContext,input:CreateOwnerReviewThreadInput) {
    const request=this.creation(input);
    return this.uow.run(async r => { const s=await this.ownerScope(r,caller,input.documentId); return this.create(r,caller,s,null,request,input,async()=>(await this.views(r,s.document.id,true,caller.identity.id))); });
  }
  private creation(input:Pick<CreateReviewThreadInput,"expectedRevisionId"|"anchor"|"body"|"idempotencyKey">) {
    const body=validateReviewBody(input.body),key=validateReviewIdempotencyKey(input.idempotencyKey);
    return {body,key,expectedRevisionId:input.expectedRevisionId,anchor:input.anchor,hashed:{expectedRevisionId:input.expectedRevisionId,anchor:canonicalAnchor(input.anchor),body}};
  }
  /** One way to start a discussion, whoever starts it: the scope is what the caller was let in by. */
  private async create<V extends ReviewThreadView>(r:KnowledgeRepositories,caller:CallerContext,s:Awaited<ReturnType<DocumentReviewService["scope"]>>,originShareLinkId:string|null,request:ReturnType<DocumentReviewService["creation"]>,input:{mentions?:unknown;mentionLinkId?:unknown},views:()=>Promise<V[]>):Promise<V> {
    const {body,key}=request,mentions=this.mentionRequest(caller,s,originShareLinkId,input),requestHash=hash({...request.hashed,...mentions.hashed});
    const existing=await r.reviewThreads.findByCreationKey(s.document.id,caller.identity.id,key);
    if(existing) { if(existing.creationRequestHash!==requestHash) fail("IDEMPOTENCY_KEY_REUSED","The idempotency key was already used for a different request."); const view=(await views()).find(t=>t.id===existing.id); if(!view) throw new ShareLinkNotFoundError(); return view; }
    this.enabled(); this.active(s);
    const revision=await r.revisions.findCurrent(s.document.id);
    if(!revision || revision.id!==request.expectedRevisionId) fail("STALE_DOCUMENT_REVISION","Refresh the document before selecting a passage.");
    const anchor=validateReviewAnchor(revision.markdown,request.anchor);
    await this.capacity(r,s.document.id,caller.identity.id); await this.quota(r,caller.identity.id,s.document.id);
    const carriedLinkId=await this.mentionLink(r,s,originShareLinkId,mentions);
    const now=this.clock(); const thread:ReviewThread={id:uuidv7(),documentId:s.document.id,createdRevisionId:revision.id,createdBy:caller.identity.id,creationIdempotencyKey:key,creationRequestHash:requestHash,originShareLinkId,anchor,status:"OPEN",visibility:"VISIBLE",hiddenBy:null,hiddenAt:null,hiddenReason:null,resolvedBy:null,resolvedAt:null,createdAt:now,updatedAt:now};
    const firstComment=this.comment(thread.id,caller.identity.id,body,key,requestHash);
    if (revision.history?.state === "WORKING") await r.revisions.markCheckpoint(revision.id,"COMMENT");
    await r.reviewThreads.insert(thread);
    await r.reviewComments.insert(firstComment); await this.charge(r,caller.identity.id,s.document.id);
    await this.notifyOwner(r,caller,s,originShareLinkId,firstComment);
    await this.followOnWrite(r,caller,s,originShareLinkId,thread.id);
    await this.mentionOnWrite(r,s,carriedLinkId,firstComment,mentions.ids);
    return (await views()).find(t=>t.id===thread.id)!;
  }
  async replyForLink(caller:CallerContext,input:ReplyReviewInput) { return this.uow.run(async r=> {const s=await this.linkScope(r,input.token); return this.reply(r,caller,s,s.link.id,input);}); }
  async replyForOwner(caller:CallerContext,input:ReplyOwnerReviewInput) {return this.uow.run(async r=>{const s=await this.ownerScope(r,caller,input.documentId);return this.reply(r,caller,s,null,input);});}
  private comment(threadId:string,userId:string,body:string,key:string,requestHash:string):ReviewComment {return {id:uuidv7(),threadId,authorUserId:userId,body,idempotencyKey:key,requestHash,createdAt:this.clock(),editedAt:null,deletedAt:null,visibility:"VISIBLE",hiddenBy:null,hiddenAt:null,hiddenReason:null};}
  /** A comment written through a link is news to the owner, unless the owner wrote it (share-comment-notify spec). */
  private async notifyOwner(r:KnowledgeRepositories,caller:CallerContext,s:Awaited<ReturnType<DocumentReviewService["scope"]>>,originShareLinkId:string|null,comment:ReviewComment) {
    if(originShareLinkId===null || s.workspace.personalOwnerUserId===caller.identity.id) return;
    await r.shareCommentEvents.insert({id:uuidv7(),workspaceId:s.workspace.id,documentId:s.document.id,threadId:comment.threadId,commentId:comment.id,originShareLinkId,createdByUserId:caller.identity.id,mentionedUserId:null,createdAt:comment.createdAt,readAt:null});
  }
  /** Writing in a discussion through a link follows it, or follows it again (spec 2026-10-22 § Following). The owner is told by their own events. */
  private async followOnWrite(r:KnowledgeRepositories,caller:CallerContext,s:Awaited<ReturnType<DocumentReviewService["scope"]>>,originShareLinkId:string|null,threadId:string) {
    if(originShareLinkId!==null && s.workspace.personalOwnerUserId!==caller.identity.id) await r.reviewFollows.follow({threadId,userId:caller.identity.id,shareLinkId:originShareLinkId,at:this.clock()});
  }
  /**
   * Who a comment names, read before the replay check so the request hash covers it. A link write hands
   * over its own link; only an owner write names one (`mentionLinkId`), and only it hashes that choice.
   */
  private mentionRequest(caller:CallerContext,s:Awaited<ReturnType<DocumentReviewService["scope"]>>,originShareLinkId:string|null,input:{mentions?:unknown;mentionLinkId?:unknown}):MentionRequest {
    const ids=normalizeMentions(input.mentions,{writerId:caller.identity.id,ownerId:s.workspace.personalOwnerUserId ?? null});
    const owner=originShareLinkId===null;
    const linkId=owner && typeof input.mentionLinkId==="string"?input.mentionLinkId.toLowerCase():null;
    const hashed=ids.length?{mentions:[...ids].sort(),...(owner?{mentionLinkId:linkId}:{})}:{};
    return {ids,linkId,hashed};
  }
  /**
   * Every check a mention needs, before anything is written: each person exists, and the link handed to them
   * belongs to this document and opens now. Returns that link, or null when nobody is named.
   */
  private async mentionLink(r:KnowledgeRepositories,s:Awaited<ReturnType<DocumentReviewService["scope"]>>,originShareLinkId:string|null,mentions:MentionRequest):Promise<string|null> {
    if(!mentions.ids.length) return null;
    if((await r.users.findByIds(mentions.ids)).length!==mentions.ids.length) fail("INVALID_REQUEST","Mention only people who have signed in here.");
    if(originShareLinkId!==null) return originShareLinkId;
    const link=mentions.linkId===null?undefined:(await r.shareLinks.listByDocument(s.document.id)).find(l=>l.id.toLowerCase()===mentions.linkId && l.documentId===s.document.id);
    if(!link || !await this.linkValid(r,link)) fail("INVALID_REQUEST","Mention someone through a live share link of this document.");
    return link.id;
  }
  /** The people a comment names get a mention carrying the link, and follow the discussion through it (spec 2026-10-29 § Writing a mention). */
  private async mentionOnWrite(r:KnowledgeRepositories,s:Awaited<ReturnType<DocumentReviewService["scope"]>>,carriedLinkId:string|null,comment:ReviewComment,mentions:string[]) {
    if(carriedLinkId===null || !mentions.length) return;
    await r.reviewMentions.insertMany(mentions.map(mentionedUserId=>({commentId:comment.id,mentionedUserId,shareLinkId:carriedLinkId,createdAt:comment.createdAt,readAt:null})));
    let links:DocumentShareLink[]|undefined;
    const currentLinkValid=async(linkId:string)=>{
      links??=await r.shareLinks.listByDocument(s.document.id);
      const link=links.find(l=>l.id.toLowerCase()===linkId.toLowerCase());
      return !!link && this.linkValid(r,link);
    };
    for(const userId of mentions) await r.reviewFollows.followForMention({threadId:comment.threadId,userId,shareLinkId:carriedLinkId,at:this.clock(),currentLinkValid});
  }
  private async reply(r:KnowledgeRepositories,caller:CallerContext,s:Awaited<ReturnType<DocumentReviewService["scope"]>>,originShareLinkId:string|null,input:{threadId:string;body:string;idempotencyKey:string;mentions?:unknown;mentionLinkId?:unknown}) {
    const body=validateReviewBody(input.body),key=validateReviewIdempotencyKey(input.idempotencyKey),mentions=this.mentionRequest(caller,s,originShareLinkId,input),requestHash=hash({threadId:input.threadId,body,...mentions.hashed});
    const thread=await r.reviewThreads.lockById(input.threadId);
    if(!thread || thread.documentId!==s.document.id || thread.visibility==="HIDDEN" || isRetractedThread(await r.reviewComments.listByThread(thread.id))) throw new ShareLinkNotFoundError();
    const existing=await r.reviewComments.findByIdempotencyKey(thread.id,caller.identity.id,key);
    if(existing) {if(existing.requestHash!==requestHash) fail("IDEMPOTENCY_KEY_REUSED","The idempotency key was already used for a different request."); return projectReviewComment(existing,caller.identity.id);}
    this.enabled();this.active(s);
    if(thread.status!=="OPEN") fail("REVIEW_THREAD_CLOSED","Reopen the discussion before replying.");
    if(await r.reviewComments.countByThread(thread.id)>REVIEW_LIMITS.replies) fail("CAPACITY_EXCEEDED","The discussion reply limit was reached.");
    await this.quota(r,caller.identity.id,s.document.id);
    const carriedLinkId=await this.mentionLink(r,s,originShareLinkId,mentions);
    const comment=this.comment(thread.id,caller.identity.id,body,key,requestHash);await r.reviewComments.insert(comment);await this.charge(r,caller.identity.id,s.document.id);
    await this.notifyOwner(r,caller,s,originShareLinkId,comment);
    await this.followOnWrite(r,caller,s,originShareLinkId,thread.id);
    await this.mentionOnWrite(r,s,carriedLinkId,comment,mentions.ids);
    return projectReviewComment(comment,caller.identity.id);
  }
  async editForLink(caller:CallerContext,input:{token:string;threadId:string;commentId:string;body:string}) { return this.uow.run(async r=>this.edit(r,caller,await this.linkScope(r,input.token),input)); }
  async editForOwner(caller:CallerContext,input:{documentId:string;threadId:string;commentId:string;body:string}) { return this.uow.run(async r=>this.edit(r,caller,await this.ownerScope(r,caller,input.documentId),input)); }
  async deleteForLink(caller:CallerContext,input:{token:string;threadId:string;commentId:string}) { await this.uow.run(async r=>this.retract(r,caller,await this.linkScope(r,input.token),input)); }
  async deleteForOwner(caller:CallerContext,input:{documentId:string;threadId:string;commentId:string}) { await this.uow.run(async r=>this.retract(r,caller,await this.ownerScope(r,caller,input.documentId),input)); }
  /** A comment as its author reaches it. To anyone else — the document's owner included — it is not there. */
  private async authored(r:KnowledgeRepositories,caller:CallerContext,s:Awaited<ReturnType<DocumentReviewService["scope"]>>,input:{threadId:string;commentId:string}) {
    const thread=await r.reviewThreads.lockById(input.threadId);
    if(!thread || thread.documentId!==s.document.id || thread.visibility==="HIDDEN") throw new ShareLinkNotFoundError();
    const comment=await r.reviewComments.findById(input.commentId);
    if(!comment || comment.threadId!==thread.id || comment.authorUserId!==caller.identity.id) throw new ShareLinkNotFoundError();
    return {thread,comment};
  }
  /** An edit is a write like a reply: the switch, an open thread, the hourly limit. No earlier body is kept. */
  private async edit(r:KnowledgeRepositories,caller:CallerContext,s:Awaited<ReturnType<DocumentReviewService["scope"]>>,input:{threadId:string;commentId:string;body:string}) {
    const body=validateReviewBody(input.body);
    const {thread,comment}=await this.authored(r,caller,s,input);
    if(comment.deletedAt || comment.visibility==="HIDDEN") throw new ShareLinkNotFoundError();
    if(comment.body===body) return projectReviewComment(comment,caller.identity.id);
    this.enabled();this.active(s);
    if(thread.status!=="OPEN") fail("REVIEW_THREAD_CLOSED","Reopen the discussion before editing a comment.");
    await this.quota(r,caller.identity.id,s.document.id);
    const editedAt=this.clock();await r.reviewComments.setBody(comment.id,body,editedAt);await this.charge(r,caller.identity.id,s.document.id);
    return projectReviewComment({...comment,body,editedAt},caller.identity.id);
  }
  /** A retraction adds nothing, so it is held to none of what a write is: not the switch, the status or the limit. */
  private async retract(r:KnowledgeRepositories,caller:CallerContext,s:Awaited<ReturnType<DocumentReviewService["scope"]>>,input:{threadId:string;commentId:string}) {
    const {comment}=await this.authored(r,caller,s,input);
    if(!comment.deletedAt) await r.reviewComments.markDeleted(comment.id,this.clock());
  }
  async setResolution(caller:CallerContext,input:{documentId:string;threadId:string;status:ReviewStatus}) {
    if(!["OPEN","RESOLVED"].includes(input.status)) fail("INVALID_REQUEST","Invalid discussion status.");
    await this.uow.run(async r=>{const s=await this.ownerScope(r,caller,input.documentId);this.active(s);const t=await r.reviewThreads.lockById(input.threadId);if(!t||t.documentId!==s.document.id) throw new ShareLinkNotFoundError();if(t.status===input.status)return;
      if(input.status==="OPEN"&&t.visibility==="VISIBLE"&&await r.reviewThreads.countVisibleOpenByCreator(s.document.id,t.createdBy)>=REVIEW_LIMITS.visibleOpenPerCreator) fail("CAPACITY_EXCEEDED","The visible discussion limit was reached.");
      await r.reviewThreads.setResolution(t.id,input.status,caller.identity.id,this.clock());await this.audit(r,caller,s.workspace.id,s.document.id,t.id,"DOCUMENT_REVIEW_RESOLUTION_CHANGED",undefined,input.status);});
  }
  async setVisibility(caller:CallerContext,input:{documentId:string;threadId:string;commentId?:string;visibility:ReviewVisibility;reason?:string}) {
    if(!["VISIBLE","HIDDEN"].includes(input.visibility)) fail("INVALID_REQUEST","Invalid discussion visibility.");
    if(input.reason!==undefined&&(typeof input.reason!=="string"||[...input.reason].length>200)) fail("INVALID_REQUEST","Moderation reason is too long.");
    await this.uow.run(async r=>{const s=await this.ownerScope(r,caller,input.documentId);const t=await r.reviewThreads.lockById(input.threadId);if(!t||t.documentId!==s.document.id)throw new ShareLinkNotFoundError();
      const comments=await r.reviewComments.listByThread(t.id);const c=input.commentId?comments.find(c=>c.id===input.commentId):undefined;if(input.commentId&&!c)throw new ShareLinkNotFoundError();
      const target=c&&comments[0]?.id!==c.id?c:t;if(target.visibility===input.visibility)return;
      if(target===t&&input.visibility==="VISIBLE")await this.capacity(r,s.document.id,t.createdBy,t.status==="OPEN");
      await (target===t?r.reviewThreads:r.reviewComments).setVisibility(target.id,input.visibility,caller.identity.id,this.clock(),input.reason??null);
      await this.audit(r,caller,s.workspace.id,s.document.id,t.id,"DOCUMENT_REVIEW_VISIBILITY_CHANGED",target===t?undefined:target.id,input.visibility);
    });
  }
  private async audit(r:KnowledgeRepositories,caller:CallerContext,workspaceId:string,documentId:string,threadId:string,eventType:string,commentId?:string,action?:string) {await r.auditEvents.append({id:uuidv7(),workspaceId,actorUserId:caller.identity.id,actorKind:"USER",eventType,targetType:"DOCUMENT_REVIEW_THREAD",targetId:threadId,payload:{documentId,threadId,action,...(commentId?{commentId}:{})},correlationId:null,createdAt:this.clock()});}
}
