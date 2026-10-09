import Link from "next/link";
import { notFound } from "next/navigation";
import { getSourceListModel } from "@/server/source-read";
import { PageHeader } from "@/components/shell/page-header";

export default async function SourceHealthOverview({params}:{params:Promise<{workspaceId:string}>}) {
  const {workspaceId}=await params;
  const model=await getSourceListModel(workspaceId);
  if(!model || model.workspace.type !== "PERSONAL") notFound();
  const sources=model.items.filter(item=>item.source.status === "ACTIVE" && item.source.sourceType === "FOLDER_SYNC");
  return <main className="kh-page pb-6">
    <PageHeader location="Sources" locationHref={`/w/${workspaceId}/sources`} title="Source health" description="Review unresolved links and import warnings for each synced folder."/>
    <p className="mt-4 text-body text-kh-text-muted">Choose a folder to inspect its indexed document links and latest import warnings. Incomplete indexes are identified in the report.</p>
    <ul className="mt-6 space-y-2">{sources.map(({source})=><li key={source.id}><Link className="kh-focus-ring block rounded-md border border-kh-border p-3 text-kh-link" href={`/w/${workspaceId}/sources/${source.id}/health`}>{source.name}</Link></li>)}</ul>
    {!sources.length ? <p className="mt-6 text-body text-kh-text-muted">Import a folder to check its source health.</p> : null}
  </main>;
}
