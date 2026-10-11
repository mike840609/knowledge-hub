import { savedShareHttp } from "@/server/saved-share-http";
export async function DELETE(request: Request, context: { params: Promise<{id:string}> }) {
  return savedShareHttp(request,async(s,c)=>s.savedShares.remove(c,(await context.params).id),204);
}
