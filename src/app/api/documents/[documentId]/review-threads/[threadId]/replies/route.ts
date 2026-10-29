// Request-bound private review routes must bypass Next auto-mode Request proxies.
export const dynamic = "force-dynamic";
import { ownerReviewHttp, reviewBody } from "@/server/review-http";
import { stringFields } from "@/server/workspace-http";
export async function POST(request:Request, context:{params:Promise<{documentId:string;threadId:string}>}) {
 return ownerReviewHttp(request,async (service,caller)=>{const {documentId,threadId}=await context.params;const raw=await reviewBody(request);const b=stringFields(raw,["body","idempotencyKey"]);const {mentions,mentionLinkId}=raw;return service.replyForOwner(caller,{documentId,threadId,body:b.body,idempotencyKey:b.idempotencyKey,mentions,mentionLinkId});});
}
