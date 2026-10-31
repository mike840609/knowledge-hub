import { createHash } from "node:crypto";
import type { CallerContext } from "@/modules/identity/domain/caller-context";
import { DomainError } from "@/shared/domain/errors";
import { isUuid, uuidv7 } from "@/shared/ids/uuidv7";
import { isShareToken, ShareLinkNotFoundError } from "../domain/document-share-link";
import { REVIEW_LIMITS, isRetractedThread, projectOwnerThread, projectReviewerThread, projectReviewComment, validateReviewBody, validateReviewIdempotencyKey, type ReviewThread, type ReviewComment, type ReviewCommentView, type ReviewAnchor, type ReviewStatus, type ReviewVisibility, type ReviewThreadView, type OwnerReviewThreadView, type CreateReviewThreadInput, type CreateOwnerReviewThreadInput, type ReplyReviewInput, type ReplyOwnerReviewInput } from "../domain/document-review";
import { MENTION_LIMIT, MENTION_PREFIX, normalizeMentions, splitMentions, type MentionedPerson, type ReviewMention } from "../domain/review-mention";
import { followForMention } from "./follow-for-mention";
import { createReviewAnchorRelocator, validateReviewAnchor } from "../domain/review-anchor";
import { projectShareCommentNotification, EXCERPT_LIMIT, type ShareCommentNotificationView } from "../domain/share-comment-event";
import { orderFollowedDiscussions, summarizeFollowedThread, type FollowedDiscussionView } from "../domain/review-follow";
import type { DocumentShareLink } from "../domain/document-share-link";
import type { KnowledgeDocument } from "../domain/document";
import type { SourcePolicy } from "../domain/source-policy";
import type { Workspace } from "@/modules/workspaces/domain/workspace";
import { evaluateWorkspaceCapabilities } from "@/modules/workspaces/application/workspace-authorization";
import type { KnowledgeRepositories, KnowledgeUnitOfWork } from "../ports/unit-of-work";
import { documentReachesFolder, linkOpens, openShareLinkTarget, reachableChain } from "./internal/folder-link-reach";

function fail(code:string, message:string):never { throw new DomainError(code,message); }
function canonicalAnchor(a:ReviewAnchor) { if(!a || typeof a!=="object") fail("INVALID_REQUEST","Provide an anchor."); return {schemaVersion:a.schemaVersion,blockPath:a.blockPath,blockKind:a.blockKind,startUtf16:a.startUtf16,endUtf16:a.endUtf16,exact:a.exact,prefix:a.prefix,suffix:a.suffix}; }
const hash = (payload:unknown) => createHash("sha256").update(JSON.stringify(payload)).digest("hex");
const FOLLOW_PREFIX = "follow:";
const FOLLOW_LIMIT = 100;
/** The mentions a write carries: validated ids and, for the owner, the link they hand over. `hashed` joins the request hash only when someone is named. */
type MentionRequest = { ids: string[]; linkId: string | null; hashed: Record<string, unknown> };
/** A followed discussion on a folder link names its document, which that link's page needs (`?d=`); a document link's needs none. */
const folderDocument = (link: DocumentShareLink, documentId: string) => link.target.kind === "FOLDER" ? { documentId } : {};
const newestFirst = (views: ShareCommentNotificationView[]) => views.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));
/** The document, Source and Workspace a review request lands on. */
type LocatedScope = { document:KnowledgeDocument; source:SourcePolicy; workspace:Workspace };
/**
 * Who may discuss a document: the personal owner, a live share link's document,
 * or a member of the publication's team. `ownerUserId` is who review calls the
 * owner — the personal owner or the team document's creator — and `canModerate`
 * is judged separately from membership.
 */
type ReviewScope = LocatedScope & { ownerUserId:string; canModerate:boolean; team:boolean };
type DiscussionQueryBase = { revisionId:string|null; writesEnabled:boolean; callerUserId:string; ownerUserId:string };
/** The owner route answers one of two explicit projections; `canModerate` discriminates them. */
export type DiscussionQueryView =
  | (DiscussionQueryBase & { canModerate:true; threads:OwnerReviewThreadView[] })
  | (DiscussionQueryBase & { canModerate:false; threads:ReviewThreadView[] });
/** Capabilities are read once per request per Workspace; the caller's groups are never cached across requests. */
type CapabilityOf = (workspaceId:string)=>ReturnType<typeof evaluateWorkspaceCapabilities>;
type RequestAccess = { capabilityOf:CapabilityOf; readable:(documentId:string)=>Promise<ReviewScope|null> };
/** A mention as an Inbox entry either names nothing, or carries its thread, comment and reach. */
type JudgedMention =
  | { mention: ReviewMention }
  | { mention: ReviewMention; thread: ReviewThread; comment: ReviewComment; link: DocumentShareLink | null; team: boolean; workspaceId: string; sourceId: string };
export class DocumentReviewService {
  constructor(
    private readonly uow:KnowledgeUnitOfWork,
    private readonly clock:()=>Date=()=>new Date(),
    private readonly writesEnabled:()=>boolean=()=>false,
    /** `KM_TEAM_WORKSPACES_ENABLED`; team discussion is closed while publishing is closed. */
    private readonly teamsEnabled:()=>boolean=()=>false,
  ) {}
  /**
   * The one entry that answers without a caller: a live share token reads the visible discussion.
   * It takes no locks. A reader must never queue the owner's edits or a folder sync behind a page
   * load, and it writes nothing a lock would protect; `readShared` reads the same way.
   * `documentId` is the document a folder link's page is reading (folder share spec §6).
   */
  async queryForLink(caller:CallerContext | null,token:string,documentId?:string) {
    return this.uow.run(async r => { const s=await this.linkScope(r,token,false,documentId); return {threads:await this.withFollowing(r,s,caller,await this.views(r,s.document.id,false,caller?.identity.id)),revisionId:s.document.currentRevisionId,writesEnabled:!!caller && this.writesEnabled(),callerUserId:caller?.identity.id ?? null}; });
  }
  /**
   * The owner query keeps its route and JSON keys. A moderator (the personal
   * owner, the team creator or an admin) receives the moderator projection; an
   * ordinary team member receives the member projection, which carries no
   * moderation metadata. `canModerate` says which one the caller got.
   */
  async queryForOwner(caller:CallerContext,documentId:string):Promise<DiscussionQueryView> {
    return this.uow.run(async r => {
      const s=await this.documentScope(r,caller,documentId,false);
      const base={revisionId:s.document.currentRevisionId,writesEnabled:this.writesEnabled(),callerUserId:caller.identity.id,ownerUserId:s.ownerUserId};
      return s.canModerate
        ? {...base,canModerate:true as const,threads:await this.views(r,documentId,true,caller.identity.id)}
        : {...base,canModerate:false as const,threads:await this.views(r,documentId,false,caller.identity.id)};
    });
  }
  /** Only events owned by or explicitly delivered to the caller are selected at the repository boundary. */
  private async notificationViews(r: KnowledgeRepositories, events: Awaited<ReturnType<KnowledgeRepositories["shareCommentEvents"]["listUnreadByRecipient"]>>, caller: CallerContext, access: RequestAccess, includeUnavailable: boolean) {
    const views = [];
    for (const e of events) {
      const team = e.recipientUserId != null;
      if (team && !await access.readable(e.documentId)) {
        // An entry whose member access is gone stays in history, naming nothing and leading nowhere.
        if (includeUnavailable) views.push({
          id: e.id, workspaceId: "", documentId: "", sourceId: "", documentTitle: "",
          threadId: e.threadId, commentId: e.commentId, authorName: undefined, excerpt: "",
          createdAt: e.createdAt, readAt: e.readAt, threadStatus: "OPEN" as const, kind: "OWNER" as const,
          access: { kind: "TEAM" as const, available: false },
        });
        continue;
      }
      const thread = await r.reviewThreads.findById(e.threadId);
      const document = await r.documents.findById(e.documentId);
      const revision = await r.revisions.findCurrent(e.documentId);
      const comments = await r.reviewComments.listByThread(e.threadId);
      const comment = comments.find(c => c.id === e.commentId);
      if (!thread || thread.visibility === "HIDDEN" || isRetractedThread(comments)) continue;
      if (!document || !revision || !comment || comment.deletedAt || comment.visibility === "HIDDEN") continue;
      const author = await r.users.findById(e.createdByUserId);
      views.push({
        ...projectShareCommentNotification({
          id: e.id, workspaceId: e.workspaceId, documentId: e.documentId,
          sourceId: document.sourceId, documentTitle: revision.title,
          threadId: e.threadId, commentId: e.commentId,
          authorName: author?.name, body: comment.body, createdAt: e.createdAt,
          readAt: e.readAt, threadStatus: thread.status,
        }),
        kind: "OWNER" as const,
        ...(team ? { access: { kind: "TEAM" as const, available: true } } : {}),
      });
    }
    return views;
  }
  /**
   * The unread SQL window may be full of Team events whose access was revoked.
   * Keep those unread for a future re-grant, but page past them so they cannot
   * hide older personal or accessible Team notifications.
   */
  private async readableUnreadEvents(r: KnowledgeRepositories, caller: CallerContext, access: RequestAccess): Promise<ShareCommentNotificationView[]> {
    const visible: ShareCommentNotificationView[] = [];
    let before: { createdAt: Date; id: string } | undefined;
    while (visible.length < FOLLOW_LIMIT) {
      const rows = await r.shareCommentEvents.listUnreadByRecipient(caller.identity.id, before, FOLLOW_LIMIT);
      if (rows.length === 0) break;
      const views = await this.notificationViews(r, rows, caller, access, false);
      visible.push(...views.slice(0, FOLLOW_LIMIT - visible.length));
      if (rows.length < FOLLOW_LIMIT) break;
      const last = rows[rows.length - 1];
      before = { createdAt: last.createdAt, id: last.id };
    }
    return visible;
  }

  /** The caller's unread: comments on their documents or team documents, replies in discussions they follow, and comments naming them. */
  async listUnreadForOwner(caller: CallerContext) {
    return this.uow.run(async r => {
      const access = this.requestAccess(r, caller);
      return {
        notifications: newestFirst([
          ...await this.readableUnreadEvents(r, caller, access),
          ...(await this.followViews(r, caller.identity.id)).filter(view => view.readAt === null),
          ...(await this.mentionViews(r, await this.unreadMentions(r, caller, access), caller, access))
            .filter(view => view.readAt === null && (view.access?.kind !== "TEAM" || view.access.available)),
        ]),
      };
    });
  }
  /** The Inbox badge: as many as `listUnreadForOwner` lists, without loading a title or author. */
  async countUnreadForOwner(caller: CallerContext): Promise<{ count: number }> {
    return this.uow.run(async r => {
      const access = this.requestAccess(r, caller);
      const rows = await r.shareCommentEvents.listUnreadCountsByRecipient(caller.identity.id);
      // A team row counts only while the caller still holds document.read; personal rows always do.
      let owner = 0;
      for (const row of rows) {
        if (row.recipientUserId === null || await access.readable(row.documentId)) owner += row.unreadCount;
      }
      const follows = (await this.followedThreads(r, caller.identity.id)).filter(({ summary }) => !("unavailable" in summary) && !!summary.latestReply && summary.unread > 0).length;
      const mentions = (await this.judgedMentions(r, await this.unreadMentions(r, caller, access), caller, access)).filter(judged => "comment" in judged).length;
      return { count: owner + follows + mentions };
    });
  }
  /** Lightweight counts for My shares. Team entries are not share-link activity and stay out of every per-share row. */
  async listUnreadShareCountsForOwner(caller: CallerContext) {
    return this.uow.run(async r => (await r.shareCommentEvents.listUnreadCountsByRecipient(caller.identity.id))
      .filter(row => row.recipientUserId === null)
      .map(row => ({ documentId: row.documentId, shareLinkId: row.shareLinkId, unreadCount: row.unreadCount, latestThreadId: row.latestThreadId })));
  }
  /** A bounded, cursor-paged cross-document activity feed, including already-read comments. */
  async listActivityForOwner(caller: CallerContext, before?: { createdAt: Date; id: string }) {
    return this.uow.run(async r => {
      const access = this.requestAccess(r, caller);
      const size = 50;
      const events = await r.shareCommentEvents.listRecentByRecipient(caller.identity.id, before, size + 1);
      const page = events.slice(0, size);
      // Follows and mentions are not paged: at most FOLLOW_LIMIT each, all on the first page (specs 2026-10-22, 2026-10-29, deviation).
      const follows = before ? [] : await this.followViews(r, caller.identity.id);
      const mentions = before ? [] : await this.mentionViews(r, await r.reviewMentions.listRecentByRecipient(caller.identity.id, FOLLOW_LIMIT), caller, access);
      return {
        notifications: newestFirst([...await this.notificationViews(r, page, caller, access, true), ...follows, ...mentions]),
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
      if (!isUuid(commentId)) return;
      await this.uow.run(async r => {
        // Resolve comment → thread → document before touching read state. A
        // link-less team mention is meaningful only while the caller still
        // holds document.read; clearing it after access was removed would defeat
        // the retained-row rule (the row must come back unread on re-grant).
        const located = await r.reviewComments.listThreadIdsByCommentIds([commentId]);
        const threadId = located[0]?.threadId;
        if (threadId === undefined) return;
        const mention = (await r.reviewMentions.findByThreads(caller.identity.id, [threadId]))
          .find(candidate => candidate.commentId === commentId);
        if (!mention) return;
        if (mention.shareLinkId === null) {
          const thread = await r.reviewThreads.findById(threadId);
          if (!thread || !await this.requestAccess(r, caller).readable(thread.documentId)) {
            throw new ShareLinkNotFoundError();
          }
        }
        await r.reviewMentions.markRead(caller.identity.id, commentId, this.clock());
      });
      return;
    }
    await this.uow.run(async r => {
      if (eventId.startsWith(FOLLOW_PREFIX)) {
        await r.reviewFollows.markSeen(eventId.slice(FOLLOW_PREFIX.length), caller.identity.id, this.clock());
        return;
      }
      const event = await r.shareCommentEvents.findById(caller.identity.id, eventId);
      if (!event) return;
      // A team notice is refused, not silently skipped, once the caller can no longer read its document.
      if (event.recipientUserId !== null && !await this.requestAccess(r, caller).readable(event.documentId)) throw new ShareLinkNotFoundError();
      await r.shareCommentEvents.markEventRead(caller.identity.id, eventId, this.clock());
    });
  }
  async markAllActivityRead(caller: CallerContext) {
    await this.uow.run(async r => {
      const at = this.clock();
      const access = this.requestAccess(r, caller);
      // Personal rows are all the caller's; team rows are marked by id only after their access is judged.
      await r.shareCommentEvents.markAllRead(caller.identity.id, at);
      const teamEvents = await r.shareCommentEvents.listUnreadTeamByRecipient(caller.identity.id);
      const readable: string[] = [];
      for (const event of teamEvents) if (await access.readable(event.documentId)) readable.push(event.id);
      await r.shareCommentEvents.markEventsRead(caller.identity.id, readable, at);
      await r.reviewFollows.markAllSeen(caller.identity.id, at);
      await r.reviewMentions.markAllRead(caller.identity.id, at);
      const teamMentions = await r.reviewMentions.listUnreadTeamByRecipient(caller.identity.id);
      for (const judged of await this.judgedMentions(r, teamMentions, caller, access)) {
        if ("comment" in judged) await r.reviewMentions.markRead(caller.identity.id, judged.mention.commentId, at);
      }
    });
  }
  /** The owner has looked at one discussion: its notices are read, the rest of the document's are not. */
  async markThreadRead(caller: CallerContext, documentId: string, threadId: string) {
    await this.uow.run(async r => {
      await this.documentScope(r, caller, documentId, false);
      await r.shareCommentEvents.markThreadRead(caller.identity.id, documentId, threadId, this.clock());
    });
  }
  /** A signed-in reader on a live link follows, or stops following, one of its discussions. Adds no words, so writes need not be enabled. */
  async followForLink(caller: CallerContext, input: { token: string; documentId?: string; threadId: string; following: boolean }) {
    return this.uow.run(async r => {
      const s = await this.linkThread(r, input.token, input.threadId, input.documentId);
      if (s.workspace.personalOwnerUserId === caller.identity.id) return { following: false };
      if (input.following) await r.reviewFollows.follow({ threadId: input.threadId, userId: caller.identity.id, shareLinkId: s.link.id, at: this.clock() });
      else await r.reviewFollows.unfollow(input.threadId, caller.identity.id, this.clock());
      return { following: input.following };
    });
  }
  /** People to @-mention, for a caller who could write a comment on this document now: a live link, or the owner. Reads only. */
  async searchMentionCandidates(caller: CallerContext, input: { query: string; token?: string; documentId?: string }) {
    if (input.token === undefined && input.documentId === undefined) fail("INVALID_REQUEST", "Provide a share link or a document.");
    // A malformed id would make MariaDB's UUID column raise rather than match nothing.
    if (input.token === undefined && !isUuid(input.documentId!)) throw new ShareLinkNotFoundError();
    return this.uow.run(async r => {
      const s = input.token !== undefined ? await this.linkScope(r, input.token, false, input.documentId) : await this.documentScope(r, caller, input.documentId!, false);
      this.enabled(); this.active(s);
      const query = input.query.trim().slice(0, 200);
      if (!query) return { candidates: [] };
      // The writer and the document's owner are never recorded as mentioned (`normalizeMentions`), so they are not offered.
      const skip = new Set([caller.identity.id, s.ownerUserId]);
      if (s.team) {
        // Group membership can only be judged for the current caller, so only direct rows can be listed.
        // A group-only member can still read and comment; they are simply never offered as candidates.
        const direct = (await r.workspaceMemberships.listByWorkspace(s.workspace.id))
          .filter(membership => membership.membershipSource !== "SYSTEM_PERSONAL")
          .map(membership => membership.userId);
        const needle = query.toLowerCase();
        const found = (await r.users.findByIds(direct))
          .filter(user => !skip.has(user.id) && [user.name, user.emp_id, user.nameEn].some(value => value?.toLowerCase().includes(needle)))
          .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
          .slice(0, MENTION_LIMIT);
        return { candidates: found.map(user => ({ id: user.id, name: user.name, nameEn: user.nameEn, empId: user.emp_id })) };
      }
      const found = (await r.users.searchExisting(query, MENTION_LIMIT + skip.size)).filter(u => !skip.has(u.id)).slice(0, MENTION_LIMIT);
      return { candidates: found.map(u => ({ id: u.id, name: u.name, nameEn: u.nameEn, empId: u.emp_id })) };
    });
  }
  /**
   * The links an owner may hand over when mentioning on their document: those that open it now, a link of the
   * document itself or of a folder above it. Reads only.
   */
  async mentionLinksForOwner(caller: CallerContext, input: { documentId: string }) {
    if (!isUuid(input.documentId)) throw new ShareLinkNotFoundError();
    return this.uow.run(async r => {
      const s = await this.documentScope(r, caller, input.documentId, false);
      this.enabled(); this.active(s);
      // Team mentions hand over no share link: the pointed document is readable only by members.
      if (s.team) return { links: [] };
      const chain = (await r.tree.listChainsByDocumentIds([s.document.id], s.document.sourceId)).get(s.document.id) ?? [];
      const folderIds = chain.slice(1).filter(node => node.nodeType === "FOLDER").map(node => node.id);
      const candidates = [...await r.shareLinks.listByDocument(s.document.id)];
      for (const folderId of folderIds) candidates.push(...await r.shareLinks.listByFolder(folderId));
      const links: Array<{ id: string; label: string | null }> = [];
      for (const link of candidates) if (await this.linkValid(r, link, s.document.id)) links.push({ id: link.id, label: link.label });
      return { links };
    });
  }
  /** The reader has looked at a discussion: its follow, if any, is seen and their mentions in it are read. */
  async markSeenForLink(caller: CallerContext, input: { token: string; documentId?: string; threadId: string }) {
    await this.uow.run(async r => {
      await this.linkThread(r, input.token, input.threadId, input.documentId);
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
          threadId: thread.id, linkAvailable: true, token: link!.token, ...folderDocument(link!, thread.documentId), documentTitle: revision?.title ?? "", threadStatus: thread.status,
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
  private async linkThread(r: KnowledgeRepositories, token: string, threadId: string, documentId: string | undefined) {
    const s = await this.linkScope(r, token, false, documentId);
    const thread = typeof threadId === "string" ? await r.reviewThreads.findById(threadId) : null;
    if (!thread || thread.documentId !== s.document.id || thread.visibility === "HIDDEN" || isRetractedThread(await r.reviewComments.listByThread(thread.id))) throw new ShareLinkNotFoundError();
    return s;
  }
  private async withFollowing(r: KnowledgeRepositories, s: LocatedScope, caller: CallerContext | null, threads: ReviewThreadView[]): Promise<ReviewThreadView[]> {
    if (!caller || s.workspace.personalOwnerUserId === caller.identity.id) return threads;
    const followed = await r.reviewFollows.followingThreadIds(caller.identity.id, threads.map(thread => thread.id));
    return threads.map(thread => ({ ...thread, following: followed.has(thread.id) }));
  }
  /**
   * The caller's followed discussions with their link's state, judged now. Comments, threads and
   * links each come in one query; a folder link's reachability is judged once for all its followed
   * documents, with their chains read in one batch.
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
    // Only a live mention is that entry: a dead one shows nothing, so its comment still counts here if the follow's link opens.
    const named = await r.reviewMentions.findByThreads(userId, [...commentsByThread.keys()]);
    const excludeCommentIds = new Set((await this.judgedMentions(r, named)).filter(judged => "comment" in judged).map(judged => judged.mention.commentId));
    const threadIds = [...new Set(follows.map(follow => follow.threadId))];
    const threads = new Map((await r.reviewThreads.findByIds(threadIds)).map(thread => [thread.id, thread]));
    const linkIds = [...new Set(follows.map(follow => follow.shareLinkId))];
    const links = new Map((await r.shareLinks.findByIds(linkIds)).map(link => [link.id, link]));
    const documentsByLink = new Map<string, Set<string>>();
    for (const follow of follows) {
      const thread = threads.get(follow.threadId);
      if (!thread) continue;
      const documents = documentsByLink.get(follow.shareLinkId) ?? new Set<string>();
      documents.add(thread.documentId);
      documentsByLink.set(follow.shareLinkId, documents);
    }
    // One judgement per link: a document link once, a folder link once for all its followed documents.
    const reachable = new Map<string, ReadonlySet<string> | null>();
    for (const [linkId, documentIds] of documentsByLink) {
      const link = links.get(linkId);
      if (!link) { reachable.set(linkId, null); continue; }
      reachable.set(linkId, link.target.kind === "DOCUMENT"
        ? (await this.linkValid(r, link, link.target.documentId) ? new Set([link.target.documentId]) : null)
        : await this.folderLinkDocuments(r, link, [...documentIds]));
    }
    const found = [];
    for (const follow of follows) {
      const thread = threads.get(follow.threadId);
      if (!thread) continue;
      const link = links.get(follow.shareLinkId) ?? null;
      const linkValid = reachable.get(follow.shareLinkId)?.has(thread.documentId) ?? false;
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
        ...folderDocument(link!, thread.documentId), kind: "FOLLOW", token: link!.token, replyCount: summary.unread, linkAvailable: true,
      });
    }
    return views;
  }
  /**
   * The given mentions (newest first, at most FOLLOW_LIMIT), each judged now: live only while its carried link opens and the
   * comment and its discussion stand visible (`projectReviewerThread`'s rules). Anything else is dead.
   *
   * Two phases keep access ahead of content: comment ids resolve to their threads, a link-less team
   * mention's `document.read` is judged, and only then are comment bodies and discussion comments
   * read. A personal mention keeps its live-link judgement, which also reads no body.
   * ponytail: at most FOLLOW_LIMIT mentions; paging once readers are named more.
   */
  private async judgedMentions(r: KnowledgeRepositories, mentions: readonly ReviewMention[], caller?: CallerContext, access?: RequestAccess):Promise<JudgedMention[]> {
    if (mentions.length === 0) return [];
    const judge = access ?? (caller ? this.requestAccess(r, caller) : undefined);
    type Pending = Extract<JudgedMention, { thread: ReviewThread }>;
    type Slot = JudgedMention;

    // Phase 1: ids only. No comment body, title or author is loaded before access is judged.
    const located = await r.reviewComments.listThreadIdsByCommentIds(mentions.map(mention => mention.commentId));
    const threadIdByComment = new Map(located.map(row => [row.commentId, row.threadId]));
    const threadIds = [...new Set(located.map(row => row.threadId))];
    const threadsById = new Map((await r.reviewThreads.findByIds(threadIds)).map(thread => [thread.id, thread]));
    const linkIds = [...new Set(mentions.flatMap(mention => mention.shareLinkId === null ? [] : [mention.shareLinkId]))];
    const links = new Map((await r.shareLinks.findByIds(linkIds)).map(link => [link.id.toLowerCase(), link]));
    const opens = new Map<string, boolean>();
    const slots: Slot[] = [];
    for (const mention of mentions) {
      const thread = threadsById.get(threadIdByComment.get(mention.commentId) ?? "") ?? null;
      if (!thread || thread.visibility === "HIDDEN") { slots.push({ mention }); continue; }
      if (mention.shareLinkId === null) {
        // A team mention carries no link: it is live only while the caller still holds
        // document.read in the publication's team, judged now as the caller (groups included).
        const team = caller && judge ? await judge.readable(thread.documentId) : null;
        const document = team ? await r.documents.findById(thread.documentId) : null;
        slots.push(team && document
          ? { mention, thread, link: null, team: true, workspaceId: team.workspace.id, sourceId: document.sourceId }
          : { mention });
        continue;
      }
      const link = links.get(mention.shareLinkId.toLowerCase());
      // One judgement per link and document: a folder link reaches each document by its own chain.
      const key = `${mention.shareLinkId}:${thread.documentId}`;
      if (link && !opens.has(key)) opens.set(key, await this.linkValid(r, link, thread.documentId));
      slots.push(link && opens.get(key) ? { mention, thread, link, team: false, workspaceId: "", sourceId: "" } : { mention });
    }

    // Phase 2: only mentions that passed phase 1 have their discussion comments read.
    const pending = slots.filter((slot): slot is Pending => "thread" in slot);
    if (pending.length === 0) return slots;
    const pendingThreadIds = [...new Set(pending.map(slot => slot.thread.id))];
    const commentsByThread = new Map<string, ReviewComment[]>();
    for (const comment of await r.reviewComments.listByThreads(pendingThreadIds)) commentsByThread.set(comment.threadId, [...(commentsByThread.get(comment.threadId) ?? []), comment]);
    const live = new Map<string, Pending & { comment: ReviewComment }>();
    for (const slot of pending) {
      const comments = commentsByThread.get(slot.thread.id) ?? [];
      const comment = comments.find(candidate => candidate.id === slot.mention.commentId);
      if (!comment || isRetractedThread(comments) || comment.deletedAt || comment.visibility === "HIDDEN") continue;
      live.set(slot.mention.commentId, { ...slot, comment });
    }
    return slots.map(slot => live.get(slot.mention.commentId) ?? { mention: slot.mention });
  }
  /**
   * One request's team judgements. Capabilities are read once per Workspace for the whole request;
   * the caller's validated groups live on the caller and are never cached across requests.
   */
  private requestAccess(r: KnowledgeRepositories, caller: CallerContext): RequestAccess {
    const capabilities = new Map<string, ReturnType<CapabilityOf>>();
    const readableDocuments = new Map<string, Promise<ReviewScope | null>>();
    const capabilityOf: CapabilityOf = (workspaceId) => {
      const found = capabilities.get(workspaceId);
      if (found) return found;
      const judged = evaluateWorkspaceCapabilities({ workspaceMemberships: r.workspaceMemberships, groupMappings: r.groupMappings }, caller, workspaceId);
      capabilities.set(workspaceId, judged);
      return judged;
    };
    return {
      capabilityOf,
      readable: (documentId) => {
        const cached = readableDocuments.get(documentId);
        if (cached) return cached;
        const judged = (async () => {
          try {
            const s = await this.documentScope(r, caller, documentId, false, capabilityOf);
            return s.team ? s : null;
          } catch (error) {
            if (error instanceof ShareLinkNotFoundError) return null;
            throw error;
          }
        })();
        readableDocuments.set(documentId, judged);
        return judged;
      },
    };
  }
  /**
   * The caller's newest unread mentions that are live: the unread list and the badge read the same rows. A dead one
   * (its link no longer opens, its comment is gone or hidden) is marked read here, so it cannot fill the window and
   * hide an older live mention. ponytail: a thread the owner hides then restores, or a document moved out of a shared folder
   * and back, loses its unread mark.
   */
  private async unreadMentions(r: KnowledgeRepositories, caller: CallerContext, access?: RequestAccess) {
    const visible: ReviewMention[] = [];
    let before: { createdAt: Date; commentId: string } | undefined;
    while (visible.length < FOLLOW_LIMIT) {
      const unread = await r.reviewMentions.listUnreadByRecipient(caller.identity.id, FOLLOW_LIMIT, before);
      if (unread.length === 0) break;
      // A revoked Team mention must remain unread for re-grant, but must not
      // occupy the whole window and hide older, accessible personal mentions.
      // Dead personal link mentions retain the existing auto-read cleanup.
      for (const judged of await this.judgedMentions(r, unread, caller, access)) {
        if ("comment" in judged) visible.push(judged.mention);
        else if (judged.mention.shareLinkId !== null) {
          await r.reviewMentions.markRead(caller.identity.id, judged.mention.commentId, this.clock());
        }
        if (visible.length === FOLLOW_LIMIT) break;
      }
      if (unread.length < FOLLOW_LIMIT) break;
      const last = unread[unread.length - 1];
      before = { createdAt: last.createdAt, commentId: last.commentId };
    }
    return visible;
  }
  /** Mentions as Inbox entries, one per comment. A dead personal one names nothing and is never unread; a team one keeps its read state. */
  private async mentionViews(r: KnowledgeRepositories, mentions: readonly ReviewMention[], caller: CallerContext, access: RequestAccess): Promise<ShareCommentNotificationView[]> {
    const views: ShareCommentNotificationView[] = [];
    const titles = new Map<string, string>();
    const authorNames = new Map<string, string | undefined>();
    for (const judged of await this.judgedMentions(r, mentions, caller, access)) {
      const { mention } = judged;
      const base = { id: `${MENTION_PREFIX}${mention.commentId}`, workspaceId: "", documentId: "", sourceId: "", commentId: mention.commentId, createdAt: mention.createdAt };
      if (!("comment" in judged)) {
        // A team mention loses only its link's reach, not the caller's read state: losing access must
        // not mark it read, so regaining access shows the same unread entry again.
        const team = mention.shareLinkId === null;
        views.push({
          ...base, kind: "MENTION", commentId: "", threadId: "", documentTitle: "", authorName: undefined, excerpt: "",
          readAt: team ? mention.readAt : mention.createdAt, threadStatus: "OPEN", linkAvailable: false,
          ...(team ? { access: { kind: "TEAM" as const, available: false } } : {}),
        });
        continue;
      }
      const { thread, comment, link, team } = judged;
      if (!titles.has(thread.documentId)) titles.set(thread.documentId, (await r.revisions.findCurrent(thread.documentId))?.title ?? "");
      if (!authorNames.has(comment.authorUserId)) authorNames.set(comment.authorUserId, (await r.users.findById(comment.authorUserId))?.name);
      views.push({
        ...projectShareCommentNotification({
          ...base, ...(team ? { workspaceId: judged.workspaceId, documentId: thread.documentId, sourceId: judged.sourceId } : {}),
          threadId: thread.id, documentTitle: titles.get(thread.documentId)!, authorName: authorNames.get(comment.authorUserId), body: comment.body, readAt: mention.readAt, threadStatus: thread.status,
        }),
        ...(link ? folderDocument(link, thread.documentId) : {}), kind: "MENTION", ...(link ? { token: link.token } : {}),
        ...(team ? { access: { kind: "TEAM" as const, available: true } } : {}),
        linkAvailable: true,
      });
    }
    return views;
  }
  /**
   * Every named document a folder link reaches now. The link, folder, Source, Workspace and
   * membership are judged once; only the per-document chain is read in a batch, so a reader who
   * follows many discussions through one folder does not pay for the link once per document.
   */
  private async folderLinkDocuments(r: KnowledgeRepositories, link: DocumentShareLink, documentIds: readonly string[]): Promise<ReadonlySet<string> | null> {
    if (link.target.kind !== "FOLDER" || documentIds.length === 0) return null;
    const folder = await r.tree.findById(link.target.folderNodeId);
    if (!folder || folder.nodeType !== "FOLDER") return null;
    if (!await openShareLinkTarget(r, link, folder, this.clock())) return null;
    const documents = new Map((await r.documents.findByIds(documentIds)).map(document => [document.id, document]));
    const chains = await r.tree.listChainsByDocumentIds(documentIds, folder.sourceId);
    const reachable = new Set<string>();
    for (const documentId of documentIds) {
      const document = documents.get(documentId);
      if (document && documentReachesFolder(folder, document, chains.get(documentId))) reachable.add(documentId);
    }
    return reachable;
  }

  /** Whether the link opens now on this document: the same judgement `linkScope` makes, without refusing. */
  private async linkValid(r: KnowledgeRepositories, link: DocumentShareLink, documentId: string): Promise<boolean> {
    if (link.target.kind === "DOCUMENT" && link.target.documentId !== documentId) return false;
    try {
      await this.targetScope(r, link, link.target.kind === "FOLDER" ? documentId : undefined, false);
      return true;
    } catch (error) {
      if (error instanceof ShareLinkNotFoundError) return false;
      throw error;
    }
  }
  /** `targetStatus` is the link's target's: its document's, or its folder node's (folder share spec §2). */
  private async opens(r: KnowledgeRepositories, scope: LocatedScope, link: DocumentShareLink, targetStatus: "ACTIVE" | "ARCHIVED"): Promise<boolean> {
    const membership = await r.workspaceMemberships.find(scope.workspace.id, link.createdBy);
    return linkOpens(link, targetStatus, scope.source, scope.workspace, membership ? membership.role ?? null : undefined, this.clock());
  }
  /** Marks this document's events read. Owner scope first: a non-owner reaches nothing. */
  async markDocumentRead(caller:CallerContext,documentId:string) {
    await this.uow.run(async r => {
      await this.documentScope(r,caller,documentId,false);
      await r.shareCommentEvents.markDocumentRead(caller.identity.id,documentId,this.clock());
    });
  }
  /**
   * The people each shown comment mentions, as they are now, kept only where the body still names
   * them (`splitMentions`). One read of the rows and one of the users for the whole discussion.
   */
  private async attachMentions(r:KnowledgeRepositories,shown:readonly {view:ReviewCommentView;body:string}[]) {
    const rows=await r.reviewMentions.listMentionedUsersByComments(shown.map(s=>s.view.id));
    if(rows.length===0) return;
    const users=await r.users.findByIds([...new Set(rows.map(row=>row.mentionedUserId))]);
    const people=new Map(users.map(u=>[u.id,{name:u.name,nameEn:u.nameEn,empId:u.emp_id} satisfies MentionedPerson]));
    const byComment=new Map<string,MentionedPerson[]>();
    for(const row of rows) {
      const person=people.get(row.mentionedUserId);
      if(person) byComment.set(row.commentId,[...(byComment.get(row.commentId) ?? []),person]);
    }
    for(const {view,body} of shown) {
      const named=byComment.get(view.id) ?? [];
      const occurring=new Set(splitMentions(body,named).flatMap(part=>part.people ?? []));
      const mentions=named.filter(person=>occurring.has(person));
      if(mentions.length) view.mentions=mentions;
    }
  }
  private views(r:KnowledgeRepositories,documentId:string,owner:true,callerUserId?:string):Promise<OwnerReviewThreadView[]>;
  private views(r:KnowledgeRepositories,documentId:string,owner:false,callerUserId?:string):Promise<ReviewThreadView[]>;
  private async views(r:KnowledgeRepositories,documentId:string,owner:boolean,callerUserId?:string):Promise<ReviewThreadView[]|OwnerReviewThreadView[]> {
    const revision=await r.revisions.findCurrent(documentId);
    if(!revision) fail("REVIEW_NOT_FOUND","Document discussion was not found.");
    const relocateAnchor=createReviewAnchorRelocator(revision.markdown);
    const results=[];
    const shown:{view:ReviewCommentView;body:string}[]=[];
    for(const thread of await r.reviewThreads.listByDocument(documentId)) {
      if(!owner && thread.visibility==="HIDDEN") continue;
      const comments=await r.reviewComments.listByThread(thread.id);
      if(isRetractedThread(comments)) continue;
      const anchor=relocateAnchor(thread.anchor,thread.createdRevisionId===revision.id);
      const view=owner?projectOwnerThread(thread,comments,anchor,callerUserId):projectReviewerThread(thread,comments,anchor,callerUserId);
      if(view) {
        const sources=new Map(comments.map(comment=>[comment.id,comment]));
        for(const comment of view.comments) {
          const source=sources.get(comment.id)!;
          comment.authorName=(await r.users.findById(source.authorUserId))?.name;
          if(!source.deletedAt) shown.push({view:comment,body:comment.body}); // the projected body: it alone decides what is shown
        }
        results.push(view);
      }
    }
    await this.attachMentions(r,shown);
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
  /**
   * The common document/Source/Workspace lookup. `lock` is for writes (spec §7
   * lock order: link, source, workspace). Reads pass false and wait on nobody.
   * The caller decides which kind of Workspace may discuss the document.
   */
  private async locate(r:KnowledgeRepositories,documentId:string,lock=true):Promise<LocatedScope> {
    const initial=await r.documents.findById(documentId);
    if(!initial) throw new ShareLinkNotFoundError();
    const source=lock?await r.sourcePolicy.lockById(initial.sourceId):await r.sourcePolicy.findById(initial.sourceId);
    if(!source) throw new ShareLinkNotFoundError();
    const workspace=lock?await r.workspaces.lockSharedById(source.workspaceId):await r.workspaces.findById(source.workspaceId);
    const document=await r.documents.findById(documentId);
    if(!workspace || !document || document.sourceId!==source.id) throw new ShareLinkNotFoundError();
    return {document,source,workspace};
  }
  /** Share links and personal owners are PERSONAL only; `linkScope` stays here. */
  private async personalScope(r:KnowledgeRepositories,documentId:string,lock=true):Promise<LocatedScope> {
    const s=await this.locate(r,documentId,lock);
    if(s.workspace.workspaceType!=="PERSONAL" || s.workspace.lifecycleState!=="ACTIVE") throw new ShareLinkNotFoundError();
    return s;
  }
  /**
   * The scope of a document a signed-in caller may discuss: their own personal
   * document, or a published team document they can read (direct or group).
   * Every failure is the same not-found, so a team is not disclosed to outsiders.
   */
  private async documentScope(r:KnowledgeRepositories,caller:CallerContext,documentId:string,lock=true,capabilityOf?:CapabilityOf):Promise<ReviewScope> {
    const s=await this.locate(r,documentId,lock);
    if(s.workspace.workspaceType==="PERSONAL") {
      if(s.workspace.lifecycleState!=="ACTIVE" || s.workspace.personalOwnerUserId!==caller.identity.id) throw new ShareLinkNotFoundError();
      return {...s,ownerUserId:caller.identity.id,canModerate:true,team:false};
    }
    return this.teamScope(r,caller,s,capabilityOf);
  }
  /**
   * An ACTIVE team workspace whose PUBLICATION document this caller can read.
   * The workspace lock is held for writes exactly as on the personal path.
   * `team` marks the scope so writes know not to follow or hand over a link.
   */
  private async teamScope(r:KnowledgeRepositories,caller:CallerContext,s:LocatedScope,capabilityOf:CapabilityOf=(workspaceId)=>evaluateWorkspaceCapabilities({workspaceMemberships:r.workspaceMemberships,groupMappings:r.groupMappings},caller,workspaceId)):Promise<ReviewScope> {
    // An archived document or an unpublished/archived Source is gone from the team for review too:
    // no discussion body, anchor quote or moderation acts on it, not even for its creator.
    if(!this.teamsEnabled() || s.workspace.workspaceType!=="TEAM" || s.workspace.lifecycleState!=="ACTIVE"
      || s.source.sourceType!=="PUBLICATION" || s.document.status!=="ACTIVE" || s.source.status!=="ACTIVE") throw new ShareLinkNotFoundError();
    const publication=await r.sourcePolicy.findPublicationDocument(s.document.id,s.source.id);
    if(!publication) throw new ShareLinkNotFoundError();
    const capabilities=await capabilityOf(s.workspace.id);
    if(!capabilities.has("document.read")) throw new ShareLinkNotFoundError();
    return {
      ...s,ownerUserId:publication.creatorUserId,
      canModerate:caller.identity.id===publication.creatorUserId || capabilities.has("membership.manage_basic"),
      team:true,
    };
  }
  /**
   * The document a live link lets this request discuss. A document link reaches its own document and
   * takes no `documentId`; a folder link takes the one its page is reading and reaches it only while
   * it stays inside the folder (folder share spec §2, §6). Every failure is the same not-found.
   */
  private async linkScope(r:KnowledgeRepositories,token:string,lock=true,documentId?:string) {
    if(typeof token!=="string" || !isShareToken(token)) throw new ShareLinkNotFoundError();
    // A malformed id would make MariaDB's UUID column raise rather than match nothing.
    if(documentId!==undefined && (typeof documentId!=="string" || !isUuid(documentId))) throw new ShareLinkNotFoundError();
    const found=await r.shareLinks.findByToken(token);
    const link=found&&lock?await r.shareLinks.lockById(found.id):found;
    // The UUID column matches and returns lower case whatever case the URL carried, as readShared accepts it.
    if(!link || link.token!==token.toLowerCase()) throw new ShareLinkNotFoundError();
    const target=await this.targetScope(r,link,documentId,lock);
    // A link is personal-only; its owner is the Workspace owner and never a moderator path here.
    return {...target,link,ownerUserId:target.workspace.personalOwnerUserId ?? "",canModerate:true,team:false};
  }
  /** Lock order as every link write: the link (taken by the caller), then the document's Source, then its Workspace. */
  private async targetScope(r:KnowledgeRepositories,link:DocumentShareLink,documentId:string|undefined,lock:boolean) {
    if(link.target.kind==="DOCUMENT") {
      if(documentId!==undefined) throw new ShareLinkNotFoundError();
      const scope=await this.personalScope(r,link.target.documentId,lock);
      if(!await this.opens(r,scope,link,scope.document.status)) throw new ShareLinkNotFoundError();
      return scope;
    }
    if(documentId===undefined) throw new ShareLinkNotFoundError();
    // Judged before any lock: a document outside the folder's Source or outside its live subtree is
    // refused as missing, and nothing of it is locked. The locked recheck below stays, so a move
    // committed while this write waited is still caught.
    const shared=await r.tree.findById(link.target.folderNodeId);
    const named=shared?await r.documents.findById(documentId):null;
    if(!shared || !named || named.sourceId!==shared.sourceId) throw new ShareLinkNotFoundError();
    if(lock && !await reachableChain(r,shared,named)) throw new ShareLinkNotFoundError();
    const scope=await this.personalScope(r,documentId,lock);
    // Read under the Source lock a move takes, so the chain judged is the one a write lands on.
    const folder=await r.tree.findById(link.target.folderNodeId);
    if(!folder || !await reachableChain(r,folder,scope.document) || !await this.opens(r,scope,link,folder.status)) throw new ShareLinkNotFoundError();
    return scope;
  }
  private active(s:LocatedScope) {
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
    return this.uow.run(async r => { const s=await this.linkScope(r,input.token,true,input.documentId); return this.create(r,caller,s,s.link.id,request,input,async()=>(await this.views(r,s.document.id,false,caller.identity.id))); });
  }
  /** The owner's own discussion, on a passage of their own document. No link is involved, so none is recorded. */
  async createForOwner(caller:CallerContext,input:CreateOwnerReviewThreadInput) {
    const request=this.creation(input);
    return this.uow.run(async r => {
      const s=await this.documentScope(r,caller,input.documentId);
      // A team member who is neither the creator nor an admin reads the member projection back.
      const views=async():Promise<ReviewThreadView[]>=>s.canModerate
        ? await this.views(r,s.document.id,true,caller.identity.id)
        : await this.views(r,s.document.id,false,caller.identity.id);
      return this.create(r,caller,s,null,request,input,views);
    });
  }
  private creation(input:Pick<CreateReviewThreadInput,"expectedRevisionId"|"anchor"|"body"|"idempotencyKey">) {
    const body=validateReviewBody(input.body),key=validateReviewIdempotencyKey(input.idempotencyKey);
    return {body,key,expectedRevisionId:input.expectedRevisionId,anchor:input.anchor,hashed:{expectedRevisionId:input.expectedRevisionId,anchor:canonicalAnchor(input.anchor),body}};
  }
  /** One way to start a discussion, whoever starts it: the scope is what the caller was let in by. */
  private async create<V extends ReviewThreadView>(r:KnowledgeRepositories,caller:CallerContext,s:ReviewScope,originShareLinkId:string|null,request:ReturnType<DocumentReviewService["creation"]>,input:{mentions?:unknown;mentionLinkId?:unknown},views:()=>Promise<V[]>):Promise<V> {
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
  async replyForLink(caller:CallerContext,input:ReplyReviewInput) { return this.uow.run(async r=> {const s=await this.linkScope(r,input.token,true,input.documentId); return this.reply(r,caller,s,s.link.id,input);}); }
  async replyForOwner(caller:CallerContext,input:ReplyOwnerReviewInput) {return this.uow.run(async r=>{const s=await this.documentScope(r,caller,input.documentId);return this.reply(r,caller,s,null,input);});}
  private comment(threadId:string,userId:string,body:string,key:string,requestHash:string):ReviewComment {return {id:uuidv7(),threadId,authorUserId:userId,body,idempotencyKey:key,requestHash,createdAt:this.clock(),editedAt:null,deletedAt:null,visibility:"VISIBLE",hiddenBy:null,hiddenAt:null,hiddenReason:null};}
  /**
   * A comment written through a link or in a team is news to the owner, unless
   * the owner wrote it. A team event names its recipient directly and carries
   * no share link; a personal owner write tells nobody.
   */
  private async notifyOwner(r:KnowledgeRepositories,caller:CallerContext,s:ReviewScope,originShareLinkId:string|null,comment:ReviewComment) {
    if(s.team) {
      if(s.ownerUserId===caller.identity.id) return;
      await r.shareCommentEvents.insert({id:uuidv7(),workspaceId:s.workspace.id,documentId:s.document.id,threadId:comment.threadId,commentId:comment.id,originShareLinkId:null,createdByUserId:caller.identity.id,mentionedUserId:null,recipientUserId:s.ownerUserId,createdAt:comment.createdAt,readAt:null});
      return;
    }
    if(originShareLinkId===null || s.workspace.personalOwnerUserId===caller.identity.id) return;
    await r.shareCommentEvents.insert({id:uuidv7(),workspaceId:s.workspace.id,documentId:s.document.id,threadId:comment.threadId,commentId:comment.id,originShareLinkId,createdByUserId:caller.identity.id,mentionedUserId:null,createdAt:comment.createdAt,readAt:null});
  }
  /**
   * Writing in a discussion through a link follows it, or follows it again
   * (spec 2026-10-22 § Following). Team discussion is not followed: the team
   * document itself is where a member returns, so a team write follows nothing.
   */
  private async followOnWrite(r:KnowledgeRepositories,caller:CallerContext,s:ReviewScope,originShareLinkId:string|null,threadId:string) {
    if(s.team) return;
    if(originShareLinkId!==null && s.workspace.personalOwnerUserId!==caller.identity.id) await r.reviewFollows.follow({threadId,userId:caller.identity.id,shareLinkId:originShareLinkId,at:this.clock()});
  }
  /**
   * Who a comment names, read before the replay check so the request hash covers it. A link write hands
   * over its own link; only an owner write names one (`mentionLinkId`), and only it hashes that choice.
   */
  private mentionRequest(caller:CallerContext,s:ReviewScope,originShareLinkId:string|null,input:{mentions?:unknown;mentionLinkId?:unknown}):MentionRequest {
    const ids=normalizeMentions(input.mentions,{writerId:caller.identity.id,ownerId:s.ownerUserId || null});
    // Only a personal owner write names a link to hand over; a team mention never does.
    const owner=originShareLinkId===null && !s.team;
    const linkId=owner && typeof input.mentionLinkId==="string"?input.mentionLinkId.toLowerCase():null;
    const hashed=ids.length?{mentions:[...ids].sort(),...(owner?{mentionLinkId:linkId}:{})}:{};
    return {ids,linkId,hashed};
  }
  /**
   * Every check a mention needs, before anything is written: each person exists, and the link handed to them
   * belongs to this document and opens now. Returns that link, or null when nobody is named.
   */
  private async mentionLink(r:KnowledgeRepositories,s:ReviewScope,originShareLinkId:string|null,mentions:MentionRequest):Promise<string|null> {
    if(!mentions.ids.length) return null;
    if((await r.users.findByIds(mentions.ids)).length!==mentions.ids.length) fail("INVALID_REQUEST","Mention only people who have signed in here.");
    if(s.team) {
      // A team mention points at the team document: only its direct members can be named, and
      // a group-only member cannot be listed (their group is not the caller's to judge).
      const direct=new Set((await r.workspaceMemberships.listByWorkspace(s.workspace.id))
        .filter(membership=>membership.membershipSource!=="SYSTEM_PERSONAL")
        .map(membership=>membership.userId.toLowerCase()));
      if(!mentions.ids.every(id=>direct.has(id))) fail("INVALID_REQUEST","Mention only direct members of this team.");
      return null;
    }
    if(originShareLinkId!==null) return originShareLinkId;
    const link=mentions.linkId===null?undefined:(await r.shareLinks.findByIds([mentions.linkId]))[0];
    if(!link || !await this.linkValid(r,link,s.document.id)) fail("INVALID_REQUEST","Mention someone through a live share link of this document.");
    return link.id;
  }
  /**
   * The people a comment names get a mention carrying the link, and follow the
   * discussion through it (spec 2026-10-29 § Writing a mention). A team mention
   * carries no link and creates no follow or share grant.
   */
  private async mentionOnWrite(r:KnowledgeRepositories,s:ReviewScope,carriedLinkId:string|null,comment:ReviewComment,mentions:string[]) {
    if(!mentions.length) return;
    if(s.team) {
      await r.reviewMentions.insertMany(mentions.map(mentionedUserId=>({commentId:comment.id,mentionedUserId,shareLinkId:null,createdAt:comment.createdAt,readAt:null})));
      return;
    }
    if(carriedLinkId===null) return;
    await r.reviewMentions.insertMany(mentions.map(mentionedUserId=>({commentId:comment.id,mentionedUserId,shareLinkId:carriedLinkId,createdAt:comment.createdAt,readAt:null})));
    const currentLinkValid=async(linkId:string)=>{
      const link=(await r.shareLinks.findByIds([linkId]))[0];
      return !!link && this.linkValid(r,link,s.document.id);
    };
    for(const userId of mentions) await followForMention(r.reviewFollows,{threadId:comment.threadId,userId,shareLinkId:carriedLinkId,at:this.clock(),currentLinkValid});
  }
  private async reply(r:KnowledgeRepositories,caller:CallerContext,s:ReviewScope,originShareLinkId:string|null,input:{threadId:string;body:string;idempotencyKey:string;mentions?:unknown;mentionLinkId?:unknown}) {
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
  async editForLink(caller:CallerContext,input:{token:string;documentId?:string;threadId:string;commentId:string;body:string}) { return this.uow.run(async r=>this.edit(r,caller,await this.linkScope(r,input.token,true,input.documentId),input)); }
  async editForOwner(caller:CallerContext,input:{documentId:string;threadId:string;commentId:string;body:string}) { return this.uow.run(async r=>this.edit(r,caller,await this.documentScope(r,caller,input.documentId),input)); }
  async deleteForLink(caller:CallerContext,input:{token:string;documentId?:string;threadId:string;commentId:string}) { await this.uow.run(async r=>this.retract(r,caller,await this.linkScope(r,input.token,true,input.documentId),input)); }
  async deleteForOwner(caller:CallerContext,input:{documentId:string;threadId:string;commentId:string}) { await this.uow.run(async r=>this.retract(r,caller,await this.documentScope(r,caller,input.documentId),input)); }
  /** A comment as its author reaches it. To anyone else — the document's owner included — it is not there. */
  private async authored(r:KnowledgeRepositories,caller:CallerContext,s:ReviewScope,input:{threadId:string;commentId:string}) {
    const thread=await r.reviewThreads.lockById(input.threadId);
    if(!thread || thread.documentId!==s.document.id || thread.visibility==="HIDDEN") throw new ShareLinkNotFoundError();
    const comment=await r.reviewComments.findById(input.commentId);
    if(!comment || comment.threadId!==thread.id || comment.authorUserId!==caller.identity.id) throw new ShareLinkNotFoundError();
    return {thread,comment};
  }
  /** An edit is a write like a reply: the switch, an open thread, the hourly limit. No earlier body is kept. */
  private async edit(r:KnowledgeRepositories,caller:CallerContext,s:ReviewScope,input:{threadId:string;commentId:string;body:string}) {
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
  private async retract(r:KnowledgeRepositories,caller:CallerContext,s:ReviewScope,input:{threadId:string;commentId:string}) {
    const {comment}=await this.authored(r,caller,s,input);
    if(!comment.deletedAt) await r.reviewComments.markDeleted(comment.id,this.clock());
  }
  async setResolution(caller:CallerContext,input:{documentId:string;threadId:string;status:ReviewStatus}) {
    if(!["OPEN","RESOLVED"].includes(input.status)) fail("INVALID_REQUEST","Invalid discussion status.");
    await this.uow.run(async r=>{
      const s=await this.documentScope(r,caller,input.documentId);
      // Resolution is moderation, like hiding: the team's creator/admin, or the personal owner.
      // A member's writes are comments, replies and mentions only.
      if(!s.canModerate) throw new ShareLinkNotFoundError();
      this.active(s);
      const t=await r.reviewThreads.lockById(input.threadId);if(!t||t.documentId!==s.document.id) throw new ShareLinkNotFoundError();
      if(t.status===input.status)return;
      if(input.status==="OPEN"&&t.visibility==="VISIBLE"&&await r.reviewThreads.countVisibleOpenByCreator(s.document.id,t.createdBy)>=REVIEW_LIMITS.visibleOpenPerCreator) fail("CAPACITY_EXCEEDED","The visible discussion limit was reached.");
      await r.reviewThreads.setResolution(t.id,input.status,caller.identity.id,this.clock());await this.audit(r,caller,s.workspace.id,s.document.id,t.id,"DOCUMENT_REVIEW_RESOLUTION_CHANGED",undefined,input.status);});
  }
  async setVisibility(caller:CallerContext,input:{documentId:string;threadId:string;commentId?:string;visibility:ReviewVisibility;reason?:string}) {
    if(!["VISIBLE","HIDDEN"].includes(input.visibility)) fail("INVALID_REQUEST","Invalid discussion visibility.");
    if(input.reason!==undefined&&(typeof input.reason!=="string"||[...input.reason].length>200)) fail("INVALID_REQUEST","Moderation reason is too long.");
    await this.uow.run(async r=>{
      const s=await this.documentScope(r,caller,input.documentId);
      // Hiding is moderation: the document's creator or an admin (membership.manage_basic), never an ordinary member.
      if(s.team && !s.canModerate) throw new ShareLinkNotFoundError();
      const t=await r.reviewThreads.lockById(input.threadId);if(!t||t.documentId!==s.document.id)throw new ShareLinkNotFoundError();
      const comments=await r.reviewComments.listByThread(t.id);const c=input.commentId?comments.find(c=>c.id===input.commentId):undefined;if(input.commentId&&!c)throw new ShareLinkNotFoundError();
      const target=c&&comments[0]?.id!==c.id?c:t;if(target.visibility===input.visibility)return;
      if(target===t&&input.visibility==="VISIBLE")await this.capacity(r,s.document.id,t.createdBy,t.status==="OPEN");
      await (target===t?r.reviewThreads:r.reviewComments).setVisibility(target.id,input.visibility,caller.identity.id,this.clock(),input.reason??null);
      await this.audit(r,caller,s.workspace.id,s.document.id,t.id,"DOCUMENT_REVIEW_VISIBILITY_CHANGED",target===t?undefined:target.id,input.visibility);
    });
  }
  private async audit(r:KnowledgeRepositories,caller:CallerContext,workspaceId:string,documentId:string,threadId:string,eventType:string,commentId?:string,action?:string) {await r.auditEvents.append({id:uuidv7(),workspaceId,actorUserId:caller.identity.id,actorKind:"USER",eventType,targetType:"DOCUMENT_REVIEW_THREAD",targetId:threadId,payload:{documentId,threadId,action,...(commentId?{commentId}:{})},correlationId:null,createdAt:this.clock()});}
}
