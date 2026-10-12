// Request-bound private review routes must bypass Next auto-mode Request proxies.
export const dynamic = "force-dynamic";
import { ownerReviewHttp, reviewBody } from "@/server/review-http";
import type { CreateOwnerReviewThreadInput } from "@/modules/knowledge/domain/document-review";
export async function GET(request:Request, context:{params:Promise<{documentId:string}>}) {
 return ownerReviewHttp(request,async (service,caller)=>{const {documentId}=await context.params; return service.queryForOwner(caller,documentId);});
}
/** The owner starts a discussion on a passage of their own document. The document is the path's, whatever the body says. */
export async function POST(request:Request, context:{params:Promise<{documentId:string}>}) {
 return ownerReviewHttp(request,async (service,caller)=>{const {documentId}=await context.params;const b=await reviewBody(request);return service.createForOwner(caller,{...(b as unknown as CreateOwnerReviewThreadInput),documentId});},201);
}
