// Request-bound private review routes must bypass Next auto-mode Request proxies.
export const dynamic = "force-dynamic";
import { reviewHttp } from "@/server/review-http";
export async function GET(request: Request) {
  return reviewHttp(request, async (service, caller) => service.listUnreadForOwner(caller));
}
