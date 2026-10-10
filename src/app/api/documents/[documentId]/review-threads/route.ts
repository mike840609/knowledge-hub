// Request-bound private review routes must bypass Next auto-mode Request proxies.
export const dynamic = "force-dynamic";
import { ownerReviewHttp } from "@/server/review-http";
export async function GET(request:Request, context:{params:Promise<{documentId:string}>}) {
 return ownerReviewHttp(request,async (service,caller)=>{const {documentId}=await context.params; return service.queryForOwner(caller,documentId);});
}
