import { notFound } from "next/navigation";
import { applicationServices } from "@/server/composition";
import { firstSearchParam, type SearchParamValue } from "@/lib/search-params";
import { ShareManagementView } from "@/components/knowledge/share-management-view";
import { DomainError, ValidationError } from "@/modules/knowledge/domain/errors";
export const dynamic = "force-dynamic";
export default async function SharesPage({ params, searchParams }: { params: Promise<{ workspaceId: string }>; searchParams: Promise<{ q?: SearchParamValue; status?: SearchParamValue; page?: SearchParamValue }> }) {
  const { workspaceId } = await params, query = await searchParams;
  const s = applicationServices(); const { caller } = await s.establishTrustedCaller();
  const input = { q: firstSearchParam(query.q), status: firstSearchParam(query.status), page: firstSearchParam(query.page) };
  try {
    const model = await s.shares.listManagement(caller, workspaceId, input);
    const hasDocuments = model.items.length > 0 || (await s.queries.listDocumentSummaries(caller, workspaceId, { includeArchived: true })).length > 0;
    return <ShareManagementView hasDocuments={hasDocuments} key={JSON.stringify(model.query)} workspaceId={workspaceId} model={model} />;
  } catch (error) {
    if (error instanceof ValidationError) return <ShareManagementView workspaceId={workspaceId} filterError={error.message} model={{ query: { q: input.q ?? "", status: "all", page: 1 }, items: [], hasNext: false }} />;
    if (error instanceof DomainError && ["DOCUMENT_NOT_FOUND", "WORKSPACE_NOT_FOUND", "WORKSPACE_ACCESS_DENIED", "INSUFFICIENT_WORKSPACE_CAPABILITY"].includes(error.code)) notFound();
    throw error;
  }
}
