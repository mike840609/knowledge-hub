// Request-bound private review routes must bypass Next auto-mode Request proxies.
export const dynamic = "force-dynamic";
import { ownerReviewHttp, reviewBody } from "@/server/review-http";
import type { ReviewVisibility } from "@/modules/knowledge/domain/document-review";
export async function POST(request:Request, context:{params:Promise<{documentId:string;threadId:string}>}) {
 return ownerReviewHttp(request,async (service,caller)=>{const {documentId,threadId}=await context.params;const b=await reviewBody(request);await service.setVisibility(caller,{documentId,threadId,visibility:b.visibility as ReviewVisibility,reason:b.reason as string|undefined});return {ok:true};});
}
