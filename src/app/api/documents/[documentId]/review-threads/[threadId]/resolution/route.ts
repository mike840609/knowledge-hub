// Request-bound private review routes must bypass Next auto-mode Request proxies.
export const dynamic = "force-dynamic";
import { ownerReviewHttp } from "@/server/review-http";
import { requestFields } from "@/server/workspace-http";
import type { ReviewStatus } from "@/modules/knowledge/domain/document-review";
export async function POST(request:Request, context:{params:Promise<{documentId:string;threadId:string}>}) {
 return ownerReviewHttp(request,async (service,caller)=>{const {documentId,threadId}=await context.params; const b=await requestFields(request,["status"]); await service.setResolution(caller,{documentId,threadId,status:b.status as ReviewStatus});return {ok:true};});
}
