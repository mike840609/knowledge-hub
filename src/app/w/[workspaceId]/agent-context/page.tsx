import { notFound } from "next/navigation";
import { applicationServices } from "@/server/composition";
import { firstSearchParam, type SearchParamValue } from "@/lib/search-params";
import { AgentContextBuilder } from "@/components/knowledge/agent-context-builder";
import { PageHeader } from "@/components/shell/page-header";
export default async function AgentContextPage({ params, searchParams }: { params: Promise<{ workspaceId: string }>; searchParams?: Promise<{ document?: SearchParamValue }> }) {
  const { workspaceId } = await params;
  const s = applicationServices(); const { caller } = await s.establishTrustedCaller();
  const state = await s.workspaceAdmin.workspaceState(caller, workspaceId);
  if (state.workspace.type !== "PERSONAL" || !state.actions.canSearch) notFound();
  const summaries = await s.queries.listDocumentSummaries(caller, workspaceId);
  const sources = await s.queries.listSources(caller, workspaceId);
  const entries = await s.unitOfWork.run(r => r.entries.findByDocumentIds(summaries.map(d => d.documentId)));
  const paths = new Map(entries.map(e => [e.documentId, e.sourcePath]));
  const names = new Map(sources.map(source => [source.id, source.name]));
  return <main className="kh-page pb-6"><PageHeader location="My Space" locationHref={`/w/${workspaceId}/home`} title="Copy for Agent" /><div className="mt-6"><AgentContextBuilder workspaceId={workspaceId} initialDocumentId={firstSearchParam((await searchParams)?.document)} documents={summaries.filter(d => d.status === "ACTIVE" && d.sourceStatus === "ACTIVE").map(d => ({ documentId: d.documentId, sourceId: d.sourceId, title: d.title, sourceName: names.get(d.sourceId) ?? "Source", sourcePath: paths.get(d.documentId) ?? null }))} /></div></main>;
}
