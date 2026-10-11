import { savedShareHttp } from "@/server/saved-share-http";
export async function GET(request: Request) {
  return savedShareHttp(request,async(s,c)=>s.savedShares.state(c,new URL(request.url).searchParams.get("token") ?? ""));
}
