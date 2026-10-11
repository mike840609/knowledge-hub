import { savedShareHttp } from "@/server/saved-share-http";
export async function GET(request: Request, context: { params: Promise<{workspaceId:string}> }) {
  const query=new URL(request.url).searchParams;
  return savedShareHttp(request,async(s,c)=>s.savedShares.list(c,(await context.params).workspaceId,{q:query.get("q") ?? undefined,status:query.get("status") ?? undefined,page:query.get("page") ?? undefined}));
}
