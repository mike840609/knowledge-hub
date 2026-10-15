// Authenticated, owner-scoped, aggregated counts for the My shares list.
// No client-supplied document/recipient IDs are trusted here.
export const dynamic = "force-dynamic";
import { reviewHttp } from "@/server/review-http";

export async function GET(request: Request) {
  return reviewHttp(request, async (service, caller) => ({
    counts: await service.listUnreadShareCountsForOwner(caller),
  }));
}
