// Request-bound private review routes must bypass Next auto-mode Request proxies.
export const dynamic = "force-dynamic";
import { reviewHttp, reviewBody } from "@/server/review-http";
import type { CreateReviewThreadInput } from "@/modules/knowledge/domain/document-review";
export async function POST(request:Request) {
 return reviewHttp(request,async (service,caller)=>{const b=await reviewBody(request); return service.createForLink(caller,b as unknown as CreateReviewThreadInput);},201);
}
