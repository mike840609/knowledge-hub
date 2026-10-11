import type { KnowledgeRepositories, KnowledgeUnitOfWork } from "../ports/unit-of-work";
import type { CallerContext } from "@/modules/identity/domain/caller-context";
import { syncCallerIdentity } from "@/modules/identity/application/sync-caller-identity";
import { evaluateShareLinkValidity, isShareToken, ShareLinkNotFoundError } from "../domain/document-share-link";
import { NotFoundError, IntegrityViolationError } from "../domain/errors";
import { parseSavedShareQuery, SAVED_SHARE_PAGE_SIZE, type SavedShareInput, type SavedShareList, type SavedShareState } from "../domain/saved-share";
import { uuidv7, isUuid } from "@/shared/ids/uuidv7";
export class SavedShareService {
  constructor(private readonly unitOfWork: KnowledgeUnitOfWork, private readonly clock: () => Date = () => new Date()) {}
  private async personal(r: KnowledgeRepositories, caller: CallerContext, workspaceId?: string) {
    const workspace = await r.workspaces.findPersonalByOwnerUserId(caller.identity.id);
    if (!workspace || workspace.lifecycleState !== "ACTIVE" || (workspaceId !== undefined && workspace.id !== workspaceId)) throw new NotFoundError("Personal workspace unavailable.");
    await r.workspaceAccess.requireWorkspaceRead(caller, workspace.id);
    return workspace.id;
  }
  async state(caller: CallerContext, token: string): Promise<SavedShareState> {
    return this.unitOfWork.run(async r => {
      const workspaceId = await this.personal(r,caller);
      const record = isShareToken(token) ? await r.savedShares.findByToken(caller.identity.id,token) : null;
      const saved = !!record && record.removedAt === null;
      return { saved, id: saved ? record!.id : null, workspaceId };
    });
  }
  async save(caller: CallerContext, token: string): Promise<SavedShareState> {
    if (!isShareToken(token)) throw new ShareLinkNotFoundError();
    return this.unitOfWork.run(async r => {
      await syncCallerIdentity(r.users,caller);
      const workspaceId = await this.personal(r,caller), now = this.clock();
      const link = await r.shareLinks.findByToken(token);
      if (!link) throw new ShareLinkNotFoundError();
      const document = await r.documents.findById(link.documentId);
      const source = document ? await r.sourcePolicy.findById(document.sourceId) : null;
      const workspace = source ? await r.workspaces.findById(source.workspaceId) : null;
      if (!document || !source || !workspace) throw new ShareLinkNotFoundError();
      const membership = await r.workspaceMemberships.find(workspace.id,link.createdBy);
      if (!evaluateShareLinkValidity({ link, documentStatus:document.status,sourceStatus:source.status,workspaceLifecycle:workspace.lifecycleState,creatorDirectRole:membership ? membership.role ?? null : undefined,now }).valid) throw new ShareLinkNotFoundError();
      const revision = await r.revisions.findCurrent(document.id), creator = await r.users.findById(link.createdBy);
      if (!revision || !creator) throw new IntegrityViolationError("Share metadata is unavailable.");
      const record = await r.savedShares.save({ id:uuidv7(),userId:caller.identity.id,shareLinkId:link.id,savedTitle:revision.title,savedSharedByName:creator.name,savedExpiresAt:link.expiresAt,savedAt:now,updatedAt:now,removedAt:null });
      return { saved:true,id:record.id,workspaceId };
    });
  }
  async remove(caller: CallerContext, id: string): Promise<void> {
    if (!isUuid(id)) throw new NotFoundError("Saved share unavailable.");
    await this.unitOfWork.run(async r => {
      await this.personal(r,caller);
      if (!await r.savedShares.remove(caller.identity.id,id,this.clock())) throw new NotFoundError("Saved share unavailable.");
    });
  }
  async list(caller: CallerContext, workspaceId: string, input: SavedShareInput): Promise<SavedShareList> {
    return this.unitOfWork.run(async r => {
      await this.personal(r,caller,workspaceId);
      const query=parseSavedShareQuery(input);
      const rows=await r.savedShares.list(caller.identity.id,query,this.clock(),SAVED_SHARE_PAGE_SIZE+1,(query.page-1)*SAVED_SHARE_PAGE_SIZE);
      return { query,items:rows.slice(0,SAVED_SHARE_PAGE_SIZE),hasNext:rows.length>SAVED_SHARE_PAGE_SIZE };
    });
  }
}
