import { notFound } from "next/navigation";
import { applicationServices } from "@/server/composition";
import { CollectionDetailView } from "@/components/knowledge/collection-detail";
import { DomainError } from "@/shared/domain/errors";
export const dynamic="force-dynamic";
export default async function CollectionDetailPage({params}:{
  params:Promise<{workspaceId:string;collectionId:string}>;
}) {
  const {workspaceId,collectionId}=await params;
  const s=applicationServices();
  const {caller}=await s.establishTrustedCaller();
  try {
    const [model,access]=await Promise.all([
      s.collections.get(caller,workspaceId,collectionId),
      s.workspaceAdmin.workspaceState(caller,workspaceId),
    ]);
    return <CollectionDetailView workspaceId={workspaceId} model={model} canWrite={access.actions.canWrite}/>;
  } catch(error) {
    if(error instanceof DomainError&&["COLLECTION_NOT_FOUND","WORKSPACE_NOT_FOUND","WORKSPACE_ACCESS_DENIED"].includes(error.code))notFound();
    throw error;
  }
}
