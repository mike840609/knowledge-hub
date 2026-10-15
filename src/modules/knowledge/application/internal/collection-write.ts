import type { CallerContext } from "@/modules/identity/domain/caller-context";
import { syncCallerIdentity } from "@/modules/identity/application/sync-caller-identity";
import { evaluateWorkspaceCapabilities } from "@/modules/workspaces/application/workspace-authorization";
import { WorkspaceNotFoundError } from "@/modules/workspaces/domain/errors";
import type { KnowledgeRepositories } from "../../ports/unit-of-work";
import type { KnowledgeCollection } from "../../domain/knowledge-collection";
import { parseCollectionVersion } from "../../domain/knowledge-collection";
import { KnowledgeCollectionError } from "../../domain/knowledge-collection-errors";

export async function requireCollectionWritable(
  r:KnowledgeRepositories,caller:CallerContext,workspaceId:string,
):Promise<void>{
  await syncCallerIdentity(r.users,caller);
  // Shared lock allows independent content writes but serializes with governance.
  const workspace=await r.workspaces.lockSharedById(workspaceId);
  if(!workspace)throw new WorkspaceNotFoundError();
  const capabilities=await evaluateWorkspaceCapabilities(r,caller,workspaceId);
  if(!capabilities.has("workspace.discover"))throw new WorkspaceNotFoundError();
  if(!capabilities.has("document.write"))
    throw new KnowledgeCollectionError("COLLECTION_FORBIDDEN","You cannot modify this collection.");
  if(workspace.lifecycleState!=="ACTIVE")
    throw new KnowledgeCollectionError("COLLECTION_CONFLICT","Archived workspaces are read-only.");
}

export async function mutateCollection(
  r:KnowledgeRepositories,caller:CallerContext,workspaceId:string,
  collectionId:string,expectedVersion:unknown,now:Date,
  operation:(existing:KnowledgeCollection)=>Promise<Partial<KnowledgeCollection>|void>,
  allowRestore=false,
):Promise<{version:number}>{
  await requireCollectionWritable(r,caller,workspaceId);
  const existing=await r.collections.lockById(collectionId);
  if(!existing||existing.workspaceId!==workspaceId)
    throw new KnowledgeCollectionError("COLLECTION_NOT_FOUND","Collection unavailable.");
  if(existing.version!==parseCollectionVersion(expectedVersion))
    throw new KnowledgeCollectionError("COLLECTION_CONFLICT","This collection changed. Reload and try again.");
  if(existing.status==="ARCHIVED"&&!allowRestore)
    throw new KnowledgeCollectionError("COLLECTION_CONFLICT","Restore the collection before changing it.");
  const changes=await operation(existing);
  const updated:KnowledgeCollection={
    ...existing,...(changes||{}),
    version:existing.version+1,
    updatedBy:caller.identity.id,updatedAt:now,
  };
  await r.collections.saveMetadata(updated);
  return {version:updated.version};
}
