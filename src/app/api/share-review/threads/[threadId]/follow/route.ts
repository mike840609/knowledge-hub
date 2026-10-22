// Request-bound private review routes must bypass Next auto-mode Request proxies.
export const dynamic = "force-dynamic";
import { reviewBody, reviewHttp } from "@/server/review-http";
import { DomainError } from "@/shared/domain/errors";
export async function POST(request:Request, context:{params:Promise<{threadId:string}>}) {
 return reviewHttp(request,async (service,caller)=>{
  const {threadId}=await context.params; const b=await reviewBody(request);
  if(typeof b.token!=="string" || typeof b.following!=="boolean") throw new DomainError("INVALID_REQUEST","Provide a token and whether to follow.");
  return service.followForLink(caller,{token:b.token,threadId,following:b.following});
 });
}
