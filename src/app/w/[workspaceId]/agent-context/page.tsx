import { notFound } from "next/navigation";
import { applicationServices } from "@/server/composition";
import { firstSearchParam, type SearchParamValue } from "@/lib/search-params";
import { AgentContextBuilder } from "@/components/knowledge/agent-context-builder";
import { PageHeader } from "@/components/shell/page-header";
import { getLocalGraphModel } from "@/server/link-graph-read";
import { neighbourhoodSelection, parseNeighbourhoodDepth } from "@/modules/knowledge/domain/agent-context";
export default async function AgentContextPage({ params, searchParams }: { params: Promise<{ workspaceId: string }>; searchParams?: Promise<{ document?: SearchParamValue; around?: SearchParamValue; depth?: SearchParamValue }> }) {
  const { workspaceId } = await params;
  const s = applicationServices(); const { caller } = await s.establishTrustedCaller();
  const state = await s.workspaceAdmin.workspaceState(caller, workspaceId);
  if (state.workspace.type !== "PERSONAL" || !state.actions.canSearch) notFound();
  const summaries = await s.queries.listDocumentSummaries(caller, workspaceId);
  const sources = await s.queries.listSources(caller, workspaceId);
  const entries = await s.unitOfWork.run(r => r.entries.findByDocumentIds(summaries.map(d => d.documentId)));
  const paths = new Map(entries.map(e => [e.documentId, e.sourcePath]));
  const names = new Map(sources.map(source => [source.id, source.name]));
  const choices = summaries.filter(d => d.status === "ACTIVE" && d.sourceStatus === "ACTIVE").map(d => ({ documentId: d.documentId, sourceId: d.sourceId, title: d.title, sourceName: names.get(d.sourceId) ?? "Source", sourcePath: paths.get(d.documentId) ?? null }));
  const query = await searchParams;
  // `around` is navigation only: it picks what starts checked; the build re-verifies every id.
  const around = firstSearchParam(query?.around);
  const local = around ? await getLocalGraphModel(workspaceId, around, parseNeighbourhoodDepth(firstSearchParam(query?.depth))) : null;
  const neighbourhood = local ? neighbourhoodSelection(local.nodes, new Set(choices.map(d => d.documentId))) : null;
  const document = firstSearchParam(query?.document);
  const initialDocumentIds = around ? neighbourhood?.ids ?? [] : document ? [document] : [];
  // Preselected rows first, so they fall inside the list's first rows.
  const preselected = new Set(initialDocumentIds);
  const documents = [...choices.filter(d => preselected.has(d.documentId)), ...choices.filter(d => !preselected.has(d.documentId))];
  const nearby = neighbourhood && neighbourhood.ids.length ? { selected: neighbourhood.ids.length, total: neighbourhood.total } : undefined;
  return <main className="kh-page pb-6"><PageHeader location="My Space" locationHref={`/w/${workspaceId}/home`} title="Copy for Agent" /><div className="mt-6"><AgentContextBuilder workspaceId={workspaceId} initialDocumentIds={initialDocumentIds} nearby={nearby} documents={documents} /></div></main>;
}
