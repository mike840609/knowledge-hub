import { reviewHttp } from "@/server/review-http";

export const dynamic = "force-dynamic";

/**
 * The owner's links that open their document now, to choose the one a mention hands over, each with its
 * audience: handing over a NAMED link adds the people it does not name yet.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  return reviewHttp(request, async (service, caller) => service.mentionLinksForOwner(caller, {
    documentId: params.get("documentId") ?? "",
  }));
}
