// Request-bound private review routes must bypass Next auto-mode Request proxies.
export const dynamic = "force-dynamic";
import { reviewHttp, reviewBody, SHARE_REVIEW_DOCUMENT } from "@/server/review-http";
import { stringFields } from "@/server/workspace-http";
export async function POST(request:Request, context:{params:Promise<{threadId:string}>}) {
 return reviewHttp(request,async (service,caller)=>{const {threadId}=await context.params; const raw=await reviewBody(request); const b=stringFields(raw,["token","body","idempotencyKey"],SHARE_REVIEW_DOCUMENT); const {mentions}=raw; return service.replyForLink(caller,{token:b.token,documentId:b.documentId,body:b.body,idempotencyKey:b.idempotencyKey,mentions,threadId});});
}
