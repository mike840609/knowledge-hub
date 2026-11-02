import type { KnowledgeRepositories, KnowledgeUnitOfWork } from "../ports/unit-of-work";
import type { CallerContext } from "@/modules/identity/domain/caller-context";
import { syncCallerIdentity } from "@/modules/identity/application/sync-caller-identity";
import { evaluateShareLinkValidity, isShareToken, ShareLinkNotFoundError } from "../domain/document-share-link";
import { NotFoundError, IntegrityViolationError } from "../domain/errors";
import { parseSavedShareQuery, SAVED_SHARE_PAGE_SIZE, type NamedShareView, type SavedShareInput, type SavedShareList, type SavedShareState } from "../domain/saved-share";
import { judgeNamedShares, namedShareTitle } from "./internal/named-share-judgement";
import { uuidv7, isUuid } from "@/shared/ids/uuidv7";
const NAMED_SHARE_LIMIT = 100;
export class SavedShareService {
  constructor(private readonly unitOfWork: KnowledgeUnitOfWork, private readonly clock: () => Date = () => new Date()) {}
  private async personal(r: KnowledgeRepositories, caller: CallerContext, workspaceId?: string) {
    const workspace = await r.workspaces.findPersonalByOwnerUserId(caller.identity.id);
    if (!workspace || workspace.lifecycleState !== "ACTIVE" || (workspaceId !== undefined && workspace.id !== workspaceId)) throw new NotFoundError("Personal workspace unavailable.", "WORKSPACE_NOT_FOUND");
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
      const workspaceId = await this.personal(r,caller);
      const snapshot=await r.savedShares.findSnapshotByToken(token),now=this.clock();
      // A NAMED link reaches its recipients by name; there is nothing to save, and no expiry to keep.
      if(!snapshot||snapshot.link.audience==='NAMED'||snapshot.link.expiresAt===null||!evaluateShareLinkValidity({link:snapshot.link,...snapshot.validity,now}).valid)throw new ShareLinkNotFoundError();
      if(snapshot.title===null||snapshot.sharedByName===null)throw new IntegrityViolationError("Share metadata is unavailable.");
      const record=await r.savedShares.save({id:uuidv7(),userId:caller.identity.id,shareLinkId:snapshot.link.id,savedTitle:snapshot.title,savedSharedByName:snapshot.sharedByName,savedExpiresAt:snapshot.link.expiresAt,savedAt:now,updatedAt:now,removedAt:null});
      return { saved:true,id:record.id,workspaceId };
    });
  }
  async remove(caller: CallerContext, id: string): Promise<void> {
    if (!isUuid(id)) throw new NotFoundError("Saved share unavailable.", "SAVED_SHARE_NOT_FOUND");
    await this.unitOfWork.run(async r => {
      await this.personal(r,caller);
      if (!await r.savedShares.remove(caller.identity.id,id,this.clock())) throw new NotFoundError("Saved share unavailable.", "SAVED_SHARE_NOT_FOUND");
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
  /** The named shares the caller is on that open now (up to NAMED_SHARE_LIMIT, newest first), without saving. A link that no longer opens is left out. */
  async listNamedForRecipient(caller: CallerContext, workspaceId: string): Promise<NamedShareView[]> {
    return this.unitOfWork.run(async r => {
      await this.personal(r,caller,workspaceId);
      const items: NamedShareView[] = [];
      for (const { link, addedAt, target } of await judgeNamedShares(r,caller.identity.id,NAMED_SHARE_LIMIT,this.clock())) {
        if (!target) continue;
        items.push({ linkId:link.id,title:await namedShareTitle(r,caller,target),sharedByName:(await r.users.findById(link.createdBy))?.name ?? "",addedAt,href:`/w/${workspaceId}/shares/${link.token}` });
      }
      return items;
    });
  }
}
