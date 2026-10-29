import { reviewHttp } from "@/server/review-http";

export const dynamic = "force-dynamic";

/** Answers only a trusted caller who could comment on the document now: a live link token, or its owner. */
export async function GET(request: Request) {
  return reviewHttp(request, async (service, caller) => {
    const params = new URL(request.url).searchParams;
    return service.searchMentionCandidates(caller, { query: params.get("query") ?? "", token: params.get("token") ?? undefined, documentId: params.get("documentId") ?? undefined });
  });
}
