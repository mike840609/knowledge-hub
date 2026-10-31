import { notFound } from "next/navigation";
import { applicationServices } from "@/server/composition";
import { firstSearchParam, type SearchParamValue } from "@/lib/search-params";
import { ShareManagementView } from "@/components/knowledge/share-management-view";
import { SavedSharesView } from "@/components/knowledge/saved-shares-view";
import { FollowedDiscussionsView } from "@/components/knowledge/followed-discussions-view";
import { filterFollowedDiscussions, parseDiscussionFilter } from "@/modules/knowledge/domain/review-follow";
import { ValidationError } from "@/modules/knowledge/domain/errors";
import { getFollowedDiscussions, requireSharesAccess, sharesNotFound } from "@/server/shares-read";
export const dynamic = "force-dynamic";
export default async function SharesPage({ params, searchParams }: { params: Promise<{ workspaceId: string }>; searchParams: Promise<{ tab?: SearchParamValue;q?: SearchParamValue; status?: SearchParamValue; page?: SearchParamValue }> }) {
  const { workspaceId }=await params, query=await searchParams;
  const s=applicationServices(),{caller}=await s.establishTrustedCaller();
  const tab=firstSearchParam(query.tab) ?? "mine";
  const input={q:firstSearchParam(query.q),status:firstSearchParam(query.status),page:firstSearchParam(query.page)};
  try {
    if(tab!=="mine"&&tab!=="saved"&&tab!=="discussions") {
      // Prove ownership before showing a validation response on this route.
      await requireSharesAccess(workspaceId);
      throw new ValidationError("Choose My shares, Saved shares or Discussions.");
    }
    if(tab==="discussions") {
      // Prove ownership of this personal Workspace, as the other tabs do.
      await requireSharesAccess(workspaceId);
      const followed=await getFollowedDiscussions();
      const filter=parseDiscussionFilter(input.status);
      return <FollowedDiscussionsView workspaceId={workspaceId} items={filterFollowedDiscussions(followed,filter)} filter={filter}/>;
    }
    if(tab==="saved") {
      const model=await s.savedShares.list(caller,workspaceId,input);
      return <SavedSharesView key={JSON.stringify(model.query)} workspaceId={workspaceId} model={model}/>;
    }
    const model=await s.shares.listManagement(caller,workspaceId,input);
    const hasDocuments=model.items.length>0||(await s.queries.listDocumentSummaries(caller,workspaceId,{includeArchived:true})).length>0;
    return <ShareManagementView hasDocuments={hasDocuments} key={JSON.stringify(model.query)} workspaceId={workspaceId} model={model}/>;
  } catch(error) {
    if(error instanceof ValidationError) return tab==="discussions"?<FollowedDiscussionsView workspaceId={workspaceId} items={[]} filter="all" filterError={error.message}/>:tab==="saved"?<SavedSharesView workspaceId={workspaceId} filterError={error.message} model={{query:{q:input.q??"",status:"all",page:1},items:[],hasNext:false}}/>:<ShareManagementView workspaceId={workspaceId} filterError={error.message} model={{query:{q:input.q??"",status:"all",page:1},items:[],hasNext:false}}/>;
    if(sharesNotFound(error))notFound();
    throw error;
  }
}
