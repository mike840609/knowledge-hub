// Request-bound private review routes must bypass Next auto-mode Request proxies.
export const dynamic = "force-dynamic";
import { reviewHttp, reviewBody } from "@/server/review-http";
import { stringFields } from "@/server/workspace-http";
export async function POST(request:Request, context:{params:Promise<{threadId:string}>}) {
 return reviewHttp(request,async (service,caller)=>{const {threadId}=await context.params; const raw=await reviewBody(request); const b=stringFields(raw,["token","body","idempotencyKey"]); const {mentions}=raw; return service.replyForLink(caller,{token:b.token,body:b.body,idempotencyKey:b.idempotencyKey,mentions,threadId});});
}
