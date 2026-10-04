import Link from "next/link";
import {notFound} from "next/navigation";
import {applicationServices} from "@/server/composition";
import {PageHeader} from "@/components/shell/page-header";
import {FeedbackReport} from "@/components/knowledge/feedback-report";
export default async function LinkCheckPage({params}:{params:Promise<{workspaceId:string}>}){
  const {workspaceId}=await params;const services=applicationServices();const {caller}=await services.establishTrustedCaller();
  const state=await services.workspaceAdmin.workspaceState(caller,workspaceId);if(state.workspace.type!=="PERSONAL")notFound();
  const report=await services.links.getLinkHealth(caller,workspaceId);
  return <main className="kh-page space-y-6 py-6">
    <PageHeader location="Sources" locationHref={`/w/${workspaceId}/sources`} title="Check document links" description="Find wiki and relative Markdown links whose target document is missing. Image links and heading anchors are not checked." />
    {report.index.stale>0?<p className="text-body text-kh-warning">{report.index.stale} document(s) have an incomplete link index. This report is partial; ask the maintainer to rebuild the link index.</p>:null}
    <p className="text-body text-kh-text-muted">{report.total} unresolved link target(s) across {report.index.documents} documents. Fix source-managed documents locally, then sync again. Hub-managed notes can be edited here.</p>
    {report.items.length?<ul className="divide-y divide-kh-border">{report.items.map(item=><li key={`${item.documentId}:${item.kind}:${item.target}`} className="space-y-1 px-3 py-3"><Link className="kh-focus-ring rounded-md text-body font-medium text-kh-link underline underline-offset-2" href={`/w/${workspaceId}/knowledge/${item.sourceId}/${item.documentId}`}>{item.title}</Link><p className="break-all text-caption text-kh-text-muted">{item.sourcePath??"Hub-managed note"} · line {item.line} · {item.count} occurrence(s)</p><p className="break-all font-mono text-body">{item.target}</p></li>)}</ul>:<p className="text-body">{report.index.stale>0?"No unresolved targets found in the indexed documents.":"No unresolved document links found."}</p>}
    {report.truncated?<p className="text-caption text-kh-warning">Showing the first 500 of {report.total} targets. Fix these and check again.</p>:null}
    <FeedbackReport />
  </main>;
}
