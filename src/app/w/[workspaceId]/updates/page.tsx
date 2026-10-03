import Link from "next/link";
import {notFound} from "next/navigation";
import {getFolderUpdates} from "@/server/sync-reading";
import {UpdatesList} from "@/components/knowledge/updates-list";
import {PageHeader} from "@/components/shell/page-header";
export default async function UpdatesPage({params,searchParams}:{params:Promise<{workspaceId:string}>;searchParams:Promise<{source?:string;unread?:string;time?:string;run?:string}>}){
 const {workspaceId}=await params,q=await searchParams;
 const page=await getFolderUpdates(workspaceId,{sourceId:q.source,unreadOnly:q.unread==="true",limit:20,cursor:q.time&&q.run?{completedAt:q.time,runId:q.run}:undefined});if(!page)notFound();
 const next=new URLSearchParams();if(q.source)next.set("source",q.source);if(q.unread)next.set("unread",q.unread);if(page.nextCursor){next.set("time",page.nextCursor.completedAt);next.set("run",page.nextCursor.runId);}
 return <main className="kh-page flex flex-col gap-5 py-6"><PageHeader location="My Space" locationHref={`/w/${workspaceId}`} title="Updates"/><form className="flex flex-wrap gap-3 text-body"><label>Source ID <input className="rounded border border-kh-border bg-kh-bg p-1" name="source" defaultValue={q.source}/></label><label><input type="checkbox" name="unread" value="true" defaultChecked={q.unread==="true"}/> Unread only</label><button className="text-kh-link">Filter</button></form><UpdatesList workspaceId={workspaceId} page={page}/>{page.nextCursor?<Link className="text-kh-link" href={`/w/${workspaceId}/updates?${next}`}>Older updates</Link>:null}</main>;
}
