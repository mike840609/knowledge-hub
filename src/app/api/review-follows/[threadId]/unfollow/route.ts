// Request-bound private review routes must bypass Next auto-mode Request proxies.
export const dynamic = "force-dynamic";
import { reviewHttp } from "@/server/review-http";
/** The caller drops their own follow; no token, since it reads nothing (spec 2026-10-23 § Remove). */
export async function POST(request:Request, context:{params:Promise<{threadId:string}>}) {
 return reviewHttp(request,async (service,caller)=>{const {threadId}=await context.params; return service.unfollowOwn(caller,threadId);});
}
