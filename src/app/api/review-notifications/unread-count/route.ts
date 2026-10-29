// The Inbox badge: a number only, so a page change does not load every unread body.
export const dynamic = "force-dynamic";
import { reviewHttp } from "@/server/review-http";
export async function GET(request: Request) {
  return reviewHttp(request, async (service, caller) => service.countUnreadForOwner(caller));
}
