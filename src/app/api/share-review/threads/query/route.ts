// Request-bound private review routes must bypass Next auto-mode Request proxies.
export const dynamic = "force-dynamic";
import { reviewReadHttp, SHARE_REVIEW_DOCUMENT } from "@/server/review-http";
import { requestFields } from "@/server/workspace-http";
export async function POST(request:Request) {
 return reviewReadHttp(request,async (service,caller)=>{const b=await requestFields(request,["token"],SHARE_REVIEW_DOCUMENT); return service.queryForLink(caller,b.token,b.documentId);});
}
