// Request-bound private review routes must bypass Next auto-mode Request proxies.
export const dynamic = "force-dynamic";
import { ownerReviewHttp } from "@/server/review-http";
import { requestFields } from "@/server/workspace-http";
export async function POST(request:Request, context:{params:Promise<{documentId:string;threadId:string;commentId:string}>}) {
 return ownerReviewHttp(request,async (service,caller)=>{const {documentId,threadId,commentId}=await context.params;const b=await requestFields(request,["body"]);return service.editForOwner(caller,{documentId,threadId,commentId,body:b.body});});
}
