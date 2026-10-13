// Request-bound private review routes must bypass Next auto-mode Request proxies.
export const dynamic = "force-dynamic";
import { reviewHttp } from "@/server/review-http";
import { requestFields } from "@/server/workspace-http";
export async function POST(request:Request, context:{params:Promise<{threadId:string;commentId:string}>}) {
 return reviewHttp(request,async (service,caller)=>{const {threadId,commentId}=await context.params; const b=await requestFields(request,["token"]); await service.deleteForLink(caller,{token:b.token,threadId,commentId}); return {ok:true};});
}
