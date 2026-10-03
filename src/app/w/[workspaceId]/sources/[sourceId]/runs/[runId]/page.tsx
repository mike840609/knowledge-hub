import {getSyncRunDetail} from "@/server/sync-reading";
import {SyncRunDetailView} from "@/components/sources/sync-run-detail";
import {notFound} from "next/navigation";
export default async function RunPage({params,searchParams}:{params:Promise<{workspaceId:string;sourceId:string;runId:string}>;searchParams:Promise<{after?:string}>}){
 const {workspaceId,sourceId,runId}=await params;const {after}=await searchParams;
 const detail=await getSyncRunDetail(workspaceId,sourceId,runId,Number(after)||0);if(!detail)notFound();
 return <main className="kh-page py-6"><SyncRunDetailView detail={detail}/></main>;
}
