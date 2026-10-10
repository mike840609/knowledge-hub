// Request-bound private review routes must bypass Next auto-mode Request proxies.
export const dynamic = "force-dynamic";
import { reviewReadHttp } from "@/server/review-http";
import { requestFields } from "@/server/workspace-http";
export async function POST(request:Request) {
 return reviewReadHttp(request,async (service,caller)=>{const b=await requestFields(request,["token"]); return service.queryForLink(caller,b.token);});
}
