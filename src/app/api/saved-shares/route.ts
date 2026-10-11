// Request-bound private routes must bypass Next auto-mode Request proxies.
export const dynamic = "force-dynamic";
import { savedShareHttp } from "@/server/saved-share-http";
import { requestFields } from "@/server/workspace-http";
export async function POST(request: Request) {
  return savedShareHttp(request,async(s,c)=>s.savedShares.save(c,(await requestFields(request,["token"])).token));
}
