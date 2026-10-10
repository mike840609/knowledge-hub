import { createHash } from "node:crypto";
import type { CallerContext } from "@/modules/identity/domain/caller-context";
import { DomainError } from "@/shared/domain/errors";
import { uuidv7 } from "@/shared/ids/uuidv7";
import { evaluateShareLinkValidity, isShareToken, ShareLinkNotFoundError } from "../domain/document-share-link";
import { REVIEW_LIMITS, projectOwnerThread, projectReviewerThread, projectReviewComment, validateReviewBody, validateReviewIdempotencyKey, type ReviewThread, type ReviewComment, type ReviewAnchor, type ReviewStatus, type ReviewVisibility, type ReviewThreadView, type OwnerReviewThreadView, type CreateReviewThreadInput, type ReplyReviewInput } from "../domain/document-review";
import { createReviewAnchorRelocator, validateReviewAnchor } from "../domain/review-anchor";
import type { KnowledgeRepositories, KnowledgeUnitOfWork } from "../ports/unit-of-work";

function fail(code:string, message:string):never { throw new DomainError(code,message); }
function canonicalAnchor(a:ReviewAnchor) { if(!a || typeof a!=="object") fail("INVALID_REQUEST","Provide an anchor."); return {schemaVersion:a.schemaVersion,blockPath:a.blockPath,blockKind:a.blockKind,startUtf16:a.startUtf16,endUtf16:a.endUtf16,exact:a.exact,prefix:a.prefix,suffix:a.suffix}; }
const hash = (payload:unknown) => createHash("sha256").update(JSON.stringify(payload)).digest("hex");
export class DocumentReviewService {
  constructor(private readonly uow:KnowledgeUnitOfWork, private readonly clock:()=>Date=()=>new Date(), private readonly writesEnabled:()=>boolean=()=>false) {}
  /**
   * The one entry that answers without a caller: a live share token reads the visible discussion.
   * It takes no locks. A reader must never queue the owner's edits or a folder sync behind a page
   * load, and it writes nothing a lock would protect; `readShared` reads the same way.
   */
  async queryForLink(caller:CallerContext | null,token:string) {
    return this.uow.run(async r => { const s=await this.linkScope(r,token,false); return {threads:await this.views(r,s.document.id,false),revisionId:s.document.currentRevisionId,writesEnabled:!!caller && this.writesEnabled(),callerUserId:caller?.identity.id ?? null}; });
  }
  async queryForOwner(caller:CallerContext,documentId:string) {
    return this.uow.run(async r => { const s=await this.ownerScope(r,caller,documentId,false); return {threads:await this.views(r,documentId,true),revisionId:s.document.currentRevisionId,writesEnabled:this.writesEnabled(),callerUserId:caller.identity.id}; });
  }
  private views(r:KnowledgeRepositories,documentId:string,owner:true):Promise<OwnerReviewThreadView[]>;
  private views(r:KnowledgeRepositories,documentId:string,owner:false):Promise<ReviewThreadView[]>;
  private async views(r:KnowledgeRepositories,documentId:string,owner:boolean):Promise<ReviewThreadView[]|OwnerReviewThreadView[]> {
    const revision=await r.revisions.findCurrent(documentId);
    if(!revision) fail("REVIEW_NOT_FOUND","Document discussion was not found.");
    const relocateAnchor=createReviewAnchorRelocator(revision.markdown);
    const results=[];
    for(const thread of await r.reviewThreads.listByDocument(documentId)) {
      if(!owner && thread.visibility==="HIDDEN") continue;
      const comments=await r.reviewComments.listByThread(thread.id);
      const anchor=relocateAnchor(thread.anchor,thread.createdRevisionId===revision.id);
      const view=owner?projectOwnerThread(thread,comments,anchor):projectReviewerThread(thread,comments,anchor);
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
    if(!link || link.token!==token) throw new ShareLinkNotFoundError();
    const scope=await this.scope(r,link.documentId,lock);
    const membership=await r.workspaceMemberships.find(scope.workspace.id,link.createdBy);
    if(scope.workspace.personalOwnerUserId!==link.createdBy || !evaluateShareLinkValidity({link,documentStatus:scope.document.status,sourceStatus:scope.source.status,workspaceLifecycle:scope.workspace.lifecycleState,creatorDirectRole:membership?membership.role??null:undefined,now:this.clock()}).valid) throw new ShareLinkNotFoundError();
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
    const body=validateReviewBody(input.body),key=validateReviewIdempotencyKey(input.idempotencyKey);
    const requestHash=hash({expectedRevisionId:input.expectedRevisionId,anchor:canonicalAnchor(input.anchor),body});
    return this.uow.run(async r => {
      const s=await this.linkScope(r,input.token);
      const existing=await r.reviewThreads.findByCreationKey(s.document.id,caller.identity.id,key);
      if(existing) { if(existing.creationRequestHash!==requestHash) fail("IDEMPOTENCY_KEY_REUSED","The idempotency key was already used for a different request."); const view=(await this.views(r,s.document.id,false)).find(t=>t.id===existing.id); if(!view) throw new ShareLinkNotFoundError(); return view; }
      this.enabled(); this.active(s);
      const revision=await r.revisions.findCurrent(s.document.id);
      if(!revision || revision.id!==input.expectedRevisionId) fail("STALE_DOCUMENT_REVISION","Refresh the document before selecting a passage.");
      const anchor=validateReviewAnchor(revision.markdown,input.anchor);
      await this.capacity(r,s.document.id,caller.identity.id); await this.quota(r,caller.identity.id,s.document.id);
      const now=this.clock(); const thread:ReviewThread={id:uuidv7(),documentId:s.document.id,createdRevisionId:revision.id,createdBy:caller.identity.id,creationIdempotencyKey:key,creationRequestHash:requestHash,originShareLinkId:s.link.id,anchor,status:"OPEN",visibility:"VISIBLE",hiddenBy:null,hiddenAt:null,hiddenReason:null,resolvedBy:null,resolvedAt:null,createdAt:now,updatedAt:now};
      await r.reviewThreads.insert(thread);
      await r.reviewComments.insert(this.comment(thread.id,caller.identity.id,body,key,requestHash)); await this.charge(r,caller.identity.id,s.document.id);
      return (await this.views(r,s.document.id,false)).find(t=>t.id===thread.id)!;
    });
  }
  async replyForLink(caller:CallerContext,input:ReplyReviewInput) { return this.uow.run(async r=> {const s=await this.linkScope(r,input.token); return this.reply(r,caller,s,input);}); }
  async replyForOwner(caller:CallerContext,input:{documentId:string;threadId:string;body:string;idempotencyKey:string}) {return this.uow.run(async r=>{const s=await this.ownerScope(r,caller,input.documentId);return this.reply(r,caller,s,input);});}
  private comment(threadId:string,userId:string,body:string,key:string,requestHash:string):ReviewComment {return {id:uuidv7(),threadId,authorUserId:userId,body,idempotencyKey:key,requestHash,createdAt:this.clock(),visibility:"VISIBLE",hiddenBy:null,hiddenAt:null,hiddenReason:null};}
  private async reply(r:KnowledgeRepositories,caller:CallerContext,s:Awaited<ReturnType<DocumentReviewService["scope"]>>,input:{threadId:string;body:string;idempotencyKey:string}) {
    const body=validateReviewBody(input.body),key=validateReviewIdempotencyKey(input.idempotencyKey),requestHash=hash({threadId:input.threadId,body});
    const thread=await r.reviewThreads.lockById(input.threadId);
    if(!thread || thread.documentId!==s.document.id || thread.visibility==="HIDDEN") throw new ShareLinkNotFoundError();
    const existing=await r.reviewComments.findByIdempotencyKey(thread.id,caller.identity.id,key);
    if(existing) {if(existing.requestHash!==requestHash) fail("IDEMPOTENCY_KEY_REUSED","The idempotency key was already used for a different request."); return projectReviewComment(existing);}
    this.enabled();this.active(s);
    if(thread.status!=="OPEN") fail("REVIEW_THREAD_CLOSED","Reopen the discussion before replying.");
    if(await r.reviewComments.countByThread(thread.id)>REVIEW_LIMITS.replies) fail("CAPACITY_EXCEEDED","The discussion reply limit was reached.");
    await this.quota(r,caller.identity.id,s.document.id);
    const comment=this.comment(thread.id,caller.identity.id,body,key,requestHash);await r.reviewComments.insert(comment);await this.charge(r,caller.identity.id,s.document.id);return projectReviewComment(comment);
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
