import Link from "next/link";
import {notFound} from "next/navigation";
import {personalProfileRequest} from "@/server/personal-profile";
import {PageHeader} from "@/components/shell/page-header";
import {Timestamp} from "@/components/ui/timestamp";
import {buttonClasses} from "@/components/ui/button";
const titles:Record<string,string>={folders:"Synced folders",successful:"Last sync successful",failed:"Last sync failed",pending:"Awaiting Apply"};
export const dynamic="force-dynamic";
export default async function ProfileSyncPage({params,searchParams}:{params:Promise<{workspaceId:string}>;searchParams:Promise<{filter?:string;after?:string}>}){
 const {workspaceId}=await params,q=await searchParams,filter=q.filter??"folders";
 const result=await personalProfileRequest((s,c)=>s.personalProfile.syncItems(c,workspaceId,{filter,after:q.after}));
 if(!result)notFound();const base=`/w/${workspaceId}`,next=new URLSearchParams({filter});if(result.nextCursor)next.set("after",result.nextCursor);
 return <main className="kh-page py-6"><PageHeader location="Insights" locationHref={`${base}/profile`} title={titles[filter]} description={`${result.total} ${filter==="pending"?(result.total===1?"preview":"previews"):(result.total===1?"folder":"folders")}`}/>
 <ul className="mt-6 divide-y divide-kh-border">{result.items.map(item=><li key={item.id}><Link className="kh-focus-ring block rounded-md px-3 py-3 hover:bg-kh-bg-hover" href={item.previewId?`${base}/sources/imports/${item.previewId}`:`${base}/sources/${item.sourceId}`}><p className="text-body font-medium">{item.name}</p><p className="mt-1 text-caption text-kh-text-muted">{item.previewId?"Review preview before Apply":item.lastSyncedAt?<>Last successful sync <Timestamp value={item.lastSyncedAt}/></>:"No successful sync yet"}</p></Link></li>)}</ul>
 {!result.items.length?<p className="mt-6 text-body text-kh-text-muted">{filter==="pending"?"No previews are waiting for Apply.":filter==="failed"?"No active folders have a failed latest sync attempt.":"No folders match this view."}</p>:null}
 {result.nextCursor?<Link className={`${buttonClasses({variant:"secondary"})} mt-6`} href={`?${next}`}>Next page</Link>:null}
 </main>;
}
