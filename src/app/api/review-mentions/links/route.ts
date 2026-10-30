import { reviewHttp } from "@/server/review-http";

export const dynamic = "force-dynamic";

/** The owner's links that open their document now, to choose the one a mention hands over. */
export async function GET(request: Request) {
  return reviewHttp(request, async (service, caller) => service.mentionLinksForOwner(caller, { documentId: new URL(request.url).searchParams.get("documentId") ?? "" }));
}
