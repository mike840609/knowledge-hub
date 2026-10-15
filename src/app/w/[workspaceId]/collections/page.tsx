import { notFound } from "next/navigation";
import { applicationServices } from "@/server/composition";
import { CollectionListView } from "@/components/knowledge/collection-list";
import { DomainError } from "@/shared/domain/errors";
export const dynamic="force-dynamic";
export default async function CollectionsPage({params,searchParams}:{
  params:Promise<{workspaceId:string}>;
  searchParams:Promise<{status?:string;cursor?:string}>;
}) {
  const {workspaceId}=await params;
  const query=await searchParams;
  const s=applicationServices();
  const {caller}=await s.establishTrustedCaller();
  try {
    const status=query.status==="ARCHIVED"?"ARCHIVED":"ACTIVE";
    const [model,access]=await Promise.all([
      s.collections.list(caller,workspaceId,{status,cursor:query.cursor}),
      s.workspaceAdmin.workspaceState(caller,workspaceId),
    ]);
    return <CollectionListView workspaceId={workspaceId} model={model} status={status} canWrite={access.actions.canWrite}/>;
  } catch(error) {
    if(error instanceof DomainError&&["COLLECTION_NOT_FOUND","WORKSPACE_NOT_FOUND","WORKSPACE_ACCESS_DENIED"].includes(error.code))notFound();
    throw error;
  }
}
