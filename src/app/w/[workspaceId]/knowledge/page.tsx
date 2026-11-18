import { KnowledgeEmptyState } from "@/components/knowledge/knowledge-empty-state";
import { KnowledgeIndex, type KnowledgeIndexRow } from "@/components/knowledge/knowledge-index";
import { KnowledgeLayout } from "@/components/knowledge/knowledge-layout";
import { PageHeader } from "@/components/shell/page-header";
import { buttonClasses } from "@/components/ui/button";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getWorkspaceGraphModel } from "@/server/link-graph-read";
import { getWorkspaceShellModel } from "@/server/knowledge-read";
import { applicationServices } from "@/server/composition";
import { firstSearchParam, type SearchParamValue } from "@/lib/search-params";

export const metadata = { title: "Knowledge" };

/**
 * The Knowledge tab used to redirect to one default document, which left the
 * library with no browse surface: a reader could only find a document through
 * the explorer's truncated tree or Graph's List. This page is the inventory —
 * every active document with its source, last update, and link counts — while
 * the document pane keeps the reading and tree experience.
 */
export default async function WorkspaceKnowledgePage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ q?: SearchParamValue; source?: SearchParamValue; sort?: SearchParamValue; dir?: SearchParamValue; page?: SearchParamValue; per?: SearchParamValue }>;
}) {
  const { workspaceId } = await params;
  const search = await searchParams;
  const services = applicationServices();
  const { caller } = await services.establishTrustedCaller();
  const workspaces = await services.workspaces.listWorkspaces(caller);
  if (!workspaces.some((workspace) => workspace.id === workspaceId)) notFound();
  const sources = await services.queries.listSources(caller, workspaceId);
  // In an empty workspace the explorer is where the ways to add a document are offered.
  if (sources.length === 0) {
    return (
      <KnowledgeLayout workspaceId={workspaceId} source={null} collections={[]} includeArchived={false}>
        <KnowledgeEmptyState />
      </KnowledgeLayout>
    );
  }

  const [summaryList, graph, shell] = await Promise.all([
    services.queries.listDocumentSummaries(caller, workspaceId, { excludeArchivedAncestors: true }),
    getWorkspaceGraphModel(workspaceId, { includeOrphans: true, includeUnresolved: false }),
    getWorkspaceShellModel(workspaceId),
  ]);
  if (!shell) notFound();

  const activeSources = sources.filter((source) => source.status === "ACTIVE");
  const sourceNames = new Map(sources.map((source) => [source.id, source.name]));
  const degrees = new Map((graph?.nodes ?? []).map((node) => [node.id, node]));
  const rows: KnowledgeIndexRow[] = summaryList
    .filter((summary) => summary.status === "ACTIVE" && summary.sourceStatus === "ACTIVE")
    .map((summary) => {
      const node = degrees.get(summary.documentId);
      return {
        documentId: summary.documentId,
        sourceId: summary.sourceId,
        sourceName: sourceNames.get(summary.sourceId) ?? "Unknown source",
        title: summary.title,
        updatedAt: summary.updatedAt.toISOString(),
        inDegree: node?.inDegree ?? 0,
        outDegree: node?.outDegree ?? 0,
        href: `/w/${workspaceId}/knowledge/${summary.sourceId}/${summary.documentId}`,
        pageIcon: summary.pageIcon ?? null,
      };
    })
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt) || left.title.localeCompare(right.title));

  const sortParam = firstSearchParam(search.sort);
  const initialSort = sortParam === "title" || sortParam === "inDegree" || sortParam === "outDegree" ? sortParam : "updated";
  const direction = firstSearchParam(search.dir);
  const initialAscending = direction === "asc" ? true : direction === "desc" ? false : initialSort === "title";
  const pageParam = Number(firstSearchParam(search.page));
  const initialPage = Number.isSafeInteger(pageParam) && pageParam > 0 ? pageParam : 1;
  const perParam = Number(firstSearchParam(search.per));
  const initialPageSize = perParam === 25 || perParam === 50 || perParam === 100 ? perParam : 50;
  const sourceParam = firstSearchParam(search.source);
  const initialSource = activeSources.some((source) => source.id === sourceParam) ? sourceParam ?? "" : "";

  return (
    <div className="pb-6">
      <div className="kh-page-wide">
        <PageHeader
          location={shell.workspace.type === "PERSONAL" ? "My Space" : shell.workspace.name}
          locationHref={`/w/${workspaceId}/home`}
          title="Knowledge"
          description={`${rows.length} active ${rows.length === 1 ? "document" : "documents"} across ${activeSources.length} ${activeSources.length === 1 ? "source" : "sources"}.`}
          actions={<>
            {shell.access.actions.canWrite ? <Link className={buttonClasses()} href={`/w/${workspaceId}/knowledge/new`}>Create document</Link> : null}
            {shell.access.actions.canImport ? <Link className={buttonClasses({ variant: "secondary" })} href={`/w/${workspaceId}/sources/import`}>Import</Link> : null}
          </>}
        />
      </div>
      <div className="kh-page-wide mt-4">
        <KnowledgeIndex
          rows={rows}
          sources={activeSources.map((source) => ({ id: source.id, name: source.name }))}
          initialQuery={firstSearchParam(search.q) ?? ""}
          initialSource={initialSource}
          initialSort={initialSort}
          initialAscending={initialAscending}
          initialPage={initialPage}
          initialPageSize={initialPageSize}
        />
      </div>
    </div>
  );
}
