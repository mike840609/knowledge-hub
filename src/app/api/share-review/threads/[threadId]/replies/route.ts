// Request-bound private review routes must bypass Next auto-mode Request proxies.
export const dynamic = "force-dynamic";
import { reviewHttp, reviewBody } from "@/server/review-http";
import { requestFields } from "@/server/workspace-http";
export async function POST(request:Request, context:{params:Promise<{threadId:string}>}) {
 return reviewHttp(request,async (service,caller)=>{const {threadId}=await context.params; const b=await requestFields(request.clone(),["token","body","idempotencyKey"]); const {mentions}=await reviewBody(request); return service.replyForLink(caller,{token:b.token,body:b.body,idempotencyKey:b.idempotencyKey,mentions,threadId});});
}
