// Request-bound private review routes must bypass Next auto-mode Request proxies.
export const dynamic = "force-dynamic";
import { reviewHttp, SHARE_REVIEW_DOCUMENT } from "@/server/review-http";
import { requestFields } from "@/server/workspace-http";
export async function POST(request:Request, context:{params:Promise<{threadId:string}>}) {
 return reviewHttp(request,async (service,caller)=>{const {threadId}=await context.params; const b=await requestFields(request,["token"],SHARE_REVIEW_DOCUMENT); await service.markSeenForLink(caller,{token:b.token,documentId:b.documentId,threadId}); return { ok: true };});
}
