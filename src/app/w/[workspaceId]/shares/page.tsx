import { notFound } from "next/navigation";
import { applicationServices } from "@/server/composition";
import { firstSearchParam, type SearchParamValue } from "@/lib/search-params";
import { ShareManagementView } from "@/components/knowledge/share-management-view";
import { SavedSharesView } from "@/components/knowledge/saved-shares-view";
import { FollowedDiscussionsView } from "@/components/knowledge/followed-discussions-view";
import { filterFollowedDiscussions, parseDiscussionFilter } from "@/modules/knowledge/domain/review-follow";
import { DomainError, ValidationError } from "@/modules/knowledge/domain/errors";
export const dynamic = "force-dynamic";
export default async function SharesPage({ params, searchParams }: { params: Promise<{ workspaceId: string }>; searchParams: Promise<{ tab?: SearchParamValue;q?: SearchParamValue; status?: SearchParamValue; page?: SearchParamValue }> }) {
  const { workspaceId }=await params, query=await searchParams;
  const s=applicationServices(),{caller}=await s.establishTrustedCaller();
  const tab=firstSearchParam(query.tab) ?? "mine";
  const input={q:firstSearchParam(query.q),status:firstSearchParam(query.status),page:firstSearchParam(query.page)};
  let discussionsUnread = 0;
  try {
    // ponytail: the tab's unread count reloads every follow per Shares visit, as the Inbox badge does; a count query if it shows.
    const followed=(await s.reviews.listFollowedDiscussions(caller)).items;
    discussionsUnread=followed.filter(item=>item.linkAvailable&&item.unread>0).length;
    if(tab!=="mine"&&tab!=="saved"&&tab!=="discussions") {
      // Prove ownership before showing a validation response on this route.
      await s.shares.listManagement(caller,workspaceId,{});
      throw new ValidationError("Choose My shares, Saved shares or Discussions.");
    }
    if(tab==="discussions") {
      // Prove ownership of this personal Workspace, as the other tabs do.
      await s.shares.listManagement(caller,workspaceId,{});
      const filter=parseDiscussionFilter(input.status);
      return <FollowedDiscussionsView workspaceId={workspaceId} items={filterFollowedDiscussions(followed,filter)} filter={filter} unread={discussionsUnread}/>;
    }
    if(tab==="saved") {
      const model=await s.savedShares.list(caller,workspaceId,input);
      return <SavedSharesView key={JSON.stringify(model.query)} workspaceId={workspaceId} model={model} discussionsUnread={discussionsUnread}/>;
    }
    const model=await s.shares.listManagement(caller,workspaceId,input);
    const hasDocuments=model.items.length>0||(await s.queries.listDocumentSummaries(caller,workspaceId,{includeArchived:true})).length>0;
    return <ShareManagementView hasDocuments={hasDocuments} key={JSON.stringify(model.query)} workspaceId={workspaceId} model={model} discussionsUnread={discussionsUnread}/>;
  } catch(error) {
    if(error instanceof ValidationError) return tab==="discussions"?<FollowedDiscussionsView workspaceId={workspaceId} items={[]} filter="all" unread={discussionsUnread} filterError={error.message}/>:tab==="saved"?<SavedSharesView workspaceId={workspaceId} filterError={error.message} model={{query:{q:input.q??"",status:"all",page:1},items:[],hasNext:false}} discussionsUnread={discussionsUnread}/>:<ShareManagementView workspaceId={workspaceId} filterError={error.message} model={{query:{q:input.q??"",status:"all",page:1},items:[],hasNext:false}} discussionsUnread={discussionsUnread}/>;
    if(error instanceof DomainError&&["DOCUMENT_NOT_FOUND","WORKSPACE_NOT_FOUND","WORKSPACE_ACCESS_DENIED","INSUFFICIENT_WORKSPACE_CAPABILITY"].includes(error.code))notFound();
    throw error;
  }
}
