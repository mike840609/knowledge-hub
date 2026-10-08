import Link from "next/link";
import {notFound} from "next/navigation";
import {personalProfileRequest} from "@/server/personal-profile";
import {profilePeriod} from "@/modules/personal/application/personal-profile-service";
import {PageHeader} from "@/components/shell/page-header";
import {buttonClasses} from "@/components/ui/button";
const titles:Record<string,string>={all:"Knowledge documents",synced:"Synced documents",notes:"Personal notes",favorites:"Favorites",unread:"Unread updates",archived:"Archived documents",added:"Recently added",updated:"Recently updated","recent-archived":"Recently archived"};
export const dynamic="force-dynamic";
export default async function ProfileArticlesPage({params,searchParams}:{params:Promise<{workspaceId:string}>;searchParams:Promise<{filter?:string;days?:string;after?:string}>}){
 const {workspaceId}=await params,q=await searchParams,filter=q.filter??"all";
 const result=await personalProfileRequest((s,c)=>s.personalProfile.documents(c,workspaceId,{filter,days:q.days,after:q.after}));
 if(!result)notFound();const days=profilePeriod(q.days),base=`/w/${workspaceId}`;
 const period=["added","updated","recent-archived"].includes(filter);
 const next=new URLSearchParams({filter,days:String(days)});if(result.nextCursor)next.set("after",result.nextCursor);
 return <main className="kh-page pb-6"><PageHeader location="Insights" locationHref={`${base}/profile?days=${days}`} title={titles[filter]} description={`${result.total} ${result.total===1?"document":"documents"}${period?` with a recorded change in the past ${days} days`:""}`}/>
 {period?<p className="mt-4 text-caption text-kh-text-muted">Each document is counted once in this category. Links open its current saved version.</p>:null}
 <ul className="mt-6 divide-y divide-kh-border">{result.items.map(d=><li key={d.documentId}><Link className="kh-focus-ring block rounded-md px-3 py-3 hover:bg-kh-bg-hover" href={`${base}/knowledge/${d.sourceId}/${d.documentId}${d.archived?"?includeArchived=true":""}`}><div className="flex min-w-0 items-center justify-between gap-3 text-body"><span className="truncate font-medium">{d.title}</span>{d.archived?<span className="shrink-0 text-caption text-kh-text-muted">Archived</span>:null}</div><p className="mt-1 break-all text-caption text-kh-text-muted">{d.sourceName}{d.sourcePath?` · ${d.sourcePath}`:""}</p></Link></li>)}</ul>
 {!result.items.length?<p className="mt-6 text-body text-kh-text-muted">No documents match this view.</p>:null}
 {result.nextCursor?<Link className={`${buttonClasses({variant:"secondary"})} mt-6`} href={`?${next}`}>Next page</Link>:null}
 </main>;
}
