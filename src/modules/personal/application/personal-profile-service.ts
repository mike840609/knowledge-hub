import type {CallerContext} from "@/modules/identity/domain/caller-context";
import type {SourceRepositories,SourceUnitOfWork} from "@/modules/sources/ports/unit-of-work";
import {evaluateWorkspaceCapabilities,requireWorkspaceRead} from "@/modules/workspaces/application/workspace-authorization";
import {DomainError} from "@/shared/domain/errors";
import {isUuid} from "@/shared/ids/uuidv7";
import {PROFILE_DOCUMENT_FILTERS,PROFILE_SYNC_FILTERS,type ProfileDocumentFilter,type ProfileSyncFilter,type ProfilePeriod,type PersonalProfile} from "../domain/personal-profile";
export function profilePeriod(value:unknown):ProfilePeriod {
  if(value===undefined || value===7 || value==="7")return 7;
  if(value===30 || value==="30")return 30;
  throw new DomainError("INVALID_REQUEST","Choose a 7 or 30 day period.");
}
export class PersonalProfileService {
  constructor(private readonly uow:SourceUnitOfWork,private readonly clock:()=>Date=()=>new Date()){}
  private async authorize(r:SourceRepositories,caller:CallerContext,workspaceId:string){
    if(!isUuid(workspaceId))throw new DomainError("WORKSPACE_NOT_FOUND","Personal profile unavailable.");
    const workspace=await r.workspaces.findById(workspaceId);
    if(workspace?.workspaceType!=="PERSONAL" || workspace.personalOwnerUserId!==caller.identity.id || workspace.lifecycleState!=="ACTIVE")throw new DomainError("WORKSPACE_NOT_FOUND","Personal profile unavailable.");
    requireWorkspaceRead(await evaluateWorkspaceCapabilities(r,caller,workspaceId));
  }
  private scope(caller:CallerContext,workspaceId:string,days:ProfilePeriod){const now=this.clock();return {userId:caller.identity.id,workspaceId,now,since:new Date(now.getTime()-days*86400000)};}
  private cursor(after?:string){if(after!==undefined&&!isUuid(after))throw new DomainError("INVALID_REQUEST","Invalid statistics page cursor.");return after;}
  async get(caller:CallerContext,workspaceId:string,period:unknown=7):Promise<PersonalProfile>{
    const days=profilePeriod(period),scope=this.scope(caller,workspaceId,days);
    return this.uow.run(async r=>{await this.authorize(r,caller,workspaceId);return {...await r.personalProfile.overview(scope),workspaceId,identityName:caller.identity.name,days,since:scope.since.toISOString(),generatedAt:scope.now.toISOString()};});
  }
  async documents(caller:CallerContext,workspaceId:string,input:{filter:string;days?:unknown;after?:string}){
    if(!PROFILE_DOCUMENT_FILTERS.includes(input.filter as ProfileDocumentFilter))throw new DomainError("INVALID_REQUEST","Invalid article filter.");
    const scope=this.scope(caller,workspaceId,profilePeriod(input.days)),after=this.cursor(input.after);
    return this.uow.run(async r=>{await this.authorize(r,caller,workspaceId);return r.personalProfile.documents(scope,input.filter as ProfileDocumentFilter,after);});
  }
  async syncItems(caller:CallerContext,workspaceId:string,input:{filter:string;after?:string}){
    if(!PROFILE_SYNC_FILTERS.includes(input.filter as ProfileSyncFilter))throw new DomainError("INVALID_REQUEST","Invalid sync filter.");
    const scope=this.scope(caller,workspaceId,7),after=this.cursor(input.after);
    return this.uow.run(async r=>{await this.authorize(r,caller,workspaceId);return r.personalProfile.syncItems(scope,input.filter as ProfileSyncFilter,after);});
  }
}
